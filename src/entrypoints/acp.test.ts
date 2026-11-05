import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { PassThrough } from 'node:stream'

type PermissionResult = {
  behavior: 'allow' | 'deny'
  message?: string
  decisionClassification?: string
}

const responded: Array<{ toolUseId: string; decision: PermissionResult }> = []
const permissionCallbacks: Array<(message: unknown) => void> = []
const closeCalls: Array<Promise<void>> = []

let promptMessages: unknown[] = [
  {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'characterization chunk' }] },
  },
]

const fakeSession = {
  sessionId: 'fake-session-id',
  sendMessage: async function* () {
    for (const message of promptMessages) yield message
  },
  getMessages: () => [],
  getAppState: () => ({
    todos: { 'agent-1': [{ content: 'integration step', status: 'in_progress' }] },
    notifications: {
      current: { key: 'notif-1', text: 'integration notice', priority: 'high' },
      queue: [],
    },
  }),
  subscribeAppState: () => () => {},
  interrupt: () => {},
  close: () => {
    // Simulates async MCP child cleanup; the server must await this.
    const p = new Promise<void>(resolve => setTimeout(resolve, 10))
    closeCalls.push(p)
    return p
  },
  respondToPermission: (toolUseId: string, decision: PermissionResult) => {
    responded.push({ toolUseId, decision })
  },
}

const realV2 = await import('./sdk/v2.js')
mock.module('./sdk/v2.js', () => ({
  ...realV2,
  unstable_v2_createSession: (options: { onPermissionRequest?: (m: unknown) => void }) => {
    if (options.onPermissionRequest) permissionCallbacks.push(options.onPermissionRequest)
    return fakeSession
  },
  unstable_v2_resumeSession: async (
    id: string,
    options: { onPermissionRequest?: (m: unknown) => void },
  ) => {
    if (options.onPermissionRequest) permissionCallbacks.push(options.onPermissionRequest)
    return { ...fakeSession, sessionId: id }
  },
}))
mock.module('./init.js', () => ({ init: async () => {} }))
// `studioConfigSurface` pulls in bun:bundle feature() macros that the test
// runner cannot transform, so keep the settings registry out of the harness.
// The config snapshot is compared before/after with the same empty registry.
mock.module('../utils/studioConfigSurface.js', () => ({
  buildConfigSettings: () => [],
}))

const m1Snapshot = {
  model: 'test-model',
  branch: 'main',
  worktree: null,
  permissionMode: 'plan',
  effort: 'medium',
  statusLineText: '',
  contextWindow: { usedPercent: 0.5, tokens: 1000, size: 200000 },
  session: { name: 'integration session', costUsd: 0.25, durationMs: 10 },
  backgroundTasks: [],
}
const realStatusLine = await import('../utils/statusLineSnapshot.js')
mock.module('../utils/statusLineSnapshot.js', () => ({
  ...realStatusLine,
  buildStatusSnapshot: async () => m1Snapshot,
}))

const {
  createAcpServer,
  toolUpdates,
  userTextFromMessage,
  thinkingFromMessage,
  compactSummaryFromMessage,
  compactionUpdates,
  noticeFromMessage,
  statusUpdates,
  planUpdate,
  noticeUpdateFromAppState,
  configOptionsUpdate,
} = await import('./acp.js')

describe('acp tool updates', () => {
  it('opens every tool_use and closes it from the matching tool_result', () => {
    const opened = toolUpdates({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 't2', name: 'Read', input: { path: 'a' } },
        ],
      },
    } as never)
    expect(opened.map(u => [u.sessionUpdate, u.toolCallId, u.status])).toEqual([
      ['tool_call', 't1', 'in_progress'],
      ['tool_call', 't2', 'in_progress'],
    ])

    const closed = toolUpdates({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file.txt' },
          { type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: 'missing' }] },
        ],
      },
    } as never)
    expect(closed).toEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'file.txt' } }],
        rawOutput: 'file.txt',
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't2',
        status: 'failed',
        content: [{ type: 'content', content: { type: 'text', text: 'missing' } }],
        rawOutput: [{ type: 'text', text: 'missing' }],
      },
    ])
  })
})

type Rpc = Record<string, unknown> & { id?: number; method?: string }

