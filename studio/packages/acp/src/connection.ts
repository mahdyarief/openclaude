import {
  client,
  CLIENT_METHODS,
  AGENT_METHODS,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientConnection,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ContentBlock,
  type PromptResponse,
  type SendRequestOptions,
  type ClientApp,
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'

export type AgentConnectionOptions = {
  url: string
  token: string
  cwd: string
  onUpdate: (notification: SessionNotification) => void
  onPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  /**
   * Fired when the agent pushes a live statusline snapshot
   * (`openclaude/status_update` notification). Call it instead of polling.
   */
  onStatus?: (snapshot: AgentStatusSnapshot) => void
  /**
   * When provided, the connection loads an existing session with this id
   * (via `session/load`) instead of starting a brand new one (`session/new`).
   */
  sessionId?: string
  /** how much the agent may act without asking; forwarded to the ACP session */
  permissionMode?: string
}

/**
 * The surface of {@link ActiveSession} that the app actually consumes. The SDK's
 * real `ActiveSession` (new-session path) satisfies it, and so does the small
 * adapter we build for a loaded session. The SDK exposes no public way to
 * construct an `ActiveSession` around a loaded session (its constructor and
 * `attachSession` are private), so we reuse the connection for `session/prompt`
 * with a minimal adapter to keep `handle.session` a single stable type.
 */
export type ActiveSessionLike = {
  sessionId: string
  prompt: (
    prompt: string | ContentBlock | Array<ContentBlock>,
    options?: SendRequestOptions,
  ) => Promise<PromptResponse>
  /**
   * Reads the next update or stop message. No-op for a loaded session: the
   * app drives updates via `handle.onUpdate`, not the SDK session stream.
   */
  nextUpdate: () => Promise<unknown>
  /**
   * Reads text chunks until the current prompt turn stops. No-op for a loaded
   * session (resumed sessions have no in-flight turn to stream).
   */
  readText: () => Promise<string>
  /**
   * Stops routing updates to the session helper. No-op for a loaded session:
   * we never start the SDK's session stream, so there is nothing to tear down.
   */
  dispose: () => void
}

export type AgentConnectionHandle = {
  connection: ClientConnection
  session: ActiveSessionLike
  sessionId: string
  agentInfo: InitializeResponse
  disconnect: () => void
  /**
   * Subscribe to pushed statusline updates for this session. Returns a
   * function that unsubscribes. The `openclaude/status_update` notification is
   * registered automatically by the connection; this only toggles the local
   * callback so components can mount/unmount without re-handshaking.
   */
  onStatus: (callback: (snapshot: AgentStatusSnapshot) => void) => () => void
}

/**
 * Open the token-gated WebSocket and answer `initialize`, returning the live
 * {@link ClientConnection} **without** starting or loading any session. This is
 * the handshake-only path the web app uses on mount so that a project-first
 * session is never created (and an empty `.jsonl` never written) until the user
 * sends the first prompt.
 *
 * The caller owns the connection and must call `connection.close()` to tear it
 * down. `createAgentConnection` (with `sessionId`) is the equivalent that also
 * performs `session/load`.
 */
export type AgentHandshake = {
  connection: ClientConnection
  agentInfo: InitializeResponse
  /**
   * Starts a brand-new session on the already-initialized connection. Call this
   * lazily so no `session/new` (and no empty session file) happens until the
   * first prompt.
   */
  startSession: (cwd: string, permissionMode?: string) => Promise<ActiveSessionLike>
  /** Reads model/theme/provider state for the studio's config panels. */
  fetchConfig: () => Promise<AgentConfigSnapshot>
  /** Applies a config change and returns the refreshed snapshot. */
  patchConfig: (patch: AgentConfigPatch) => Promise<AgentConfigSnapshot>
  /** Reads the live statusline snapshot (branch, model, context, tasks). */
  fetchStatus: (sessionId: string) => Promise<AgentStatusSnapshot>
  /**
   * Subscribe to pushed statusline updates. Returns an unsubscribe function.
   * The agent emits one immediately after `session/new`/`session/load`, then
   * on every AppState change, so callers never need to poll.
   */
  onStatus: (callback: (snapshot: AgentStatusSnapshot) => void) => () => void
  close: () => void
}

/**
 * The agent-side config surface exposed by the custom `openclaude/config` ACP
 * method. Terminal slash commands (`/model`, `/theme`, `/provider`, `/config`)
 * render Ink UI and are no-ops over ACP, so the web composer renders these.
 */
export type AgentConfigSnapshot = {
  model: {
    active: string | null
    options: Array<{
      value: string
      label: string
      description?: string
      switchToProfileId?: string
    }>
  }
  theme: {
    active: string
    options: string[]
  }
  provider: {
    activeId: string | null
    profiles: Array<{
      id: string
      name: string
      provider?: string
      model?: string
      baseUrl?: string
    }>
  }
  /** The full agent settings surface rendered by `/config`. */
  settings: AgentSetting[]
}

export type AgentSetting = {
  id: string
  type: 'boolean' | 'enum'
  label: string
  description: string
  /** Present for enum settings. */
  options?: string[]
  /** Current value; booleans are true/false, enums are strings. */
  value: unknown
}

export type AgentConfigPatch = {
  model?: string
  theme?: string
  provider?: string
  /** Flat map of setting id → new value. */
  settings?: Record<string, unknown>
}

/**
 * The terminal statusline data, exposed by the custom `openclaude/status` ACP
 * method so Studio can render the same live info (branch, model, context,
 * background tasks) as badges. Kept as a deliberate subset of the agent's
 * `StatusSnapshot` — see `src/utils/statusLineSnapshot.ts`.
 */
export type AgentStatusSnapshot = {
  model: { id: string; displayName: string }
  branch: string | null
  worktree: { name: string | null; path: string | null; branch: string | null } | null
  permissionMode: string
  /** Active reasoning/effort level shown by the terminal statusline. */
  effort: string | null
  /** Custom plugin statusline content (e.g. Oh-my-Claude HUD / graft HUD). */
  statusLineText: string | null
  contextWindow: { usedPercent: number; tokens: number; size: number } | null
  session: { name: string | null; costUsd: number; durationMs: number }
  backgroundTasks: { total: number; running: number; labels: string[] }
}

const CONFIG_METHOD = 'openclaude/config'
const STATUS_METHOD = 'openclaude/status'

const STATUS_UPDATE_METHOD = 'openclaude/status_update'

/** Params of the custom `openclaude/status_update` notification. */
type StatusUpdateParams = {
  sessionId?: string
  status: AgentStatusSnapshot
}

type HandlerOptions = Pick<
  AgentConnectionOptions,
  'onUpdate' | 'onPermission' | 'onStatus'
>

type ClientHandlers = {
  /** Mutations to this callback are observed by the registered status handler. */
  statusCallback: { current: ((snapshot: AgentStatusSnapshot) => void) | null }
}

/**
 * The client-capabilities flag and the fs handlers live in one place so the
 * agent can never be told "fs supported" when no handler is installed.
 * Implementing an fs method in M5 means flipping its flag here.
 */
const FS_CAPABILITIES = { readTextFile: false, writeTextFile: false } as const

// The notice/compaction handlers live in updates.ts rather than here, but the
// capability must be advertised from the same handshake so the agent never
// emits these kinds to a client that would drop them.
const SESSION_CAPABILITIES = { notices: {}, compaction: {} } as const

function registerHandlers(
  app: ClientApp,
  options: HandlerOptions,
  handlers: ClientHandlers,
): ClientApp {
  return app
    .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
      options.onUpdate(params)
    })
    .onNotification(
      STATUS_UPDATE_METHOD,
      params => params as StatusUpdateParams,
      ({ params }) => {
        const cb = handlers.statusCallback.current ?? options.onStatus
        if (cb) {
          cb(params.status)
        }
      },
    )
    .onRequest(CLIENT_METHODS.session_request_permission, ({ params }) =>
      options.onPermission(params),
    )
    .onRequest(CLIENT_METHODS.fs_read_text_file, () => {
      throw new Error('fs/read_text_file is not implemented yet')
    })
    .onRequest(CLIENT_METHODS.fs_write_text_file, () => {
      throw new Error('fs/write_text_file is not implemented yet')
    })
}

