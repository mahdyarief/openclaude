import type {
  SessionNotification,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type {
  AvailableCommand,
  ConversationMessage,
  MessagePart,
  SessionState,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let messageCounter = 0

function nextId(prefix: string): string {
  messageCounter += 1
  return `${prefix}-${messageCounter}`
}

export function emptySession(sessionId: string, cwd: string): SessionState {
  return {
    sessionId,
    cwd,
    title: null,
    messages: [],
    toolCalls: {},
    plan: null,
    usage: null,
    modes: null,
    configOptions: [],
    commands: [],
    permissionQueue: [],
    stopReason: null,
    streaming: false,
    notice: null,
  }
}

type TextPart = Extract<MessagePart, { kind: 'text' | 'thought' }>

function isTextual(part: MessagePart): part is TextPart {
  return part.kind === 'text' || part.kind === 'thought'
}

// A chunk belongs to the last message of the same role. If the last message has
// a different role, a new message starts. This mirrors how ACP streams a turn:
// all agent chunks for one turn arrive consecutively.
function appendChunk(
  messages: ConversationMessage[],
  role: ConversationMessage['role'],
  part: MessagePart,
): ConversationMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== role) {
    return [...messages, { id: nextId(role), role, parts: [part] }]
  }

  const previous = last.parts[last.parts.length - 1]
  const canMerge =
    previous !== undefined &&
    isTextual(previous) &&
    isTextual(part) &&
    previous.kind === part.kind

  if (canMerge) {
    const merged = { ...previous, text: previous.text + part.text } as TextPart
    return [
      ...messages.slice(0, -1),
      { ...last, parts: [...last.parts.slice(0, -1), merged] },
    ]
  }

  return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] }]
}

// In ToolCallUpdate an omitted or null field means "leave unchanged", so a plain
// spread would clobber the existing value with null. Apply only the fields the
// update actually carries.
function mergeToolCall(existing: ToolCall | undefined, update: ToolCallUpdate): ToolCall {
  const base: ToolCall = existing ?? { toolCallId: update.toolCallId, title: '' }
  return {
    ...base,
    ...(update.title != null ? { title: update.title } : {}),
    ...(update.name != null ? { name: update.name } : {}),
    ...(update.kind != null ? { kind: update.kind } : {}),
    ...(update.status != null ? { status: update.status } : {}),
    ...(update.content != null ? { content: update.content } : {}),
    ...(update.locations != null ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
    ...(update._meta !== undefined ? { _meta: update._meta } : {}),
  }
}

function applyUpdate(state: SessionState, update: SessionUpdate): SessionState {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      if (update.content.type !== 'text') return state
      // The composer already inserted this prompt optimistically, so an echo
      // from the agent would duplicate it. `optimistic-` marks that bubble.
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'user' && last.id.startsWith('optimistic-')) return state
      return {
        ...state,
        messages: appendChunk(state.messages, 'user', {
          kind: 'text',
          text: update.content.text,
        }),
      }
    }
    case 'agent_message_chunk': {
      if (update.content.type !== 'text') return state
      return {
        ...state,
        streaming: true,
        messages: appendChunk(state.messages, 'agent', {
          kind: 'text',
          text: update.content.text,
        }),
      }
    }
    case 'agent_thought_chunk': {
      if (update.content.type !== 'text') return state
      return {
        ...state,
        streaming: true,
        messages: appendChunk(state.messages, 'agent', {
          kind: 'thought',
          text: update.content.text,
        }),
      }
    }
    case 'tool_call': {
      return {
        ...state,
        streaming: true,
        toolCalls: { ...state.toolCalls, [update.toolCallId]: update },
        messages: appendChunk(state.messages, 'agent', {
          kind: 'tool',
          toolCallId: update.toolCallId,
        }),
      }
    }
    case 'tool_call_update': {
      const existing = state.toolCalls[update.toolCallId]
      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [update.toolCallId]: mergeToolCall(existing, update),
        },
      }
    }
    case 'plan':
      return { ...state, plan: { entries: update.entries } }
    case 'usage_update':
      return {
        ...state,
        usage: { used: update.used, size: update.size, cost: update.cost ?? null },
      }
    case 'available_commands_update':
      return {
        ...state,
        commands: update.availableCommands.map((command): AvailableCommand => {
          const meta = isRecord(command._meta) ? command._meta : undefined
          const type = typeof meta?.type === 'string' ? meta.type : undefined
          const argumentHint =
            typeof meta?.argumentHint === 'string' ? meta.argumentHint : undefined
          return {
            name: command.name,
            description: command.description,
            ...(type !== undefined ? { type } : {}),
            ...(argumentHint !== undefined ? { argumentHint } : {}),
          }
        }),
      }
    case 'current_mode_update':
      return state
    case 'config_option_update':
      return { ...state, configOptions: update.configOptions }
    case 'session_info_update':
      return { ...state, title: update.title ?? state.title }
    case 'notice':
      return {
        ...state,
        notice: {
          severity: update.severity,
          title: update.title,
          description: update.description ?? null,
        },
      }
    case 'compaction_update':
      return state
    case 'compaction_summary_chunk':
      return state
    default:
      return state
  }
}

export function applySessionUpdate(
  state: SessionState,
  notification: SessionNotification,
): SessionState {
  return applyUpdate(state, notification.update)
}