import { createInterface } from 'node:readline'
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKSession,
} from './sdk/v2.js'
import type { SDKPermissionRequestMessage, SDKMessage } from './sdk/shared.js'
import type { PermissionResult } from './sdk/coreTypes.generated.js'
import { runOutsideSdkContext } from '../bootstrap/state.js'
import { init } from './init.js'
import { getClaudeCodeMcpConfigs } from '../services/mcp/config.js'
import type { ScopedMcpServerConfig } from '../services/mcp/types.js'
import { getCommands } from '../commands.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../tools/AskUserQuestionTool/prompt.js'
import { getGlobalConfig, saveGlobalConfig, setProjectModelSetting } from '../utils/config.js'
import { THEME_SETTINGS } from '../utils/theme.js'
import {
  getModelOptions,
  parseSwitchProfileValue,
  SWITCH_PROFILE_VALUE_PREFIX,
} from '../utils/model/modelOptions.js'
import { getUserSpecifiedModelSetting } from '../utils/model/model.js'
import {
  getProviderProfiles,
  getActiveProviderProfile,
  setActiveProviderProfile,
  clearActiveProviderProfile,
  ANTHROPIC_DEFAULT_PROFILE_ID,
} from '../utils/providerProfiles.js'
import { getInitialMainLoopModel, setMainLoopModelOverride } from '../bootstrap/state.js'
import { buildConfigSettings } from '../utils/studioConfigSurface.js'
import { buildStatusSnapshot } from '../utils/statusLineSnapshot.js'

/**
 * Tool permission mode. The default is `bypassPermissions` so the agent can
 * use every tool (e.g. web search, shell, MCP) without per-call approval.
 * Clients that want per-call confirmation can pass `permissionMode: 'default'`
 * or `'plan'` in the session options.
 */
const permissionMode =
  (process.env.OPENCLAUDE_ACP_PERMISSION_MODE as 'default' | 'plan' | 'auto-accept' | 'bypass-permissions' | 'bypassPermissions' | 'fullAccess' | 'dontAsk' | undefined) ??
  'bypassPermissions'

/**
 * The studio UI sends the effective permission mode inside the session
 * request's `_meta`. `session/new` and `session/load` both carry it, so this
 * helper reads whichever is present and lets the client override the env
 * default.
 */
function resolveSessionPermissionMode(params: Record<string, unknown> | undefined): string {
  const meta = isRecord(params?.['_meta']) ? params['_meta'] : undefined
  const mode = meta?.permissionMode
  return typeof mode === 'string' && mode !== '' ? mode : permissionMode
}

/**
 * MCP servers from the user's config, available to every ACP session.
 * Loaded lazily so a slow or unreachable server doesn't block session setup.
 */
async function loadMcpServers(): Promise<Record<string, ScopedMcpServerConfig> | undefined> {
  try {
    const { servers } = await getClaudeCodeMcpConfigs()
    return servers
  } catch {
    return undefined
  }
}

const ACP_PROTOCOL_VERSION = 1
const ACP_AGENT_INFO = {
  name: 'openclaude',
  title: 'OpenClaude',
  version: String((globalThis as { MACRO?: { DISPLAY_VERSION?: string } }).MACRO?.DISPLAY_VERSION ?? 'dev'),
}

type JsonRpcId = string | number | null
type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
  /** present on client responses to our requests (e.g. permission prompts) */
  result?: unknown
}
type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type AcpWriter = (message: JsonRpcResponse | { jsonrpc: '2.0'; method: string; params: unknown }) => void

type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other'

type AcpTextContentBlock = {
  type: 'content'
  content: { type: 'text'; text: string }
}

type AcpDiffContent = {
  type: 'diff'
  path: string
  oldText?: string | null
  newText: string
}

type AcpTerminalContent = {
  type: 'terminal'
  terminalId: string
}

type AcpToolCallContent =
  | AcpTextContentBlock
  | AcpDiffContent
  | AcpTerminalContent

type AcpToolCallLocation = {
  path: string
  line?: number | null
}

type AcpToolCallUpdate = {
  sessionUpdate: 'tool_call'
  toolCallId: string
  title: string
  kind: AcpToolKind
  status: 'in_progress'
  rawInput: Record<string, unknown>
  locations?: AcpToolCallLocation[]
  content?: AcpToolCallContent[]
}

type AcpToolCallResultUpdate = {
  sessionUpdate: 'tool_call_update'
  toolCallId: string
  status: 'completed' | 'failed'
  content?: AcpToolCallContent[]
  rawOutput: unknown
}

type AcpToolUpdate = AcpToolCallUpdate | AcpToolCallResultUpdate

