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
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'

export type AgentConnectionOptions = {
  url: string
  token: string
  cwd: string
  onUpdate: (notification: SessionNotification) => void
  onPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  /**
   * When provided, the connection loads an existing session with this id
   * (via `session/load`) instead of starting a brand new one (`session/new`).
   */
  sessionId?: string
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
  startSession: (cwd: string) => Promise<ActiveSessionLike>
  close: () => void
}

export async function connectHandshake(
  options: Pick<AgentConnectionOptions, 'url' | 'token' | 'onUpdate' | 'onPermission'>,
): Promise<AgentHandshake> {
  const stream = createWebSocketStream(bridgeSocketUrl(options.url, options.token))
  const app = client({ name: 'openclaude-studio' })
    .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
      options.onUpdate(params)
    })
    .onRequest(CLIENT_METHODS.session_request_permission, ({ params }) =>
      options.onPermission(params),
    )
    .onRequest(CLIENT_METHODS.fs_read_text_file, () => {
      throw new Error('fs/read_text_file is not implemented yet')
    })
    .onRequest(CLIENT_METHODS.fs_write_text_file, () => {
      throw new Error('fs/write_text_file is not implemented yet')
    })

  const connection = app.connect(stream)
  const agentInfo = await connection.agent.request(AGENT_METHODS.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'openclaude-studio', version: '0.0.0' },
  })

  return {
    connection,
    agentInfo,
    startSession: async (cwd: string) => {
      const session = await connection.agent.buildSession(cwd).start()
      const sessionLike: ActiveSessionLike = session
      return sessionLike
    },
    close: () => connection.close(),
  }
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
  const app = client({ name: 'openclaude-studio' })
    .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
      options.onUpdate(params)
    })
    .onRequest(CLIENT_METHODS.session_request_permission, ({ params }) =>
      options.onPermission(params),
    )
    .onRequest(CLIENT_METHODS.fs_read_text_file, () => {
      throw new Error('fs/read_text_file is not implemented yet')
    })
    .onRequest(CLIENT_METHODS.fs_write_text_file, () => {
      throw new Error('fs/write_text_file is not implemented yet')
    })

  const connection = app.connect(stream)
  const agentInfo = await connection.agent.request(AGENT_METHODS.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'openclaude-studio', version: '0.0.0' },
  })

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
      disconnect: () => connection.close(),
    }
  }

  const session = await connection.agent.buildSession(options.cwd).start()
  // Assigning the real `ActiveSession` to `ActiveSessionLike` performs the
  // structural check at compile time; no `unknown` cast is needed.
  const sessionLike: ActiveSessionLike = session

  return {
    connection,
    session: sessionLike,
    sessionId: sessionLike.sessionId,
    agentInfo,
    disconnect: () => connection.close(),
  }
}
