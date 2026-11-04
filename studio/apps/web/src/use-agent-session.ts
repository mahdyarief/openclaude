import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectHandshake,
  createAgentConnection,
  createSessionStore,
  emptySession,
  fetchConfig,
  fetchSessionHistory,
  fetchStatus,
  patchConfig,
  type AgentConnectionHandle,
  type AgentHandshake,
  type AgentConfigPatch,
  type AgentConfigSnapshot,
  type AgentStatusSnapshot,
  type ConnectionStatus,
  type PermissionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionState,
  type SessionStoreApi,
} from '@openclaude-studio/acp'
import { buildPermissionOutcome } from './permissions-outcome.js'

export type AgentSessionOptions = {
  url: string
  token: string
  cwd: string
  sessionId?: string
  /** forwarded to `session/new`/`session/load` so the agent uses the chosen mode */
  permissionMode?: string
  /** whether this tab is visible; hidden idle tabs are allowed to soft-close */
  active?: boolean
  /** how long a hidden, finished session may keep its agent socket open */
  idleTimeoutMs?: number
}

export type SessionMode =
  | { kind: 'load'; sessionId: string }
  | { kind: 'new' }

export function sessionMode(sessionId: string | undefined): SessionMode {
  return sessionId ? { kind: 'load', sessionId } : { kind: 'new' }
}

export type IdleGateInput = {
  status: ConnectionStatus
  streaming: boolean
  /** waiting for the first chunk of a turn */
  awaiting: boolean
  /** an unanswered permission or question keeps the agent's turn open */
  permissionPending: boolean
  /** whether the tab is the visible one */
  active: boolean
}

// Soft-idle may only close the agent socket when the agent has finished acting:
// a streaming turn, an unanswered prompt, or a pending permission keep the
// connection open even if the tab was left in the background.
export function mayEnterIdle(input: IdleGateInput): boolean {
  return (
    !input.active &&
    input.status === 'ready' &&
    !input.streaming &&
    !input.awaiting &&
    !input.permissionPending
  )
}

type AgentSession = {
  state: SessionState
  status: ConnectionStatus
  error: string | null
  /** true between sending a prompt and the first streamed chunk (agent "thinking") */
  awaiting: boolean
  /** true while the stored transcript is being read back from the bridge on a load */
  loadingHistory: boolean
  /**
   * True after the user ended the session. `status` is then 'idle', which also
   * covers an automatic soft-idle; `ended` distinguishes the manual case so the
   * pane can say "session ended" instead of "asleep".
   */
  ended: boolean
  /** true while a manual reload is re-handshaking with the agent */
  reloading: boolean
  sessionId: string | null
  sendPrompt: (text: string) => void
  cancel: () => void
  /** Lazily start the session if it does not yet exist. */
  ensureSession: () => Promise<string | null>
  /** Reattach after a soft-idle or refresh a healthy connection. */
  reconnect: () => void
  /** Re-handshake from scratch (new WebSocket + fresh session handshake). */
  reload: () => void
  /** Tear down the agent connection; the tab keeps showing the last transcript. */
  disconnect: () => void
  pendingPermission: PermissionRequest | null
  /** resolve the pending permission; pass answers for `AskUserQuestion` */
  respondPermission: (optionId: string | null, answers?: Record<string, string> | null) => void
  /** Reads the agent's model/theme/provider state for the config panel. */
  getConfig: () => Promise<AgentConfigSnapshot>
  /** Applies a config patch and resolves with the refreshed snapshot. */
  setConfig: (patch: AgentConfigPatch) => Promise<AgentConfigSnapshot>
  /** Live statusline snapshot (branch, model, context, background tasks). */
  getStatus: () => Promise<AgentStatusSnapshot | null>
  /**
   * Subscribe to pushed statusline updates. Survives reconnects: the hook keeps
   * the listener set and re-binds it to each new connection. Returns an
   * unsubscribe function.
   */
  onStatus: (callback: (snapshot: AgentStatusSnapshot) => void) => () => void
}