type AcpAgentMessageChunk = {
  sessionUpdate: 'agent_message_chunk'
  content: { type: 'text'; text: string }
}

type AcpAvailableCommand = {
  name: string
  description: string
  _meta: { type: string; argumentHint?: string }
}

type AcpAvailableCommandsUpdate = {
  sessionUpdate: 'available_commands_update'
  availableCommands: AcpAvailableCommand[]
}

type AcpTextContent = { type: 'text'; text: string }

type AcpUserMessageChunk = {
  sessionUpdate: 'user_message_chunk'
  content: AcpTextContent
}

type AcpAgentThoughtChunk = {
  sessionUpdate: 'agent_thought_chunk'
  content: AcpTextContent
}

type AcpPlanUpdate = {
  sessionUpdate: 'plan'
  entries: Array<{
    content: string
    priority: 'high' | 'medium' | 'low'
    status: 'pending' | 'in_progress' | 'completed'
  }>
}

type AcpUsageUpdate = {
  sessionUpdate: 'usage_update'
  used: number
  size: number
  cost?: { amount: number; currency: string } | null
}

type AcpCurrentModeUpdate = {
  sessionUpdate: 'current_mode_update'
  currentModeId: string
}

type AcpConfigOptionUpdate = {
  sessionUpdate: 'config_option_update'
  configOptions: Array<
    | {
        id: string
        name: string
        type: 'select'
        currentValue: string
        options: Array<{ value: string; name: string }>
      }
    | { id: string; name: string; type: 'boolean'; currentValue: boolean }
  >
}

type AcpSessionInfoUpdate = {
  sessionUpdate: 'session_info_update'
  title?: string | null
  updatedAt?: string | null
}

type AcpNotice = {
  sessionUpdate: 'notice'
  severity: 'info' | 'warning' | 'error'
  title: string
  description?: string | null
}

type AcpCompactionUpdate = {
  sessionUpdate: 'compaction_update'
  compactionId: string
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled'
  summary?: AcpTextContent[] | null
  error?: string | null
}

type AcpCompactionSummaryChunk = {
  sessionUpdate: 'compaction_summary_chunk'
  compactionId: string
  content: AcpTextContent
}

/**
 * The ACP SDK is only installed in the `studio` workspace, not in the root
 * CLI bundle, so the server keeps its own strict union of the updates it emits.
 * Adding a new kind here (and only here) is what forces M1/M2 mappers to be
 * handled at compile time instead of silently passing a `Record<string, unknown>`.
 */
export type AcpSessionUpdate =
  | AcpToolUpdate
  | AcpAgentMessageChunk
  | AcpAvailableCommandsUpdate
  | AcpUserMessageChunk
  | AcpAgentThoughtChunk
  | AcpPlanUpdate
  | AcpUsageUpdate
  | AcpCurrentModeUpdate
  | AcpConfigOptionUpdate
  | AcpSessionInfoUpdate
  | AcpNotice
  | AcpCompactionUpdate
  | AcpCompactionSummaryChunk

