import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ConnectionState, ConnectionStatus } from './types.js'

export type ConnectionStoreApi = StoreApi<ConnectionState> & {
  setStatus: (status: ConnectionStatus) => void
  setAgentInfo: (info: {
    name: string
    version: string
    protocolVersion: number
    loadSession: boolean
  }) => void
  setError: (error: string | null) => void
}

const initial: ConnectionState = {
  status: 'idle',
  agentName: null,
  agentVersion: null,
  protocolVersion: null,
  loadSessionSupported: false,
  error: null,
}

export function createConnectionStore(): ConnectionStoreApi {
  const store = createStore<ConnectionState>(() => initial)

  return {
    ...store,
    setStatus: status => store.setState({ status }),
    setAgentInfo: info =>
      store.setState({
        agentName: info.name,
        agentVersion: info.version,
        protocolVersion: info.protocolVersion,
        loadSessionSupported: info.loadSession,
      }),
    setError: error => store.setState({ error }),
  }
}