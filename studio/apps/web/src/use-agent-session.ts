import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectHandshake,
  createAgentConnection,
  createSessionStore,
  emptySession,
  fetchSessionHistory,
  type AgentConnectionHandle,
  type AgentHandshake,
  type ConnectionStatus,
  type PermissionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionState,
  type SessionStoreApi,
} from '@openclaude-studio/acp'

export type AgentSessionOptions = {
  url: string
  token: string
  cwd: string
  sessionId?: string
}

export type SessionMode =
  | { kind: 'load'; sessionId: string }
  | { kind: 'new' }

export function sessionMode(sessionId: string | undefined): SessionMode {
  return sessionId ? { kind: 'load', sessionId } : { kind: 'new' }
}

type AgentSession = {
  state: SessionState
  status: ConnectionStatus
  error: string | null
  /** true between sending a prompt and the first streamed chunk (agent "thinking") */
  awaiting: boolean
  sessionId: string | null
  sendPrompt: (text: string) => void
  cancel: () => void
  ensureSession: () => Promise<string | null>
  pendingPermission: PermissionRequest | null
  respondPermission: (optionId: string | null) => void
}

const HANDSHAKE_TIMEOUT_MS = 10000

export function useAgentSession(options: AgentSessionOptions): AgentSession {
  const { url, token, cwd, sessionId } = options
  const [state, setState] = useState<SessionState>(() => emptySession('', ''))
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null)
  const [awaiting, setAwaiting] = useState(false)

  const handleRef = useRef<AgentConnectionHandle | null>(null)
  const handshakeRef = useRef<AgentHandshake | null>(null)
  // Guards against a stale (already-finished) handshake's `connect` resolving
  // into a fresh connection after the effect re-ran with new options.
  const connectNonce = useRef(0)
  // Guards against `ensureSession`'s in-flight `startSession` resolving after
  // unmount, re-populating refs and calling setState on a dead tree.
  const mountedRef = useRef(true)
  // The store is owned by the hook, not the handle, so the update/permission
  // callbacks can route to whichever session is current.
  const storeRef = useRef<SessionStoreApi | null>(null)
  // One promise chain per session enforces arrival order for updates.
  const updateChain = useRef<Promise<void>>(Promise.resolve())
  // The resolver that hands the user's decision back to the pending permission.
  const permissionResolver = useRef<((response: RequestPermissionResponse) => void) | null>(null)
  // Synchronous mirror of the live session id for idempotent ensureSession().
  const sessionIdRef = useRef<string | null>(sessionId ?? null)
  // In-flight session creation, so concurrent ensureSession() calls share one.
  const creatingRef = useRef<Promise<string | null> | null>(null)

  const applyUpdate = useCallback((notification: SessionNotification) => {
    updateChain.current = updateChain.current
      .then(() => {
        const store = storeRef.current
        if (!store) return
        store.applyUpdate(notification)
        // Any streamed output means the agent has started responding.
        const kind = notification.update.sessionUpdate
        if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk' || kind === 'tool_call') {
          setAwaiting(false)
        }
        setState(store.getState())
      })
      // A malformed update must not poison the chain: the turn-end reset in
      // `sendPrompt` is queued behind it and would never run.
      .catch(() => {})
  }, [])

  const requestPermission = useCallback(async (request: RequestPermissionRequest) => {
    const store = storeRef.current
    const permission: PermissionRequest = {
      requestId: request.toolCall.toolCallId,
      sessionId: request.sessionId,
      toolCall: request.toolCall,
      options: request.options.map(option => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    }
    store?.enqueuePermission(permission)
    if (store) setState(store.getState())
    setPendingPermission(permission)
    return new Promise<RequestPermissionResponse>(resolve => {
      permissionResolver.current = resolve
    })
  }, [])

  const adoptSession = useCallback((id: string, nextStore: SessionStoreApi) => {
    storeRef.current = nextStore
    sessionIdRef.current = id
    setActiveSessionId(id)
    setState(nextStore.getState())
    setStatus('ready')
  }, [])

  const connect = useCallback(async () => {
    // Invalidate any previous connect run so its async result cannot write
    // into the connection this run is about to establish.
    const nonce = ++connectNonce.current
    setStatus('connecting')
    setError(null)
    updateChain.current = Promise.resolve()

    const mode = sessionMode(sessionId)
    const store = createSessionStore(
      mode.kind === 'load' ? mode.sessionId : '',
      cwd,
    )
    storeRef.current = store

    // The bridge never rejects a hung socket, so without a timeout a bad
    // host/port (e.g. ws://127.0.0.1 when accessed remotely) hangs forever on
    // "Connecting…". Race the handshake so the failure surfaces.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Connection to ${url} timed out`)),
          HANDSHAKE_TIMEOUT_MS,
        )
      })

      if (mode.kind === 'load') {
        // Resume the existing session. `createAgentConnection` performs the
        // handshake and `session/load`; it never calls `session/new`.
        const handle = await Promise.race([
          createAgentConnection({
            url,
            token,
            cwd,
            sessionId: mode.sessionId,
            onUpdate: applyUpdate,
            onPermission: requestPermission,
          }),
          timeout,
        ])
        if (nonce !== connectNonce.current) {
          handle.disconnect()
          return
        }
        handleRef.current = handle
        // `session/load` resumes the agent's context but ACP does not replay
        // prior messages, so the transcript would stay empty. Read the JSONL
        // from the bridge and seed the store before adopting it.
        try {
          const history = await fetchSessionHistory(url, token, cwd, mode.sessionId)
          if (nonce === connectNonce.current && history.length > 0) {
            store.setState(state => ({ ...state, messages: history }))
          }
        } catch {
          // History is a nicety; a missing/unreadable file must not block the
          // live session from becoming usable.
        }
        if (nonce !== connectNonce.current) {
          handle.disconnect()
          return
        }
        adoptSession(handle.sessionId, store)
        return
      }

      // kind: 'new' — handshake only. No `session/new` happens on mount; the
      // first `ensureSession()` (triggered by the first prompt) creates it.
      const handshake = await Promise.race([
        connectHandshake({
          url,
          token,
          onUpdate: applyUpdate,
          onPermission: requestPermission,
        }),
        timeout,
      ])
      handshakeRef.current = handshake
      if (nonce !== connectNonce.current) {
        handshake.close()
        handshakeRef.current = null
        return
      }
      sessionIdRef.current = null
      setActiveSessionId(null)
      setState(store.getState())
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('dead')
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, [url, token, cwd, sessionId, applyUpdate, requestPermission, adoptSession])

  useEffect(() => {
    mountedRef.current = true
    void connect()
    return () => {
      mountedRef.current = false
      // Invalidate the in-flight connect so a late handshake cannot adopt
      // itself into this now-dead component.
      connectNonce.current += 1
      handleRef.current?.disconnect()
      handleRef.current = null
      handshakeRef.current?.close()
      handshakeRef.current = null
      creatingRef.current = null
    }
  }, [connect])

  // Lazily start a new session. Idempotent: if a session id already exists
  // (loaded or previously created) it is returned without another call, and
  // concurrent calls share the same in-flight creation.
  const ensureSession = useCallback((): Promise<string | null> => {
    const existing = sessionIdRef.current
    if (existing) return Promise.resolve(existing)

    if (creatingRef.current) return creatingRef.current

    const handshake = handshakeRef.current
    if (!handshake) return Promise.resolve(null)

    // Capture the connection generation at creation time. If `connect` re-runs
    // while `session/new` is in flight, this promise's result belongs to a
    // connection the hook no longer owns.
    const nonce = connectNonce.current

    const creation = (async (): Promise<string | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Connection to ${url} timed out`)),
            HANDSHAKE_TIMEOUT_MS,
          )
        })

        // Reuse the already-initialized connection to run `session/new`.
        const session = await Promise.race([handshake.startSession(cwd), timeout])

        if (!mountedRef.current || nonce !== connectNonce.current) {
          // Resolved after unmount or a newer connect: tear down the orphan.
          handshake.close()
          return null
        }

        const store = createSessionStore(session.sessionId, cwd)
        handleRef.current = {
          connection: handshake.connection,
          session,
          sessionId: session.sessionId,
          agentInfo: handshake.agentInfo,
          disconnect: () => handshake.connection.close(),
        }
        adoptSession(session.sessionId, store)
        return session.sessionId
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setStatus('dead')
        // Session creation failed: close the half-open handshake so a retry
        // starts clean and `ensureSession` can recover via the ready state.
        handshake.close()
        handshakeRef.current = null
        return null
      } finally {
        if (timer) clearTimeout(timer)
        creatingRef.current = null
      }
    })()

    creatingRef.current = creation
    return creation
  }, [url, cwd, adoptSession, connectNonce])

  const sendPrompt = useCallback((text: string) => {
    void (async () => {
      const id = await ensureSession()
      if (!id) return
      const handle = handleRef.current
      if (!handle) return
      // Optimistic message: ACP streams the user's text only as a
      // `user_message_chunk` that may never arrive for a loaded session, so
      // the draft must show in the transcript immediately.
      const store = storeRef.current
      if (store) {
        // Clear the previous turn's stop label; otherwise "Stopped: Finished"
        // stays visible under the thinking indicator of the new turn.
        store.setState(state => ({
          ...state,
          stopReason: null,
          messages: [
            ...state.messages,
            { id: `optimistic-${Date.now()}`, role: 'user', parts: [{ kind: 'text', text }] },
          ],
        }))
        setState(store.getState())
      }
      setAwaiting(true)
      void handle.session
        .prompt(text)
        .then(response => {
          // The turn is over. `session/prompt` resolves once the turn ends, but
          // its final `session/update` notifications may still be queued, so
          // clear `streaming` only after the update chain has drained.
          updateChain.current = updateChain.current
            .then(() => {
              const store = storeRef.current
              if (!store) return
              store.setStreaming(false)
              store.setState(state => ({ ...state, stopReason: response.stopReason }))
              setState(store.getState())
              setAwaiting(false)
            })
            .catch(() => {})
        })
        .catch(cause => {
          updateChain.current = updateChain.current
            .then(() => {
              const store = storeRef.current
              if (!store) return
              store.setStreaming(false)
              setState(store.getState())
              setAwaiting(false)
            })
            .catch(() => {})
          setError(cause instanceof Error ? cause.message : String(cause))
        })
    })()
  }, [ensureSession])

  const cancel = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    setAwaiting(false)
    void handle.connection.agent.request('session/cancel', {
      sessionId: handle.sessionId,
    })
  }, [])

  const respondPermission = useCallback((optionId: string | null) => {
    const resolve = permissionResolver.current
    if (!resolve) return
    permissionResolver.current = null
    setPendingPermission(null)
    resolve(
      optionId
        ? { outcome: { outcome: 'selected', optionId } }
        : { outcome: { outcome: 'cancelled' } },
    )
  }, [])

  return {
    state,
    status,
    error,
    awaiting,
    sessionId: activeSessionId,
    sendPrompt,
    cancel,
    ensureSession,
    pendingPermission,
    respondPermission,
  }
}