type SessionState = {
  cwd: string
  session: SDKSession
  active: Promise<void> | null
  statusUnsubscribe?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function textFromPrompt(params: Record<string, unknown>): string {
  const prompt = params.prompt
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) throw new Error('session/prompt requires a prompt')

  return prompt
    .filter(isRecord)
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

function textFromMessage(message: SDKMessage): string | null {
  if (message.type === 'assistant') {
    const content = message.message.content
    if (!Array.isArray(content)) return null
    return content
      .filter(isRecord)
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('') || null
  }

  if (message.type === 'stream_event' && isRecord(message.event)) {
    const delta = message.event.delta
    if (isRecord(delta) && delta.type === 'text_delta' && typeof delta.text === 'string') {
      return delta.text
    }
  }

  return null
}

/** Text from a real user turn, excluding tool results and compaction summaries. */
export function userTextFromMessage(message: SDKMessage): string | null {
  if (message.type !== 'user') return null
  const record = message as unknown as Record<string, unknown>
  if (record.isReplay === true || record.isSynthetic === true) return null
  const inner = message.message as Record<string, unknown>
  if (inner.isCompactSummary === true || inner.isVisibleInTranscriptOnly === true) return null
  if (record.tool_use_result !== undefined) return null
  return textBlocks(message.message.content)
}

/** Thinking text, mirroring `textFromMessage` but for thought blocks/deltas. */
export function thinkingFromMessage(message: SDKMessage): string | null {
  if (message.type === 'assistant') {
    const content = message.message.content
    if (!Array.isArray(content)) return null
    return (
      content
        .filter(isRecord)
        .filter(block => block.type === 'thinking' && typeof block.thinking === 'string')
        .map(block => block.thinking as string)
        .join('') || null
    )
  }

  if (message.type === 'stream_event' && isRecord(message.event)) {
    const delta = message.event.delta
    if (isRecord(delta) && delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      return delta.thinking
    }
  }

  return null
}

/** The generated compaction summary, when the runtime forwards it as a user message. */
export function compactSummaryFromMessage(message: SDKMessage): string | null {
  if (message.type !== 'user') return null
  const record = message as unknown as Record<string, unknown>
  if (record.isReplay === true) return null
  const inner = message.message as Record<string, unknown>
  if (inner.isCompactSummary !== true && inner.isVisibleInTranscriptOnly !== true) return null
  return textBlocks(message.message.content)
}

function textBlocks(content: unknown): string | null {
  if (typeof content === 'string') return content || null
  if (!Array.isArray(content)) return null
  return (
    content
      .filter(isRecord)
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('') || null
  )
}

function compactionIdFor(sessionId: string): string {
  return `${sessionId}:compaction`
}

/** Map the lifecycle events the SDK emits around a context compaction. */
export function compactionUpdates(
  message: SDKMessage,
  sessionId: string,
): AcpCompactionUpdate[] {
  if (message.type !== 'system') return []
  const record = message as unknown as Record<string, unknown>
  if (record.subtype === 'status' && record.status === 'compacting') {
    return [
      {
        sessionUpdate: 'compaction_update',
        compactionId: compactionIdFor(sessionId),
        status: 'in_progress',
      },
    ]
  }
  if (record.subtype === 'compact_boundary') {
    return [
      {
        sessionUpdate: 'compaction_update',
        compactionId: compactionIdFor(sessionId),
        status: 'completed',
      },
    ]
  }
  return []
}

/** Surface retry/error stream events as ACP notices. */
export function noticeFromMessage(message: SDKMessage): AcpNotice | null {
  const record = message as unknown as Record<string, unknown>
  if (message.type === 'system' && record.subtype === 'api_retry') {
    const attempt = typeof record.attempt === 'number' ? record.attempt : 0
    const maxRetries = typeof record.max_retries === 'number' ? record.max_retries : 0
    return {
      sessionUpdate: 'notice',
      severity: 'warning',
      title: `API retry ${attempt}/${maxRetries}`,
      description: typeof record.error === 'string' ? record.error : null,
    }
  }
  if (message.type === 'result' && record.subtype === 'error') {
    const errors = Array.isArray(record.errors)
      ? record.errors.filter((entry): entry is string => typeof entry === 'string')
      : []
    return {
      sessionUpdate: 'notice',
      severity: 'error',
      title: 'Turn failed',
      description: errors.join('; ') || null,
    }
  }
  return null
}

type StatusAppState = Parameters<typeof buildStatusSnapshot>[0]
type StatusSnapshotValue = Awaited<ReturnType<typeof buildStatusSnapshot>>

/** Aggregate state derived from the same snapshot the statusline extension consumes. */
export function statusUpdates(snapshot: StatusSnapshotValue): AcpSessionUpdate[] {
  const updates: AcpSessionUpdate[] = []
  if (snapshot.contextWindow) {
    updates.push({
      sessionUpdate: 'usage_update',
      used: snapshot.contextWindow.tokens,
      size: snapshot.contextWindow.size,
      cost: { amount: snapshot.session.costUsd, currency: 'USD' },
    })
  }
  updates.push({
    sessionUpdate: 'session_info_update',
    title: snapshot.session.name,
    updatedAt: new Date().toISOString(),
  })
  updates.push({
    sessionUpdate: 'current_mode_update',
    currentModeId: snapshot.permissionMode,
  })
  return updates
}

/** Flatten the per-agent todo lists into one ACP plan. */
export function planUpdate(appState: StatusAppState): AcpPlanUpdate | null {
  const todosByAgent = appState.todos
  if (!todosByAgent) return null
  const entries: AcpPlanUpdate['entries'] = []
  for (const todos of Object.values(todosByAgent)) {
    if (!Array.isArray(todos)) continue
    for (const todo of todos) {
      if (!isRecord(todo) || typeof todo.content !== 'string') continue
      const status = todo.status
      entries.push({
        content: todo.content,
        priority: 'medium',
        status: status === 'in_progress' || status === 'completed' ? status : 'pending',
      })
    }
  }
  return { sessionUpdate: 'plan', entries }
}

export function noticeUpdateFromAppState(appState: StatusAppState): AcpNotice | null {
  const current = appState.notifications?.current
  if (!current) return null
  const record = current as unknown as Record<string, unknown>
  if (typeof record.text !== 'string' || !record.text) return null
  const priority = record.priority
  return {
    sessionUpdate: 'notice',
    severity: priority === 'immediate' || priority === 'high' ? 'warning' : 'info',
    title: record.text,
    description: null,
  }
}

export function configOptionsUpdate(): AcpConfigOptionUpdate {
  const configOptions: AcpConfigOptionUpdate['configOptions'] = buildConfigSettings().map(
    setting =>
      setting.type === 'boolean'
        ? {
            id: setting.id,
            name: setting.label,
            type: 'boolean' as const,
            currentValue: Boolean(setting.read()),
          }
        : {
            id: setting.id,
            name: setting.label,
            type: 'select' as const,
            currentValue: String(setting.read() ?? ''),
            options: (setting.options ?? []).map(value => ({ value, name: value })),
          },
  )
  return { sessionUpdate: 'config_option_update', configOptions }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

function toolKindFor(name: string): AcpToolKind {
  switch (name) {
    case 'Read':
      return 'read'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit'
    case 'Bash':
    case 'PowerShell':
    case 'BashOutput':
    case 'KillShell':
      return 'execute'
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
    case 'ToolSearch':
      return 'search'
    case 'WebFetch':
      return 'fetch'
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return 'switch_mode'
    case 'Task':
      return 'think'
    default:
      return 'other'
  }
}

// Structural blocks describe the call, not its result, so they are derived
// purely from the tool input. ACP's tool_call_update.content *replaces* the
// array; the client reducer re-attaches these blocks when the result arrives.
function toolPresentationFor(
  name: string,
  toolCallId: string,
  input: Record<string, unknown>,
): { locations?: AcpToolCallLocation[]; content?: AcpToolCallContent[] } {
  const str = (value: unknown): string | null =>
    typeof value === 'string' ? value : null
  const pathOf = (value: unknown): string | null => {
    const path = str(value)
    return path && path.length > 0 ? path : null
  }

  let diff: AcpDiffContent | null = null
  let locations: AcpToolCallLocation[] | undefined

  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
    const path = pathOf(name === 'NotebookEdit' ? input.notebook_path : input.file_path)
    const newText =
      name === 'Edit'
        ? str(input.new_string)
        : name === 'Write'
          ? str(input.content)
          : str(input.new_source)
    if (path && newText !== null) {
      diff = {
        type: 'diff',
        path,
        oldText: name === 'Edit' ? str(input.old_string) : null,
        newText,
      }
      locations = [{ path }]
    }
  } else if (name === 'Read') {
    const path = pathOf(input.file_path)
    if (path) locations = [{ path }]
  } else if (name === 'Bash' || name === 'PowerShell') {
    const sed = isRecord(input._simulatedSedEdit) ? input._simulatedSedEdit : null
    const sedPath = sed ? pathOf(sed.filePath) : null
    const sedText = sed ? str(sed.newContent) : null
    if (sedPath && sedText !== null) {
      diff = { type: 'diff', path: sedPath, oldText: null, newText: sedText }
      locations = [{ path: sedPath }]
    }
    return {
      ...(locations ? { locations } : {}),
      content: [
        ...(diff ? [diff] : []),
        { type: 'terminal', terminalId: toolCallId },
      ],
    }
  }

  return {
    ...(locations ? { locations } : {}),
    ...(diff ? { content: [diff] } : {}),
  }
}

// Every tool_use opens a tool_call and every tool_result closes it with a
// tool_call_update. Without the closing update the client never learns a tool
// finished and only sees its result after reloading history from disk.
export function toolUpdates(message: SDKMessage): AcpToolUpdate[] {
  if (message.type !== 'assistant' && message.type !== 'user') return []
  const content = (message.message as { content?: unknown }).content
  if (!Array.isArray(content)) return []

  if (message.type === 'assistant') {
    return content.filter(isRecord).flatMap((tool): AcpToolCallUpdate[] => {
      if (tool.type !== 'tool_use' || typeof tool.id !== 'string') return []
      const name = typeof tool.name === 'string' ? tool.name : 'OpenClaude tool'
      const input = isRecord(tool.input) ? tool.input : {}
      return [
        {
          sessionUpdate: 'tool_call',
          toolCallId: tool.id,
          title: name,
          kind: toolKindFor(name),
          status: 'in_progress',
          rawInput: input,
          ...toolPresentationFor(name, tool.id, input),
        },
      ]
    })
  }

  return content.filter(isRecord).flatMap((result): AcpToolCallResultUpdate[] => {
    if (result.type !== 'tool_result' || typeof result.tool_use_id !== 'string') return []
    const text = toolResultText(result.content)
    return [
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: result.tool_use_id,
        status: result.is_error === true ? 'failed' : 'completed',
        ...(text
          ? { content: [{ type: 'content' as const, content: { type: 'text' as const, text } }] }
          : {}),
        rawOutput: result.content ?? null,
      },
    ]
  })
}

