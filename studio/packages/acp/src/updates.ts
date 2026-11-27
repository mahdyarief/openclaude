import type {
  ContentBlock,
  SessionNotification,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type {
  AvailableCommand,
  Compaction,
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
    compactions: {},
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

/** Keep non-text ACP content blocks in local/replayed messages instead of dropping them. */
export function promptParts(prompt: string | ContentBlock[] | ContentBlock): MessagePart[] {
  const blocks = typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : Array.isArray(prompt) ? prompt : [prompt]
  return blocks.map((block): MessagePart =>
    block.type === 'text'
      ? { kind: 'text', text: block.text }
      : { kind: 'content', block: block as ContentBlock },
  )
}

/** Convert a replayed ACP content chunk into a display part. */
export function chunkPart(content: ContentBlock, thought = false): MessagePart {
  if (content.type === 'text') return { kind: thought ? 'thought' : 'text', text: content.text }
  return { kind: 'content', block: content }
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

  const parts = last.parts.slice()
  if (canMerge) {
    parts[parts.length - 1] = { ...previous, text: previous.text + part.text } as TextPart
  } else {
    parts.push(part)
  }

  const next = messages.slice()
  next[next.length - 1] = { ...last, parts }
  return next
}

function isStructuralContent(block: ToolCallContent): boolean {
  return block.type === 'diff' || block.type === 'terminal'
}

// `ToolCallUpdate.content` replaces the whole collection, but structural blocks
// (diff/terminal) describe the call itself and are only sent on `tool_call`.
// Keep them when the result arrives as plain text so the UI can still render
// the diff. An update that already carries structural blocks is a full replace,
// so don't duplicate the preserved ones in that case.
function mergeContent(
  existing: ToolCall['content'],
  incoming: ToolCallContent[],
): ToolCallContent[] {
  const preserved = incoming.some(isStructuralContent)
    ? []
    : (existing ?? []).filter(isStructuralContent)
  return [...preserved, ...incoming]
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
    ...(update.content != null ? { content: mergeContent(base.content, update.content) } : {}),
    ...(update.locations != null ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
    ...(update._meta !== undefined ? { _meta: update._meta } : {}),
  }
}

// Compile-time exhaustiveness guard: a new SessionUpdate kind must be handled
// above. It returns its argument instead of throwing so an update from a newer
// agent still resolves to `state` below rather than crashing the reducer.
function assertNever(value: never): never {
  return value
}

function applyUpdate(state: SessionState, update: SessionUpdate): SessionState {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      // The composer already inserted this prompt optimistically, so an echo
      // from the agent would duplicate it. `optimistic-` marks that bubble.
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'user' && last.id.startsWith('optimistic-')) return state
      return {
        ...state,
        messages: appendChunk(state.messages, 'user', chunkPart(update.content)),
      }
    }
    case 'agent_message_chunk': {
      return {
        ...state,
        streaming: true,
        messages: appendChunk(state.messages, 'agent', chunkPart(update.content)),
      }
    }
    case 'agent_thought_chunk': {
      return {
        ...state,
        streaming: true,
        messages: appendChunk(state.messages, 'agent', chunkPart(update.content, true)),
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
      return {
        ...state,
        modes: {
          currentModeId: update.currentModeId,
          availableModes: state.modes?.availableModes ?? [],
        },
      }
    case 'compaction_update': {
      const existing = state.compactions[update.compactionId]
      const base: Compaction = existing ?? {
        compactionId: update.compactionId,
        status: update.status,
        summary: [],
        error: null,
      }
      // summary/error use patch semantics: omitted keeps, null clears.
      const summary =
        update.summary === undefined
          ? base.summary
          : update.summary === null
            ? []
            : update.summary
      const error =
        update.error === undefined
          ? base.error
          : update.error === null
            ? null
            : update.error
      return {
        ...state,
        compactions: {
          ...state.compactions,
          [update.compactionId]: { ...base, status: update.status, summary, error },
        },
      }
    }
    case 'compaction_summary_chunk': {
      const existing = state.compactions[update.compactionId]
      const base: Compaction = existing ?? {
        compactionId: update.compactionId,
        status: 'in_progress',
        summary: [],
        error: null,
      }
      return {
        ...state,
        compactions: {
          ...state.compactions,
          [update.compactionId]: {
            ...base,
            summary: [...base.summary, update.content],
          },
        },
      }
    }
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
  }
  assertNever(update)
  return state
}

export function applySessionUpdate(
  state: SessionState,
  notification: SessionNotification,
): SessionState {
  return applyUpdate(state, notification.update)
}