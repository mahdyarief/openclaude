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

function toolUpdate(message: SDKMessage): Record<string, unknown> | null {
  if (message.type !== 'assistant' || !Array.isArray(message.message.content)) return null
  const tool = message.message.content.find(
    block => isRecord(block) && block.type === 'tool_use' && typeof block.id === 'string',
  )
  if (!isRecord(tool)) return null

  return {
    sessionUpdate: 'tool_call',
    toolCallId: tool.id,
    title: typeof tool.name === 'string' ? tool.name : 'OpenClaude tool',
    kind: 'other',
    status: 'in_progress',
    rawInput: isRecord(tool.input) ? tool.input : {},
  }
}

export function createAcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): { close: () => void } {
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

  const requestPermission = (
    sessionId: string,
    session: SDKSession,
    message: SDKPermissionRequestMessage,
  ): void => {
    const id = nextRequestId++
    pendingRequests.set(id, result => {
      session.respondToPermission(message.tool_use_id, resolvePermission(result))
    })

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
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
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
            const tool = toolUpdate(sdkMessage)
            if (tool) notify('session/update', { sessionId, update: tool })
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

    if (message.id !== undefined) fail(message.id, -32601, `Method not found: ${message.method}`)
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

  const close = (): void => {
    rl.close()
    for (const state of sessions.values()) state.session.close()
    sessions.clear()
  }

  return { close }
}

if (import.meta.main) {
  createAcpServer()
}
