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

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

// Every tool_use opens a tool_call and every tool_result closes it with a
// tool_call_update. Without the closing update the client never learns a tool
// finished and only sees its result after reloading history from disk.
export function toolUpdates(message: SDKMessage): Array<Record<string, unknown>> {
  if (message.type !== 'assistant' && message.type !== 'user') return []
  const content = (message.message as { content?: unknown }).content
  if (!Array.isArray(content)) return []

  if (message.type === 'assistant') {
    return content
      .filter(isRecord)
      .filter(block => block.type === 'tool_use' && typeof block.id === 'string')
      .map(tool => ({
        sessionUpdate: 'tool_call',
        toolCallId: tool.id,
        title: typeof tool.name === 'string' ? tool.name : 'OpenClaude tool',
        kind: 'other',
        status: 'in_progress',
        rawInput: isRecord(tool.input) ? tool.input : {},
      }))
  }

  return content
    .filter(isRecord)
    .filter(block => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
    .map(result => {
      const text = toolResultText(result.content)
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: result.tool_use_id,
        status: result.is_error === true ? 'failed' : 'completed',
        ...(text ? { content: [{ type: 'content', content: { type: 'text', text } }] } : {}),
        rawOutput: result.content ?? null,
      }
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

  /**
   * Tell the client which slash commands this session supports so a remote
   * composer can offer a `/` menu from the real registry instead of a
   * hardcoded list. Command discovery is filesystem-backed (skills, plugins,
   * project commands), so a failure must not break session creation.
   */
  const advertiseCommands = async (sessionId: string, cwd: string): Promise<void> => {
    try {
      const commands = await getCommands(cwd)
      notify('session/update', {
        sessionId,
        update: {
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
        },
      })
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
    const emit = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      timer = setTimeout(() => {
        timer = null
        void (async () => {
          try {
            notify('openclaude/status_update', {
              sessionId,
              status: await buildStatusSnapshot(state.session.getAppState(), state.session.getMessages()),
            })
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
          kind: 'other',
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

    if (message.method === 'initialize') {
      if (message.id === undefined) return
      respond(message.id, {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
        },
        agentInfo: ACP_AGENT_INFO,
      })
      return
    }

    if (!initialized) {
      if (message.id !== undefined) fail(message.id, -32002, 'initialize must be called first')
      return
    }

    if (message.method === 'session/new') {
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
      subscribeSessionStatus(sessions.get(session.sessionId)!)
      return
    }

    if (message.method === 'session/load') {
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
      subscribeSessionStatus(sessions.get(sessionId)!)
      return
    }

    if (message.method === 'session/cancel') {
      const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : ''
      const state = sessions.get(sessionId)
      if (state) state.session.interrupt()
      if (message.id !== undefined) respond(message.id, {})
      return
    }

    if (message.method === 'session/prompt') {
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
              notify('session/update', {
                sessionId,
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
              })
            }
            for (const update of toolUpdates(sdkMessage)) {
              notify('session/update', { sessionId, update })
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
      return
    }

    if (message.method === 'openclaude/config') {
      const params = isRecord(message.params) ? message.params : {}
      const mode = typeof params.mode === 'string' ? params.mode : 'get'
      if (mode === 'set') {
        if (message.id === undefined) return
        respond(message.id, await applyConfigPatch(params))
        return
      }
      if (message.id === undefined) return
      respond(message.id, readConfigSnapshot())
      return
    }

    if (message.method === 'openclaude/status') {
      if (message.id === undefined) return
      const sessionId = typeof message.params?.sessionId === 'string' ? message.params.sessionId : ''
      const state = sessions.get(sessionId)
      if (!state) {
        fail(message.id, -32004, `Unknown session: ${sessionId}`)
        return
      }
      respond(message.id, await buildStatusSnapshot(state.session.getAppState(), state.session.getMessages()))
      return
    }

    if (message.id !== undefined) fail(message.id, -32601, `Method not found: ${message.method}`)
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
