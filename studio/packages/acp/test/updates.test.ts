import { describe, expect, test } from 'vitest'
import { applySessionUpdate, emptySession } from '../src/updates.js'
import type { SessionNotification } from '@agentclientprotocol/sdk'

const base = emptySession('s1', '/work')

function notification(update: SessionNotification['update']): SessionNotification {
  return { sessionId: 's1', update }
}

describe('applySessionUpdate', () => {
  test('accumulates agent text chunks in arrival order', () => {
    const first = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
      }),
    )
    const second = applySessionUpdate(
      first,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' world' },
      }),
    )

    expect(second.messages).toHaveLength(1)
    const firstMessage = second.messages[0]
    expect(firstMessage?.role).toBe('agent')
    expect(firstMessage?.parts).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  test('keeps thought chunks separate from answer text', () => {
    const withThought = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'considering' },
      }),
    )
    const withText = applySessionUpdate(
      withThought,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'answer' },
      }),
    )

    expect(withText.messages[0]?.parts).toEqual([
      { kind: 'thought', text: 'considering' },
      { kind: 'text', text: 'answer' },
    ])
  })

  test('creates a tool call and then merges its update', () => {
    const created = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Read file',
        status: 'pending',
      }),
    )
    const updated = applySessionUpdate(
      created,
      notification({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'done' },
          },
        ],
      }),
    )

    expect(updated.toolCalls.t1?.status).toBe('completed')
    expect(updated.toolCalls.t1?.title).toBe('Read file')
    expect(updated.messages[0]?.parts).toEqual([{ kind: 'tool', toolCallId: 't1' }])
  })

  test('stores plan and usage without touching messages', () => {
    const withPlan = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'plan',
        entries: [{ content: 'step one', priority: 'high', status: 'pending' }],
      }),
    )
    const withUsage = applySessionUpdate(
      withPlan,
      notification({ sessionUpdate: 'usage_update', used: 10, size: 100 }),
    )

    expect(withUsage.plan?.entries).toHaveLength(1)
    expect(withUsage.usage).toEqual({ used: 10, size: 100, cost: null })
    expect(withUsage.messages).toHaveLength(0)
  })

  test('stores the agent-advertised slash commands', () => {
    const withCommands = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'commit', description: 'Create a commit' },
          { name: 'review:fast', description: 'Quick review' },
        ],
      }),
    )

    expect(withCommands.commands).toEqual([
      { name: 'commit', description: 'Create a commit' },
      { name: 'review:fast', description: 'Quick review' },
    ])
    expect(withCommands.messages).toHaveLength(0)
  })

  test('reads command type and argument hint from `_meta`', () => {
    const withCommands = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          {
            name: 'model',
            description: 'Set the model',
            _meta: { type: 'local-jsx', argumentHint: '[model-id]' },
          },
          {
            name: 'commit',
            description: 'Create a commit',
            _meta: { type: 'prompt' },
          },
          // A bridge that omits `_meta` must map cleanly to a prompt command.
          { name: 'plain', description: 'No meta' },
        ],
      }),
    )

    expect(withCommands.commands).toEqual([
      { name: 'model', description: 'Set the model', type: 'local-jsx', argumentHint: '[model-id]' },
      { name: 'commit', description: 'Create a commit', type: 'prompt' },
      { name: 'plain', description: 'No meta' },
    ])
  })

  test('latches streaming on the first chunk and leaves it set', () => {
    const streamed = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hi' },
      }),
    )

    // No ACP notification ends a turn; `streaming` stays true until the
    // caller clears it (the prompt promise resolving does that).
    expect(streamed.streaming).toBe(true)
  })

  test('ignores a user_message_chunk echo for an optimistic bubble', () => {
    const optimistic = {
      ...base,
      messages: [
        { id: 'optimistic-1', role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hi' }] },
      ],
    }
    const echoed = applySessionUpdate(
      optimistic,
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'hi' },
      }),
    )

    // Without dedup the echo would append a second user message.
    expect(echoed.messages).toHaveLength(1)
    expect(echoed.messages[0]?.parts).toEqual([{ kind: 'text', text: 'hi' }])
  })

  test('records a notice without touching messages', () => {
    const withNotice = applySessionUpdate(
      { ...base, streaming: true },
      notification({ sessionUpdate: 'notice', severity: 'info', title: 'done' }),
    )

    expect(withNotice.notice).toEqual({ severity: 'info', title: 'done', description: null })
    expect(withNotice.messages).toHaveLength(0)
  })
})
