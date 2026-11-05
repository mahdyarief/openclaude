import type {
  CompactionStatus,
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

export type PermissionOption = {
  optionId: string
  name: string
  kind: string
}

/** An interactive question the agent asked via the `AskUserQuestion` tool. */
export type AgentQuestion = {
  /** the question text, also used as the answer key */
  question: string
  /** whether the user may pick more than one option */
  multiSelect: boolean
  /** option labels in display order */
  options: Array<{ label: string }>
}

export type PermissionRequest = {
  requestId: number | string
  sessionId: string
  toolCall: ToolCallUpdate
  options: PermissionOption[]
  /** present when the tool is `AskUserQuestion`; drives the ApprovalCard UI */
  questions?: AgentQuestion[] | null
}

/** A slash command the agent advertised via `available_commands_update`. */
export type AvailableCommand = {
  name: string
  description: string
  /** Agent-side command kind; `local-jsx` commands need a web-rendered panel. */
  type?: string
  argumentHint?: string
}

export type Compaction = {
  compactionId: string
  status: CompactionStatus
  summary: ContentBlock[]
  error: string | null
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
  compactions: Record<string, Compaction>
  configOptions: Array<SessionConfigOption>
  /** slash commands the agent supports, for the composer's `/` menu */
  commands: AvailableCommand[]
  permissionQueue: PermissionRequest[]
  stopReason: StopReason | null
  streaming: boolean
  notice: { severity: string; title: string; description?: string | null } | null
}

export type ConnectionStatus = 'connecting' | 'ready' | 'dead' | 'idle'

export type ConnectionState = {
  status: ConnectionStatus
  agentName: string | null
  agentVersion: string | null
  protocolVersion: number | null
  loadSessionSupported: boolean
  error: string | null
}