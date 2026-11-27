import { describe, expect, test } from 'vitest'
import { applySessionUpdate, emptySession, promptParts } from '../src/updates.js'
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

  test('preserves replayed image and typed user content chunks', () => {
    const image = { type: 'image' as const, data: 'AQID', mimeType: 'image/png' }
    const replayed = applySessionUpdate(
      base,
      notification({ sessionUpdate: 'user_message_chunk', content: image }),
    )
    const withAnswer = applySessionUpdate(
      replayed,
      notification({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'seen' } }),
    )

    expect(replayed.messages[0]?.parts).toEqual([{ kind: 'content', block: image }])
    expect(withAnswer.messages[1]?.parts).toEqual([{ kind: 'text', text: 'seen' }])
    expect(promptParts([{ type: 'text', text: 'hello' }, image])).toEqual([
      { kind: 'text', text: 'hello' },
      { kind: 'content', block: image },
    ])
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

  test('keeps a diff and its locations when a text result arrives', () => {
    const created = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Edit file',
        kind: 'edit',
        status: 'in_progress',
        locations: [{ path: '/work/a.ts' }],
        content: [
          { type: 'diff', path: '/work/a.ts', oldText: 'old', newText: 'new' },
        ],
      }),
    )
    const updated = applySessionUpdate(
      created,
      notification({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'File updated' } },
        ],
      }),
    )

    expect(updated.toolCalls.t1?.locations).toEqual([{ path: '/work/a.ts' }])
    expect(updated.toolCalls.t1?.content).toEqual([
      { type: 'diff', path: '/work/a.ts', oldText: 'old', newText: 'new' },
      { type: 'content', content: { type: 'text', text: 'File updated' } },
    ])
  })

  test('keeps a terminal block when the shell result arrives as text', () => {
    const created = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'tool_call',
        toolCallId: 's1',
        title: 'Bash',
        kind: 'execute',
        status: 'in_progress',
        content: [{ type: 'terminal', terminalId: 's1' }],
      }),
    )
    const updated = applySessionUpdate(
      created,
      notification({
        sessionUpdate: 'tool_call_update',
        toolCallId: 's1',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'ok' } },
        ],
      }),
    )

    expect(updated.toolCalls.s1?.content).toEqual([
      { type: 'terminal', terminalId: 's1' },
      { type: 'content', content: { type: 'text', text: 'ok' } },
    ])
  })

  test('replaces structural blocks when an update carries its own', () => {
    const created = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Edit file',
        status: 'in_progress',
        content: [
          { type: 'diff', path: '/work/a.ts', oldText: 'old', newText: 'new' },
        ],
      }),
    )
    const updated = applySessionUpdate(
      created,
      notification({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [
          { type: 'diff', path: '/work/a.ts', oldText: 'old', newText: 'final' },
        ],
      }),
    )

    expect(updated.toolCalls.t1?.content).toEqual([
      { type: 'diff', path: '/work/a.ts', oldText: 'old', newText: 'final' },
    ])
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

  test('upserts a compaction and patches its summary/status', () => {
    const started = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'compaction_update',
        compactionId: 'c1',
        status: 'in_progress',
      }),
    )
    expect(started.compactions['c1']).toEqual({
      compactionId: 'c1',
      status: 'in_progress',
      summary: [],
      error: null,
    })

    const done = applySessionUpdate(
      started,
      notification({
        sessionUpdate: 'compaction_update',
        compactionId: 'c1',
        status: 'completed',
        summary: [{ type: 'text', text: 'summarised' }],
      }),
    )
    expect(done.compactions['c1']).toEqual({
      compactionId: 'c1',
      status: 'completed',
      summary: [{ type: 'text', text: 'summarised' }],
      error: null,
    })
  })

  test('clears a compaction summary with an explicit null patch', () => {
    const withSummary = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'compaction_update',
        compactionId: 'c1',
        status: 'completed',
        summary: [{ type: 'text', text: 'summarised' }],
      }),
    )
    const cleared = applySessionUpdate(
      withSummary,
      notification({
        sessionUpdate: 'compaction_update',
        compactionId: 'c1',
        status: 'completed',
        summary: null,
      }),
    )
    expect(cleared.compactions['c1']?.summary).toEqual([])
  })

  test('appends compaction summary chunks in arrival order', () => {
    const withFirst = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'compaction_summary_chunk',
        compactionId: 'c1',
        content: { type: 'text', text: 'part one' },
      }),
    )
    const withSecond = applySessionUpdate(
      withFirst,
      notification({
        sessionUpdate: 'compaction_summary_chunk',
        compactionId: 'c1',
        content: { type: 'text', text: ' part two' },
      }),
    )
    expect(withSecond.compactions['c1']?.summary).toEqual([
      { type: 'text', text: 'part one' },
      { type: 'text', text: ' part two' },
    ])
    expect(withSecond.compactions['c1']?.status).toBe('in_progress')
  })

  test('applies a current_mode_update without dropping available modes', () => {
    const withModes = {
      ...base,
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default', description: null },
          { id: 'plan', name: 'Plan', description: null },
        ],
      },
    }
    const switched = applySessionUpdate(
      withModes,
      notification({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }),
    )
    expect(switched.modes?.currentModeId).toBe('plan')
    expect(switched.modes?.availableModes).toHaveLength(2)
  })
})