function initializeConnection(connection: ClientConnection): Promise<InitializeResponse> {
  return connection.agent.request(AGENT_METHODS.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { ...FS_CAPABILITIES },
      session: { ...SESSION_CAPABILITIES },
    },
    clientInfo: { name: 'openclaude-studio', version: '0.0.0' },
  }) as Promise<InitializeResponse>
}

function subscribeStatus(
  handlers: ClientHandlers,
  callback: (snapshot: AgentStatusSnapshot) => void,
): () => void {
  handlers.statusCallback.current = callback
  return () => {
    if (handlers.statusCallback.current === callback) {
      handlers.statusCallback.current = null
    }
  }
}

export async function connectHandshake(
  options: Pick<AgentConnectionOptions, 'url' | 'token' | 'onUpdate' | 'onPermission' | 'onStatus'>,
): Promise<AgentHandshake> {
  const stream = createWebSocketStream(bridgeSocketUrl(options.url, options.token))
  const handlers: ClientHandlers = { statusCallback: { current: null } }
  const app = registerHandlers(client({ name: 'openclaude-studio' }), options, handlers)
  const connection = app.connect(stream)
  const agentInfo = await initializeConnection(connection)

  return {
    connection,
    agentInfo,
    startSession: async (cwd: string, permissionMode?: string) => {
      const session = await connection.agent
        .buildSession({
          cwd,
          mcpServers: [],
          ...(permissionMode ? { _meta: { permissionMode } } : {}),
        })
        .start()
      const sessionLike: ActiveSessionLike = session
      return sessionLike
    },
    fetchConfig: () => fetchConfig(connection),
    fetchStatus: sessionId => fetchStatus(connection, sessionId),
    patchConfig: patch => patchConfig(connection, patch),
    onStatus: callback => subscribeStatus(handlers, callback),
    close: () => connection.close(),
  }
}