const HANDSHAKE_TIMEOUT_MS = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function useAgentSession(options: AgentSessionOptions): AgentSession {
  const {
    url,
    token,
    cwd,
    sessionId,
    permissionMode,
    active = true,
    idleTimeoutMs = 5 * 60_000,
  } = options
  // Read at session/new and session/load time. Kept in a ref so flipping the
  // mode does not tear down a live connection mid-turn.
  const permissionModeRef = useRef(permissionMode)
  permissionModeRef.current = permissionMode
  const [state, setState] = useState<SessionState>(() => emptySession('', ''))
  // A pane that mounts hidden (restored background tab) starts asleep instead of
  // connecting, so it does not spawn a bridge agent child until it is viewed.
  const [status, setStatus] = useState<ConnectionStatus>(active ? 'connecting' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null)
  const [awaiting, setAwaiting] = useState(false)
  // True while the stored session transcript is being read back from the bridge
  // on a `session/load`. The chat area shows a loading state instead of an
  // empty transcript so the gap does not read as "no history".
  const [loadingHistory, setLoadingHistory] = useState(false)
  // Soft-idle and manual end both close the agent WebSocket while keeping the
  // transcript: `status` becomes 'idle' (asleep, not dead). `ended` marks the
  // manual case so the pane can label it "session ended" rather than "asleep".
  const [ended, setEnded] = useState(false)
  // True while a manual reload is re-establishing the handshake; the pane shows
  // an explicit "Reloading…" state so the action is never silent.
  const [reloading, setReloading] = useState(false)
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
  // Statusline subscribers live here (not on the connection) so a reconnect or
  // a fresh handshake re-binds them without the component having to re-subscribe.
  const statusListenersRef = useRef(new Set<(snapshot: AgentStatusSnapshot) => void>())
  const emitStatus = useCallback((snapshot: AgentStatusSnapshot) => {
    for (const listener of statusListenersRef.current) listener(snapshot)
  }, [])

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
    // The agent attaches `questions` for `AskUserQuestion`; the ACP type does
    // not model the extension, so read it off the raw params.
    const rawMeta = (request as unknown as { _meta?: unknown })._meta
    const rawQuestions = isRecord(rawMeta)
      ? (rawMeta as Record<string, unknown>).questions
      : undefined
    const questions = Array.isArray(rawQuestions)
      ? rawQuestions
          .filter(
            (entry): entry is Record<string, unknown> =>
              typeof entry === 'object' && entry !== null,
          )
          .map(entry => ({
            question: typeof entry.question === 'string' ? entry.question : '',
            multiSelect: entry.multiSelect === true,
            options: Array.isArray(entry.options)
              ? entry.options
                  .filter(
                    (option): option is Record<string, unknown> =>
                      typeof option === 'object' && option !== null,
                  )
                  .map(option => ({
                    label: typeof option.label === 'string' ? option.label : '',
                  }))
              : [],
          }))
          .filter(entry => entry.question.length > 0)
      : null
    const permission: PermissionRequest = {
      requestId: request.toolCall.toolCallId,
      sessionId: request.sessionId,
      toolCall: request.toolCall,
      options: request.options.map(option => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
      ...(questions && questions.length > 0 ? { questions } : {}),
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
    setEnded(false)
  }, [])

  const connect = useCallback(async () => {
    // Invalidate any previous connect run so its async result cannot write
    // into the connection this run is about to establish.
    const nonce = ++connectNonce.current
    setStatus('connecting')
    setError(null)
    updateChain.current = Promise.resolve()

    // Reattach must resume the session this hook already owns (after a soft-idle
    // or a reload), not the id the pane originally mounted with.
    const mode = sessionMode(sessionIdRef.current ?? sessionId)
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
            ...(permissionModeRef.current
              ? { permissionMode: permissionModeRef.current }
              : {}),
            onUpdate: applyUpdate,
            onPermission: requestPermission,
            onStatus: emitStatus,
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
        setLoadingHistory(true)
        try {
          // The bridge resolves session history from the session id across
          // every project dir, but the first read can still race a cold bridge
          // (a just-restored tab that opened before `byPath` finished loading).
          // Retry once before giving up so the transcript does not render blank.
          let history = await fetchSessionHistory(url, token, cwd, mode.sessionId)
          if (history.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 350))
            if (nonce === connectNonce.current) {
              history = await fetchSessionHistory(url, token, cwd, mode.sessionId)
            }
          }
          if (nonce === connectNonce.current && history.length > 0) {
            store.setState(state => ({ ...state, messages: history }))
          }
        } catch (cause) {
          // History is a nicety; a missing/unreadable file must not block the
          // live session from becoming usable.
          if (cause instanceof Error) console.warn('session history load failed:', cause.message)
        }
        if (nonce !== connectNonce.current) {
          setLoadingHistory(false)
          handle.disconnect()
          return
        }
        setLoadingHistory(false)
        adoptSession(handle.sessionId, store)
        return
      }

      // kind: 'new' — handshake only. No `session/new` happens on mount; the
      // first `ensureSession()` (triggered by the first prompt or the `/` menu)
      // creates it.
      const handshake = await Promise.race([
        connectHandshake({
          url,
          token,
          onUpdate: applyUpdate,
          onPermission: requestPermission,
          onStatus: emitStatus,
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
      // A connect that failed after starting the history read (e.g. the
      // socket died) must not leave the chat stuck on the skeleton forever.
      if (nonce === connectNonce.current) setLoadingHistory(false)
    }
  }, [url, token, cwd, sessionId, applyUpdate, requestPermission, adoptSession])

  // Close the agent socket to free the bridge child process, but keep the
  // transcript and session identity. The next prompt reattaches via `reconnect`.
  const softClose = useCallback(() => {
    handleRef.current?.disconnect()
    handleRef.current = null
    handshakeRef.current?.close()
    handshakeRef.current = null
    // Keep `sessionIdRef`: reconnect must `session/load` the same transcript,
    // not start a new empty session.
    creatingRef.current = null
    setStatus('idle')
  }, [])

  // Reattach the agent for the current session id without losing the transcript.
  // Used when a backgrounded tab is brought back, or before a prompt that needs
  // the agent after a soft-idle. Resolves once the reconnect has settled.
  const reconnect = useCallback(async (): Promise<void> => {
    if (status !== 'idle') return
    setEnded(false)
    await connect()
  }, [status, connect])

  // Full re-handshake: tear down whatever connection exists and start `connect`
  // from scratch (new WebSocket + fresh session handshake or load).
  const reload = useCallback(() => {
    connectNonce.current += 1
    handleRef.current?.disconnect()
    handleRef.current = null
    handshakeRef.current?.close()
    handshakeRef.current = null
    creatingRef.current = null
    setStatus('connecting')
    setEnded(false)
    setReloading(true)
    void connect().then(() => setReloading(false))
  }, [connect])

  // Soft-idle: a backgrounded tab whose agent has finished its turn closes its
  // socket to free the bridge child process. A streaming turn or a pending
  // permission must keep the socket — the user may have walked away mid-run and
  // the agent must keep going.
  useEffect(() => {
    if (!mayEnterIdle({
      status,
      streaming: state.streaming,
      awaiting,
      permissionPending: pendingPermission !== null,
      active,
    })) {
      return
    }
    const timer = setTimeout(softClose, idleTimeoutMs)
    return () => clearTimeout(timer)
  }, [status, state.streaming, awaiting, pendingPermission, active, idleTimeoutMs, softClose])

  // A pane that mounts hidden starts asleep (`status` is 'idle' from init) and
  // connects the first time it becomes active. The mount effect itself only runs
  // once — visibility changes must never tear the socket down while the agent is
  // still streaming; soft-idle owns that decision.
  useEffect(() => {
    mountedRef.current = true
    if (!active) return
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
    // `connect` changes when its inputs change (e.g. a real session id was
    // renamed); that legitimately re-runs the connection. `active` is read via
    // the guard below, not as a teardown trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect])

  // First activation of a hidden-mounted pane, and reattach of a soft-idled
  // session: bringing the tab back reconnects on its own so the user does not
  // have to press anything. A manually ended session stays ended until the user
  // explicitly reloads or sends a prompt.
  useEffect(() => {
    if (!active || status !== 'idle') return
    if (ended) return
    void reconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, status])

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
        const session = await Promise.race([
          handshake.startSession(cwd, permissionModeRef.current),
          timeout,
        ])

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
          onStatus: handshake.onStatus,
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
      // Show the thinking indicator immediately. On a cold session this covers
      // the delay of reattaching (reconnect) and spawning the agent child
      // (ensureSession) before the first streamed chunk arrives — otherwise the
      // pane looks frozen for a moment even though the prompt is in flight.
      setAwaiting(true)
      // A soft-idled session must reattach before the prompt can be delivered;
      // the transcript already on screen is preserved by the reconnect.
      await reconnect()
      const id = await ensureSession()
      if (!id) {
        setAwaiting(false)
        return
      }
      const handle = handleRef.current
      if (!handle) {
        setAwaiting(false)
        return
      }
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
  }, [ensureSession, reconnect])

  const cancel = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    setAwaiting(false)
    void handle.connection.agent.request('session/cancel', {
      sessionId: handle.sessionId,
    })
  }, [])

  // End the live connection but keep the tab and its transcript. Distinct from
  // soft-idle: the user asked for it, so it happens immediately rather than
  // after the idle delay, and the pane reports it as "session ended".
  const disconnect = useCallback(() => {
    connectNonce.current += 1
    handleRef.current?.disconnect()
    handleRef.current = null
    handshakeRef.current?.close()
    handshakeRef.current = null
    // Keep `sessionIdRef` so "reload" can resume this same transcript.
    creatingRef.current = null
    setAwaiting(false)
    setReloading(false)
    setStatus('idle')
    setEnded(true)
  }, [])

  // A loaded session only keeps a handle (no handshake), while a fresh session
  // keeps both. Prefer the handshake and fall back to the handle's connection.
  const getConfig = useCallback(async () => {
    const handshake = handshakeRef.current
    if (handshake) return handshake.fetchConfig()
    const handle = handleRef.current
    if (handle) return fetchConfig(handle.connection)
    throw new Error('Not connected')
  }, [])

  const setConfig = useCallback(async (patch: AgentConfigPatch) => {
    const handshake = handshakeRef.current
    if (handshake) return handshake.patchConfig(patch)
    const handle = handleRef.current
    if (handle) return patchConfig(handle.connection, patch)
    throw new Error('Not connected')
  }, [])

  // The status method needs a live session id: a handshake-only connection has
  // not created one yet, so there is nothing to report until the first prompt.
  const getStatus = useCallback(async (): Promise<AgentStatusSnapshot | null> => {
    const id = sessionIdRef.current
    if (!id) return null
    const handshake = handshakeRef.current
    if (handshake) return handshake.fetchStatus(id)
    const handle = handleRef.current
    if (handle) return fetchStatus(handle.connection, id)
    return null
  }, [])

  const respondPermission = useCallback(
    (optionId: string | null, answers?: Record<string, string> | null) => {
      const resolve = permissionResolver.current
      if (!resolve) return
      permissionResolver.current = null
      setPendingPermission(null)
      resolve(buildPermissionOutcome(optionId, answers))
    },
    [],
  )

  // Subscribe to pushed statusline updates. The listener is kept in the hook's
  // set and re-bound to every connection, so reconnects are invisible to the
  // subscriber. Callers no longer need to poll.
  const onStatus = useCallback(
    (callback: (snapshot: AgentStatusSnapshot) => void) => {
      statusListenersRef.current.add(callback)
      return () => {
        statusListenersRef.current.delete(callback)
      }
    },
    [],
  )

  return {
    state,
    status,
    error,
    awaiting,
    loadingHistory,
    ended,
    reloading,
    sessionId: activeSessionId,
    sendPrompt,
    cancel,
    ensureSession,
    reconnect,
    reload,
    disconnect,
    pendingPermission,
    respondPermission,
    getConfig,
    setConfig,
    getStatus,
    onStatus,
  }
}
