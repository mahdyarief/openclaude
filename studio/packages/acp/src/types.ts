import type {
  ContentBlock,
  Plan,
  SessionConfigOption,
  SessionModeState,
  StopReason,
  ToolCall,
  ToolCallUpdate,
  UsageUpdate,
} from '@agentclientprotocol/sdk'

export type MessageRole = 'user' | 'agent'

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; toolCallId: string }

export type ConversationMessage = {
  id: string
  role: MessageRole
  parts: MessagePart[]
}

export type PermissionRequest = {
  requestId: number | string
  sessionId: string
  toolCall: ToolCallUpdate
  options: Array<{ optionId: string; name: string; kind: string }>
}

export type SessionState = {
  sessionId: string
  cwd: string
  title: string | null
  messages: ConversationMessage[]
  toolCalls: Record<string, ToolCall>
  plan: Plan | null
  usage: UsageUpdate | null
  modes: SessionModeState | null
  configOptions: Array<SessionConfigOption>
  permissionQueue: PermissionRequest[]
  stopReason: StopReason | null
  streaming: boolean
  notice: { severity: string; title: string; description?: string | null } | null
}

export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'dead'

export type ConnectionState = {
  status: ConnectionStatus
  agentName: string | null
  agentVersion: string | null
  protocolVersion: number | null
  loadSessionSupported: boolean
  error: string | null
}