/** Read the config snapshot the studio panels render. */
export async function fetchConfig(connection: ClientConnection): Promise<AgentConfigSnapshot> {
  return connection.agent.request(CONFIG_METHOD, {}) as Promise<AgentConfigSnapshot>
}

/** Apply a config change; the response is the post-write snapshot. */
export async function patchConfig(
  connection: ClientConnection,
  patch: AgentConfigPatch,
): Promise<AgentConfigSnapshot> {
  return connection.agent.request(CONFIG_METHOD, {
    mode: 'set',
    ...patch,
  }) as Promise<AgentConfigSnapshot>
}

/** Read the live statusline snapshot for a session. */
export async function fetchStatus(
  connection: ClientConnection,
  sessionId: string,
): Promise<AgentStatusSnapshot> {
  return connection.agent.request(STATUS_METHOD, {
    sessionId,
  }) as Promise<AgentStatusSnapshot>
}

export function bridgeSocketUrl(url: string, token: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(token)}`
}

// Mirrors ActiveSession.prompt: a plain string becomes a single text block, a
// single block is wrapped in an array, arrays pass through unchanged.
function toContentBlocks(
  prompt: string | ContentBlock | Array<ContentBlock>,
): Array<ContentBlock> {
  if (typeof prompt === 'string') return [{ type: 'text', text: prompt }]
  if (Array.isArray(prompt)) return prompt
  return [prompt]
}

// The SDK client does not send `initialize` for you: buildSession().start()
// sends session/new directly, and the agent rejects it with -32600 until
// initialize has been answered. So the wrapper sends initialize first.
export async function createAgentConnection(
  options: AgentConnectionOptions,
): Promise<AgentConnectionHandle> {
  const stream = createWebSocketStream(bridgeSocketUrl(options.url, options.token))
  const handlers: ClientHandlers = { statusCallback: { current: null } }
  const app = registerHandlers(client({ name: 'openclaude-studio' }), options, handlers)
  const connection = app.connect(stream)
  const agentInfo = await initializeConnection(connection)

  // When a sessionId is supplied, resume the existing session via `session/load`
  // instead of creating a new one. The SDK exposes no public way to build an
  // ActiveSession around a loaded session, so we reuse the connection for
  // `session/prompt` with a minimal adapter whose shape matches the app's usage.
  if (options.sessionId) {
    const sessionId = options.sessionId
    await connection.agent.request(AGENT_METHODS.session_load, {
      cwd: options.cwd,
      mcpServers: [],
      sessionId,
      ...(options.permissionMode ? { _meta: { permissionMode: options.permissionMode } } : {}),
    })
    const session: ActiveSessionLike = {
      sessionId,
      prompt: (prompt, promptOptions) =>
        connection.agent.request(
          AGENT_METHODS.session_prompt,
          { sessionId, prompt: toContentBlocks(prompt) },
          promptOptions,
        ),
      nextUpdate: () => Promise.resolve(undefined),
      readText: () => Promise.resolve(''),
      dispose: () => {},
    }
    return {
      connection,
      session,
      sessionId,
      agentInfo,
      onStatus: callback => subscribeStatus(handlers, callback),
      disconnect: () => connection.close(),
    }
  }

  const session = await connection.agent
    .buildSession({
      cwd: options.cwd,
      mcpServers: [],
      ...(options.permissionMode
        ? { _meta: { permissionMode: options.permissionMode } }
        : {}),
    })
    .start()
  // Assigning the real `ActiveSession` to `ActiveSessionLike` performs the
  // structural check at compile time; no `unknown` cast is needed.
  const sessionLike: ActiveSessionLike = session

  return {
    connection,
    session: sessionLike,
    sessionId: sessionLike.sessionId,
    agentInfo,
    onStatus: callback => subscribeStatus(handlers, callback),
    disconnect: () => connection.close(),
  }
}