function createHarness() {
  const input = new PassThrough()
  const output: Rpc[] = []
  const server = createAcpServer(input, {
    write: (chunk: string) => output.push(JSON.parse(chunk) as Rpc),
  } as unknown as NodeJS.WritableStream)

  const send = (message: Record<string, unknown>): void => {
    input.write(`${JSON.stringify(message)}\n`)
  }
  const waitFor = async (
    predicate: (message: Rpc) => boolean,
    label: string,
  ): Promise<Rpc> => {
    for (let i = 0; i < 200; i++) {
      const found = output.find(predicate)
      if (found) return found
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${label}`)
  }
  return { output, send, waitFor, close: () => server.close() }
}

describe('acp permission routing', () => {
  beforeEach(() => {
    responded.length = 0
    permissionCallbacks.length = 0
  })

  it('routes a permission response carried in `result` to respondToPermission', async () => {
    const h = createHarness()
    try {
      h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      await h.waitFor(m => m.id === 1, 'initialize response')

      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new response')
      expect(permissionCallbacks).toHaveLength(1)

      // The agent asks for permission mid-turn; the server turns it into a
      // JSON-RPC request to the client and parks the resolver.
      permissionCallbacks[0]!({
        type: 'permission_request',
        request_id: 'req-1',
        tool_name: 'ToolSearch',
        tool_use_id: 'tool-1',
        input: { query: 'web search' },
        uuid: 'uuid-1',
        session_id: 'fake-session-id',
      })
      const request = await h.waitFor(
        m => m.method === 'session/request_permission',
        'permission request',
      )

      // A real ACP client answers with a JSON-RPC *response*: payload in
      // `result`. Before the fix this was read from `params`, so the decision
      // was dropped and every tool call was denied.
      h.send({
        jsonrpc: '2.0',
        id: request.id,
        result: { outcome: { outcome: 'selected', optionId: 'allow' } },
      })

      for (let i = 0; i < 100 && responded.length === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(responded).toHaveLength(1)
      expect(responded[0]).toEqual({
        toolUseId: 'tool-1',
        decision: { behavior: 'allow', decisionClassification: 'user_temporary' },
      })
    } finally {
      await h.close()
    }
  })
})

/**
 * Characterization of the JSON-RPC surface before/after the M0 dispatch-table
 * refactor. This test is run against both the working tree and `git HEAD`'s
 * acp.ts: passing on both is what proves behaviour did not change.
 */
describe('acp dispatch characterization', () => {
  it('answers every registered method and rejects unknown/prototype methods', async () => {
    const h = createHarness()
    try {
      h.send({ jsonrpc: '2.0', id: 101, method: 'initialize', params: {} })
      const init = await h.waitFor(m => m.id === 101, 'initialize')
      expect(init.result).toMatchObject({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'openclaude' },
      })

      h.send({ jsonrpc: '2.0', id: 102, method: 'session/new', params: { cwd: '/tmp' } })
      const created = await h.waitFor(m => m.id === 102, 'session/new')
      expect(created.result).toEqual({ sessionId: 'fake-session-id' })

      h.send({ jsonrpc: '2.0', id: 103, method: 'session/prompt', params: { sessionId: 'fake-session-id', prompt: [] } })
      const chunk = await h.waitFor(
        m => m.method === 'session/update' && (m.params as any)?.update?.sessionUpdate === 'agent_message_chunk',
        'agent_message_chunk',
      )
      expect((chunk.params as any).update.content).toEqual({ type: 'text', text: 'characterization chunk' })
      const prompted = await h.waitFor(m => m.id === 103, 'session/prompt response')
      expect(prompted.result).toEqual({ stopReason: 'end_turn' })

      h.send({ jsonrpc: '2.0', id: 104, method: 'session/cancel', params: { sessionId: 'fake-session-id' } })
      const cancelled = await h.waitFor(m => m.id === 104, 'session/cancel')
      expect(cancelled.result).toEqual({})

      h.send({ jsonrpc: '2.0', id: 105, method: 'session/load', params: { sessionId: 'resumed-id', cwd: '/tmp' } })
      const loaded = await h.waitFor(m => m.id === 105, 'session/load')
      expect(loaded.result).toEqual({ sessionId: 'resumed-id' })

      h.send({ jsonrpc: '2.0', id: 106, method: 'openclaude/config', params: {} })
      await h.waitFor(m => m.id === 106, 'openclaude/config')

      h.send({ jsonrpc: '2.0', id: 107, method: 'openclaude/status', params: { sessionId: 'fake-session-id' } })
      await h.waitFor(m => m.id === 107, 'openclaude/status')

      h.send({ jsonrpc: '2.0', id: 108, method: 'nope/method', params: {} })
      const unknown = await h.waitFor(m => m.id === 108, 'unknown method')
      expect(unknown.error).toMatchObject({ code: -32601 })

      h.send({ jsonrpc: '2.0', id: 109, method: 'constructor', params: {} })
      const prototype = await h.waitFor(m => m.id === 109, 'prototype method')
      expect(prototype.error).toMatchObject({ code: -32601 })
    } finally {
      await h.close()
    }
  })
})

describe('acp shutdown', () => {
  it('awaits session.close() so MCP children are reaped before exit', async () => {
    closeCalls.length = 0
    const h = createHarness()
    h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    await h.waitFor(m => m.id === 1, 'initialize response')
    h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
    await h.waitFor(m => m.id === 2, 'session/new response')

    expect(closeCalls).toHaveLength(0)
    await h.close()
    expect(closeCalls).toHaveLength(1)
    // The promise returned by close() must resolve only after the session
    // cleanup promise settled, i.e. it was awaited rather than fire-and-forget.
    await expect(closeCalls[0]).resolves.toBeUndefined()
  })
})

type SdkMessageLike = Record<string, unknown>
const asMessage = (value: SdkMessageLike): never => value as never

describe('acp M1 update mappers', () => {
  it('extracts user text without echoing tool results or compaction summaries', () => {
    expect(
      userTextFromMessage(
        asMessage({
          type: 'user',
          message: { content: [{ type: 'text', text: 'hello' }] },
        }),
      ),
    ).toBe('hello')
    expect(
      userTextFromMessage(
        asMessage({
          type: 'user',
          tool_use_result: 'ok',
          message: { content: 'tool output' },
        }),
      ),
    ).toBeNull()
    expect(
      userTextFromMessage(
        asMessage({
          type: 'user',
          isReplay: true,
          message: { content: 'replayed' },
        }),
      ),
    ).toBeNull()
  })

  it('extracts thinking from assistant blocks and stream deltas', () => {
    expect(
      thinkingFromMessage(
        asMessage({
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'considering' }] },
        }),
      ),
    ).toBe('considering')
    expect(
      thinkingFromMessage(
        asMessage({
          type: 'stream_event',
          event: { delta: { type: 'thinking_delta', thinking: 'delta thought' } },
        }),
      ),
    ).toBe('delta thought')
    expect(
      thinkingFromMessage(
        asMessage({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'answer' }] },
        }),
      ),
    ).toBeNull()
  })

  it('reads the forwardable compaction summary text', () => {
    expect(
      compactSummaryFromMessage(
        asMessage({
          type: 'user',
          message: {
            isCompactSummary: true,
            content: [{ type: 'text', text: 'summary body' }],
          },
        }),
      ),
    ).toBe('summary body')
    expect(
      compactSummaryFromMessage(
        asMessage({ type: 'user', message: { content: 'ordinary' } }),
      ),
    ).toBeNull()
  })

  it('maps compacting status and boundary to a compaction lifecycle', () => {
    expect(
      compactionUpdates(
        asMessage({ type: 'system', subtype: 'status', status: 'compacting' }),
        's1',
      ),
    ).toEqual([
      {
        sessionUpdate: 'compaction_update',
        compactionId: 's1:compaction',
        status: 'in_progress',
      },
    ])
    expect(
      compactionUpdates(asMessage({ type: 'system', subtype: 'compact_boundary' }), 's1'),
    ).toEqual([
      {
        sessionUpdate: 'compaction_update',
        compactionId: 's1:compaction',
        status: 'completed',
      },
    ])
    expect(compactionUpdates(asMessage({ type: 'assistant' }), 's1')).toEqual([])
  })

  it('surfaces api_retry and error results as notices', () => {
    expect(
      noticeFromMessage(
        asMessage({
          type: 'system',
          subtype: 'api_retry',
          attempt: 2,
          max_retries: 5,
          error: 'rate limited',
        }),
      ),
    ).toMatchObject({
      sessionUpdate: 'notice',
      severity: 'warning',
      description: 'rate limited',
    })
    expect(
      noticeFromMessage(
        asMessage({ type: 'result', subtype: 'error', errors: ['boom', 'failed'] }),
      ),
    ).toMatchObject({
      sessionUpdate: 'notice',
      severity: 'error',
      description: 'boom; failed',
    })
    expect(noticeFromMessage(asMessage({ type: 'assistant' }))).toBeNull()
  })

  it('derives usage, session info, and mode from the status snapshot', () => {
    const updates = statusUpdates({
      contextWindow: { tokens: 1200, size: 200000, usedPercent: 0.6 },
      session: { name: 'my session', costUsd: 0.42, durationMs: 1000 },
      permissionMode: 'plan',
    } as never)
    expect(updates).toEqual([
      {
        sessionUpdate: 'usage_update',
        used: 1200,
        size: 200000,
        cost: { amount: 0.42, currency: 'USD' },
      },
      {
        sessionUpdate: 'session_info_update',
        title: 'my session',
        updatedAt: expect.any(String),
      },
      { sessionUpdate: 'current_mode_update', currentModeId: 'plan' },
    ])
  })

  it('flattens per-agent todos into a plan and skips empty state', () => {
    expect(
      planUpdate({
        todos: {
          'agent-1': [
            { content: 'step one', status: 'in_progress' },
            { content: 'step two', status: 'completed' },
          ],
        },
      } as never),
    ).toEqual({
      sessionUpdate: 'plan',
      entries: [
        { content: 'step one', priority: 'medium', status: 'in_progress' },
        { content: 'step two', priority: 'medium', status: 'completed' },
      ],
    })
    expect(planUpdate({} as never)).toBeNull()
  })

  it('maps the current notification to a notice with severity', () => {
    expect(
      noticeUpdateFromAppState({
        notifications: {
          current: { key: 'n1', text: 'heads up', priority: 'high' },
          queue: [],
        },
      } as never),
    ).toEqual({
      sessionUpdate: 'notice',
      severity: 'warning',
      title: 'heads up',
      description: null,
    })
    expect(noticeUpdateFromAppState({ notifications: { current: null } } as never)).toBeNull()
  })

  it('emits an empty config_option_update with the mocked registry', () => {
    expect(configOptionsUpdate()).toEqual({
      sessionUpdate: 'config_option_update',
      configOptions: [],
    })
  })
})

describe('acp M1 JSON-RPC fixture', () => {
  const collect = (output: Rpc[]): Set<string> =>
    new Set(
      output
        .filter(m => m.method === 'session/update')
        .map(m => (m.params as { update?: { sessionUpdate?: string } })?.update?.sessionUpdate)
        .filter((kind): kind is string => typeof kind === 'string'),
    )

  it('advertises capabilities and emits every state-derived kind on session/new', async () => {
    const h = createHarness()
    try {
      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientCapabilities: { session: { compaction: {}, notices: {} } },
        },
      })
      await h.waitFor(m => m.id === 1, 'initialize response')

      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new response')

      // The initial status emit is debounced by 150ms, so poll for the full
      // state-derived set rather than asserting after a fixed delay.
      const expected = [
        'plan',
        'notice',
        'usage_update',
        'session_info_update',
        'current_mode_update',
        'config_option_update',
      ]
      for (const kind of expected) {
        await h.waitFor(
          m =>
            m.method === 'session/update' &&
            (m.params as any)?.update?.sessionUpdate === kind,
          kind,
        )
      }
      const seen = collect(h.output)
      for (const kind of expected) expect(seen.has(kind)).toBe(true)
    } finally {
      await h.close()
    }
  })

  it('gates compaction and notice behind advertised capabilities', async () => {
    const h = createHarness()
    try {
      // No session capabilities advertised.
      h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      await h.waitFor(m => m.id === 1, 'initialize response')
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new response')
      await h.waitFor(
        m =>
          m.method === 'session/update' &&
          (m.params as any)?.update?.sessionUpdate === 'usage_update',
        'usage_update (initial status emit settled)',
      )
      expect(collect(h.output).has('notice')).toBe(false)
      expect(collect(h.output).has('config_option_update')).toBe(true)
    } finally {
      await h.close()
    }
  })

  it('emits per-message kinds from the prompt stream', async () => {
    promptMessages = [
      { type: 'user', message: { content: [{ type: 'text', text: 'user turn' }] } },
      {
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'reasoning' }] },
      },
      { type: 'system', subtype: 'status', status: 'compacting' },
      { type: 'system', subtype: 'compact_boundary' },
      {
        type: 'user',
        message: {
          isCompactSummary: true,
          content: [{ type: 'text', text: 'compacted summary' }],
        },
      },
      { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3, error: 'retry' },
    ]
    const h = createHarness()
    try {
      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientCapabilities: { session: { compaction: {}, notices: {} } } },
      })
      await h.waitFor(m => m.id === 1, 'initialize response')
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new response')
      h.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/prompt',
        params: { sessionId: 'fake-session-id', prompt: [{ type: 'text', text: 'go' }] },
      })
      await h.waitFor(m => m.id === 3, 'session/prompt response')

      const seen = collect(h.output)
      for (const kind of [
        'user_message_chunk',
        'agent_thought_chunk',
        'compaction_update',
        'compaction_summary_chunk',
        'notice',
      ]) {
        expect(seen.has(kind)).toBe(true)
      }
    } finally {
      await h.close()
      promptMessages = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'characterization chunk' }] },
        },
      ]
    }
  })
})