export function createAcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): { close: () => Promise<void> } {
  const sessions = new Map<string, SessionState>()
  const pendingRequests = new Map<JsonRpcId, (result: unknown) => void>()
  let nextRequestId = 1
  let initialized = false
  let supportsCompaction = false
  let supportsNotices = false

  const write: AcpWriter = message => {
    output.write(`${JSON.stringify(message)}\n`)
  }

  const respond = (id: JsonRpcId, result: unknown): void => {
    write({ jsonrpc: '2.0', id, result })
  }

  /**
   * The ACP spec resolves permission responses through
   * `outcome: { outcome: 'selected', optionId }` (or `'cancelled'`), not the
   * raw optionId. This normalizes whatever the client sends so a rejected
   * response never falls through as a silent deny.
   */
  function resolvePermission(result: unknown): PermissionResult {
    const payload = isRecord(result) ? result : {}
    const outcome = isRecord(payload.outcome) ? payload.outcome : {}
    const optionId = typeof outcome.optionId === 'string' ? outcome.optionId : null
    // `AskUserQuestion` answers ride on `_meta.answers` of the selected outcome,
    // keyed by question text. Forward them as `updatedInput` so the tool sees
    // the user's choices instead of an empty prompt.
    const meta = isRecord(outcome._meta) ? outcome._meta : {}
    const answers = isRecord(meta.answers) ? meta.answers : null
    if (outcome.outcome === 'selected' && answers) {
      return {
        behavior: 'allow',
        decisionClassification: 'user_temporary',
        updatedInput: { answers },
      }
    }
    if (outcome.outcome === 'selected' && optionId !== null && optionId.startsWith('allow')) {
      return {
        behavior: 'allow',
        decisionClassification: 'user_temporary',
      }
    }
    return {
      behavior: 'deny',
      message: 'Permission denied by ACP client',
      decisionClassification: 'user_reject',
    }
  }

  const fail = (id: JsonRpcId, code: number, message: string): void => {
    write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  const notify = (method: string, params: unknown): void => {
    write({ jsonrpc: '2.0', method, params })
  }

  const emitUpdate = (sessionId: string, update: AcpSessionUpdate): void => {
    // ACP requires compaction/notice updates only when the client advertised
    // the matching session capability during initialize.
    if (
      (update.sessionUpdate === 'compaction_update' ||
        update.sessionUpdate === 'compaction_summary_chunk') &&
      !supportsCompaction
    ) {
      return
    }
    if (update.sessionUpdate === 'notice' && !supportsNotices) return
    notify('session/update', { sessionId, update })
  }

  /**
   * Tell the client which slash commands this session supports so a remote
   * composer can offer a `/` menu from the real registry instead of a
   * hardcoded list. Command discovery is filesystem-backed (skills, plugins,
   * project commands), so a failure must not break session creation.
   */
  const advertiseCommands = async (sessionId: string, cwd: string): Promise<void> => {
    try {
      const commands = await getCommands(cwd)
      const update: AcpAvailableCommandsUpdate = {
        sessionUpdate: 'available_commands_update',
        availableCommands: commands.map(command => ({
          name: command.name,
          description: command.description,
          // `local-jsx` commands render terminal UI and are no-ops over ACP.
          // Expose the kind so a remote composer can render its own panel
          // instead of sending a prompt that would produce no output.
          _meta: {
            type: command.type,
            ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
          },
        })),
      }
      emitUpdate(sessionId, update)
    } catch {
      // Best-effort: the composer simply has no `/` menu this session.
    }
  }

  /**
   * Push the live statusline (branch, model, context, background tasks) to the
   * client on every AppState change instead of having the client poll. The
   * snapshot is built on a timer so a burst of `setState` calls (e.g. a single
   * tool execution that flips several task states) collapses to one message.
   *
   * `getBranch()` shells out to git and is cached, cost/duration are cheap
   * globals, so per-change builds are light — no need for the client to poll.
   */
  const subscribeSessionStatus = (state: SessionState): void => {
    const sessionId = state.session.sessionId
    let timer: ReturnType<typeof setTimeout> | null = null
    let previousNoticeKey: string | null = null
    const emit = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      timer = setTimeout(() => {
        timer = null
        void (async () => {
          const appState = state.session.getAppState()
          // The state-derived kinds are independent of the async status
          // snapshot, so emit them first. A single subscription per session
          // keeps every kind behind the same 150ms debounce.
          const plan = planUpdate(appState)
          if (plan) emitUpdate(sessionId, plan)
          const notice = noticeUpdateFromAppState(appState)
          const noticeKey =
            notice && isRecord(appState.notifications?.current)
              ? String((appState.notifications?.current as Record<string, unknown>).key ?? notice.title)
              : null
          if (notice && noticeKey !== previousNoticeKey) {
            previousNoticeKey = noticeKey
            emitUpdate(sessionId, notice)
          }
          try {
            const snapshot = await buildStatusSnapshot(appState, state.session.getMessages())
            notify('openclaude/status_update', { sessionId, status: snapshot })
            for (const update of statusUpdates(snapshot)) emitUpdate(sessionId, update)
          } catch {
            // Best-effort: a transient git failure must not tear down the
            // subscription; the client keeps its last known snapshot.
          }
        })()
      }, 150)
    }
    const stop = state.session.subscribeAppState(() => emit())
    state.statusUnsubscribe = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      stop()
    }
    // Emit once immediately so the client has a snapshot without waiting for
    // the first change — the pull-based `openclaude/status` remains the
    // fallback for initial paint.
    emit()
  }

  const requestPermission = (
    sessionId: string,
    session: SDKSession,
    message: SDKPermissionRequestMessage,
  ): void => {
    const id = nextRequestId++
    pendingRequests.set(id, result => {
      session.respondToPermission(message.tool_use_id, resolvePermission(result))
    })

    const inputs = message.input ?? {}
    // `AskUserQuestion` is interactive: the client renders the questions and
    // returns the answers through `updatedInput`, so forward them as a
    // permission request instead of a plain allow/deny prompt.
    const isAskUserQuestion = message.tool_name === ASK_USER_QUESTION_TOOL_NAME
    const questions = isAskUserQuestion
      ? (inputs.questions as Array<Record<string, unknown>> | undefined)
      : undefined
    const options = isAskUserQuestion
      ? []
      : [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ]

    write({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: {
          toolCallId: message.tool_use_id,
          title: message.tool_name,
          kind: toolKindFor(message.tool_name),
          rawInput: message.input,
        },
        options,
        // ACP's schema only allows `_meta` for extensions; a top-level
        // `questions` key is stripped by the SDK's Zod parser before the
        // client ever sees it.
        ...(questions ? { _meta: { questions } } : {}),
      },
    })
  }

  type AcpHandler = (message: JsonRpcRequest) => Promise<void> | void

  const handlers: Record<string, AcpHandler> = {
    initialize(message) {
      const capabilities = isRecord(message.params?.clientCapabilities)
        ? message.params.clientCapabilities
        : {}
      const sessionCapabilities = isRecord(capabilities.session) ? capabilities.session : {}
      supportsCompaction = isRecord(sessionCapabilities.compaction)
      supportsNotices = isRecord(sessionCapabilities.notices)
      if (message.id === undefined) return
      respond(message.id, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
        },
        agentInfo: ACP_AGENT_INFO,
      })
    },

    'session/new': async message => {
      const cwd = typeof message.params?.cwd === 'string' ? message.params.cwd : process.cwd()
      const mode = resolveSessionPermissionMode(message.params)
      const mcpServers = await loadMcpServers()
      let session: SDKSession
      const onPermissionRequest = (permission: SDKPermissionRequestMessage): void => {
        requestPermission(session.sessionId, session, permission)
      }
      session = unstable_v2_createSession({
        cwd,
        // The SDK's `QueryPermissionMode` option type predates the `fullAccess`
        // and `dontAsk` modes; all six values are accepted at runtime and
        // normalized internally, so we widen the string here.
        permissionMode: mode as Parameters<typeof unstable_v2_createSession>[0]['permissionMode'],
        allowDangerouslySkipPermissions: mode === 'bypassPermissions' || mode === 'fullAccess',
        mcpServers,
        onPermissionRequest,
      })
      sessions.set(session.sessionId, { cwd, session, active: null })
      if (message.id !== undefined) respond(message.id, { sessionId: session.sessionId })
      // Advertise after the response so the client has adopted the session
      // store by the time the command list lands.
      void advertiseCommands(session.sessionId, cwd)
      emitUpdate(session.sessionId, configOptionsUpdate())
      subscribeSessionStatus(sessions.get(session.sessionId)!)
    },

    'session/load': async message => {
      const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : ''
      const cwd = typeof message.params?.cwd === 'string' ? message.params.cwd : process.cwd()
      if (!sessionId) {
        if (message.id !== undefined) fail(message.id, -32602, 'session/load requires sessionId')
        return
      }
      const mode = resolveSessionPermissionMode(message.params)
      const mcpServers = await loadMcpServers()
      let session: SDKSession
      const onPermissionRequest = (permission: SDKPermissionRequestMessage): void => {
        requestPermission(session.sessionId, session, permission)
      }
      session = await unstable_v2_resumeSession(sessionId, {
        cwd,
        permissionMode: mode as Parameters<typeof unstable_v2_resumeSession>[1]['permissionMode'],
        allowDangerouslySkipPermissions: mode === 'bypassPermissions' || mode === 'fullAccess',
        mcpServers,
        onPermissionRequest,
      })
      sessions.set(sessionId, { cwd, session, active: null })
      if (message.id !== undefined) respond(message.id, { sessionId })
      void advertiseCommands(sessionId, cwd)
      emitUpdate(sessionId, configOptionsUpdate())
      subscribeSessionStatus(sessions.get(sessionId)!)
    },

    'session/cancel'(message) {
      const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : ''
      const state = sessions.get(sessionId)
      if (state) state.session.interrupt()
      if (message.id !== undefined) respond(message.id, {})
    },

    'session/prompt'(message) {
      const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : ''
      const state = sessions.get(sessionId)
      if (!state) {
        if (message.id !== undefined) fail(message.id, -32004, `Unknown session: ${sessionId}`)
        return
      }
      if (state.active) {
        if (message.id !== undefined) fail(message.id, -32005, 'A prompt is already active for this session')
        return
      }

      state.active = (async () => {
        try {
          for await (const sdkMessage of state.session.sendMessage(textFromPrompt(message.params ?? {}))) {
            const text = textFromMessage(sdkMessage)
            if (text) {
              const update: AcpAgentMessageChunk = {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text },
              }
              emitUpdate(sessionId, update)
            }
            const thought = thinkingFromMessage(sdkMessage)
            if (thought) {
              emitUpdate(sessionId, {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: thought },
              })
            }
            const userText = userTextFromMessage(sdkMessage)
            if (userText) {
              emitUpdate(sessionId, {
                sessionUpdate: 'user_message_chunk',
                content: { type: 'text', text: userText },
              })
            }
            for (const update of compactionUpdates(sdkMessage, sessionId)) {
              emitUpdate(sessionId, update)
            }
            const compactSummary = compactSummaryFromMessage(sdkMessage)
            if (compactSummary) {
              emitUpdate(sessionId, {
                sessionUpdate: 'compaction_summary_chunk',
                compactionId: compactionIdFor(sessionId),
                content: { type: 'text', text: compactSummary },
              })
            }
            const notice = noticeFromMessage(sdkMessage)
            if (notice) emitUpdate(sessionId, notice)
            for (const update of toolUpdates(sdkMessage)) {
              emitUpdate(sessionId, update)
            }
          }
          if (message.id !== undefined) respond(message.id, { stopReason: 'end_turn' })
        } catch (error) {
          if (message.id !== undefined) {
            fail(message.id, -32000, error instanceof Error ? error.message : String(error))
          }
        } finally {
          state.active = null
        }
      })()
    },

    'openclaude/config': async message => {
      const params = isRecord(message.params) ? message.params : {}
      const mode = typeof params.mode === 'string' ? params.mode : 'get'
      if (mode === 'set') {
        if (message.id === undefined) return
        respond(message.id, await applyConfigPatch(params))
        return
      }
      if (message.id === undefined) return
      respond(message.id, readConfigSnapshot())
    },

    'openclaude/status': async message => {
      if (message.id === undefined) return
      const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : ''
      const state = sessions.get(sessionId)
      if (!state) {
        fail(message.id, -32004, `Unknown session: ${sessionId}`)
        return
      }
      respond(message.id, await buildStatusSnapshot(state.session.getAppState(), state.session.getMessages()))
    },
  }

  const handle = async (message: JsonRpcRequest): Promise<void> => {
    if (message.id !== undefined && pendingRequests.has(message.id)) {
      const resolve = pendingRequests.get(message.id)!
      pendingRequests.delete(message.id)
      // A JSON-RPC *response* (what the client sends when answering a
      // permission request) carries its payload in `result`, not `params`.
      // Fall back to `params` so a malformed response never crashes the loop.
      resolve(message.result ?? message.params ?? {})
      return
    }

    // init() must run before session creation; it enables configs and must not
    // run inside the SDK's AsyncLocalStorage context.
    if (!initialized) {
      await runOutsideSdkContext(init)
      initialized = true
    }

    // `constructor`/`toString` resolve through Object.prototype on a plain
    // record, so a plain index lookup would invoke them as handlers.
    const method = message.method
    const handler = typeof method === 'string' && Object.hasOwn(handlers, method)
      ? handlers[method]
      : undefined
    if (!handler) {
      if (message.id !== undefined) fail(message.id, -32601, `Method not found: ${message.method}`)
      return
    }
    await handler(message)
  }

  /**
   * A serializable read of the config surface the web composer renders panels
   * for: model options, theme settings, and provider profiles. Local-jsx slash
   * commands (`/model`, `/theme`, `/provider`, `/config`) render terminal UI and
   * are no-ops over ACP, so the remote composer instead fetches this snapshot
   * and renders its own panel before applying changes via `mode: 'set'`.
   */
  function readConfigSnapshot(): unknown {
    const config = getGlobalConfig()
    const options = getModelOptions()
    const activeModel = getUserSpecifiedModelSetting() ?? getInitialMainLoopModel()
    const profiles = getProviderProfiles(config).map(profile => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl,
    }))
    const activeProfile = getActiveProviderProfile()

    const settings = buildConfigSettings().map(setting => ({
      id: setting.id,
      type: setting.type,
      label: setting.label,
      description: setting.description,
      ...(setting.options ? { options: setting.options } : {}),
      value: setting.read(),
    }))

    return {
      model: {
        active: activeModel ?? null,
        options: options.map(option => ({
          value: option.value,
          label: option.label,
          description: option.description,
          ...(option.switchToProfileId
            ? { switchToProfileId: option.switchToProfileId }
            : {}),
        })),
      },
      theme: {
        active: config.theme,
        options: [...THEME_SETTINGS],
      },
      provider: {
        activeId: activeProfile?.id ?? null,
        profiles,
      },
      settings,
    }
  }

  /**
   * Apply a config patch sent from the web composer. Each field is optional;
   * absent fields are left untouched. Returns the post-write snapshot so the
   * composer can refresh without a second round trip.
   */
  async function applyConfigPatch(params: Record<string, unknown>): Promise<unknown> {
    // Model — a plain model alias/ID, or a `__switch_profile__:`-encoded value
    // that also activates a provider profile before switching models.
    if (typeof params.model === 'string') {
      const model = params.model
      const switchProfile = model.startsWith(SWITCH_PROFILE_VALUE_PREFIX)
        ? parseSwitchProfileValue(model)
        : undefined
      if (switchProfile) {
        setActiveProviderProfile(switchProfile.profileId)
        applyModelSetting(switchProfile.model)
      } else {
        applyModelSetting(model === 'default' ? null : model)
      }
    }

    // Theme — stored directly on the global config.
    if (typeof params.theme === 'string' && (THEME_SETTINGS as readonly string[]).includes(params.theme)) {
      const setting = params.theme as (typeof THEME_SETTINGS)[number]
      saveGlobalConfig(current => (current.theme === setting ? current : { ...current, theme: setting }))
    }

    // Provider profile — activate an existing profile, or clear to Anthropic
    // default when the value resolves to the sentinel/no selection.
    if (typeof params.provider === 'string') {
      const id = params.provider
      if (id === '' || id === ANTHROPIC_DEFAULT_PROFILE_ID) {
        clearActiveProviderProfile()
      } else {
        setActiveProviderProfile(id)
      }
    }

    // Generic settings surface — a flat map of settingId → value. Boolean
    // values toggle, enum values select; unknown ids are ignored. Reads come
    // from the same source the web panel renders, so the two stay in sync.
    if (params.settings && typeof params.settings === 'object') {
      const registry = buildConfigSettings()
      const byId = new Map(registry.map(setting => [setting.id, setting]))
      for (const [id, value] of Object.entries(params.settings as Record<string, unknown>)) {
        const setting = byId.get(id)
        if (!setting) continue
        setting.write(value)
      }
    }

    return readConfigSnapshot()
  }

  /** Persist a main-loop model choice the same way the `/model` command does. */
  function applyModelSetting(model: string | null): void {
    setProjectModelSetting(model ?? undefined)
    setMainLoopModelOverride(model)
  }

  const rl = createInterface({ input, crlfDelay: Infinity })
  rl.on('line', line => {
    if (!line.trim()) return
    let message: JsonRpcRequest
    try {
      message = JSON.parse(line) as JsonRpcRequest
    } catch {
      fail(null, -32700, 'Parse error')
      return
    }
    void handle(message).catch(error => {
      if (message.id !== undefined) fail(message.id, -32000, error instanceof Error ? error.message : String(error))
    })
  })

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    rl.close()
    // Await each session's cleanup so child MCP subprocesses are reaped before
    // the process exits — otherwise they orphan and accumulate (e.g.
    // codebase-memory, web-access plugins).
    const cleanups = [...sessions.values()].map(state => {
      state.statusUnsubscribe?.()
      return state.session.close()
    })
    sessions.clear()
    await Promise.allSettled(cleanups)
  }

  return { close }
}

if (import.meta.main) {
  const server = createAcpServer()
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write(`[acp] received ${signal}, shutting down\n`)
    try {
      await server.close()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.once('beforeExit', () => void server.close())
}
