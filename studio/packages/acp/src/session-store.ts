import { createStore, type StoreApi } from 'zustand/vanilla'
import { applySessionUpdate, emptySession } from './updates.js'
import type { PermissionRequest, SessionState } from './types.js'
import type { SessionNotification } from '@agentclientprotocol/sdk'

export type SessionStoreApi = StoreApi<SessionState> & {
  applyUpdate: (notification: SessionNotification) => void
  enqueuePermission: (request: PermissionRequest) => void
  resolvePermission: (requestId: PermissionRequest['requestId']) => void
  setStreaming: (streaming: boolean) => void
}

export function createSessionStore(
  sessionId: string,
  cwd: string,
): SessionStoreApi {
  const store = createStore<SessionState>(() => emptySession(sessionId, cwd))

  return {
    ...store,
    applyUpdate: notification => {
      store.setState(state => applySessionUpdate(state, notification))
    },
    enqueuePermission: request => {
      store.setState(state => ({
        ...state,
        permissionQueue: [
          ...state.permissionQueue,
          {
            ...request,
            questions: request.questions ?? null,
            preview: request.preview ?? null,
          },
        ],
      }))
    },
    resolvePermission: requestId => {
      store.setState(state => ({
        ...state,
        permissionQueue: state.permissionQueue.filter(
          item => item.requestId !== requestId,
        ),
      }))
    },
    setStreaming: streaming => {
      store.setState({ streaming })
    },
  }
}