import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectHandshake,
  createAgentConnection,
  createSessionStore,
  emptySession,
  fetchConfig,
  fetchSessionHistory,
  patchConfig,
  type AgentConnectionHandle,
  type AgentHandshake,
  type AgentConfigPatch,
  type AgentConfigSnapshot,
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
  /** true while the stored transcript is being read back from the bridge on a load */
  loadingHistory: boolean
  sessionId: string | null
  sendPrompt: (text: string) => void
  cancel: () => void
  ensureSession: () => Promise<string | null>
  pendingPermission: PermissionRequest | null
  /** resolve the pending permission; pass answers for `AskUserQuestion` */
  respondPermission: (optionId: string | null, answers?: Record<string, string> | null) => void
  /** Reads the agent's model/theme/provider state for the config panel. */
  getConfig: () => Promise<AgentConfigSnapshot>
  /** Applies a config patch and resolves with the refreshed snapshot. */
  setConfig: (patch: AgentConfigPatch) => Promise<AgentConfigSnapshot>
}

const HANDSHAKE_TIMEOUT_MS = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function useAgentSession(options: AgentSessionOptions): AgentSession {
  const { url, token, cwd, sessionId, permissionMode } = options
  // Read at session/new and session/load time. Kept in a ref so flipping the
  // mode does not tear down a live connection mid-turn.
  const permissionModeRef = useRef(permissionMode)
  permissionModeRef.current = permissionMode
  const [state, setState] = useState<SessionState>(() => emptySession('', ''))
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null)
  const [awaiting, setAwaiting] = useState(false)
  // True while the stored session transcript is being read back from the bridge
  // on a `session/load`. The chat area shows a loading state instead of an
  // empty transcript so the gap does not read as "no history".
  const [loadingHistory, setLoadingHistory] = useState(false)

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
            ...(permissionModeRef.current
              ? { permissionMode: permissionModeRef.current }
              : {}),
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

  return {
    state,
    status,
    error,
    awaiting,
    loadingHistory,
    sessionId: activeSessionId,
    sendPrompt,
    cancel,
    ensureSession,
    pendingPermission,
    respondPermission,
    getConfig,
    setConfig,
  }
}
