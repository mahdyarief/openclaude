import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { PassThrough } from 'node:stream'

type PermissionResult = {
  behavior: 'allow' | 'deny'
  message?: string
  decisionClassification?: string
  updatedInput?: Record<string, unknown>
}

const responded: Array<{ toolUseId: string; decision: PermissionResult }> = []
const permissionCallbacks: Array<(message: unknown) => void> = []
const closeCalls: Array<Promise<void>> = []
const sentContents: unknown[] = []
const modeCalls: string[] = []
const configWrites: Array<{ id: string; value: unknown }> = []
let configSettings: unknown[] = []
let replayMessages: unknown[] = []
let nextFakeSessionId = 0

let promptMessages: unknown[] = [
  {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'characterization chunk' }] },
  },
]

const fakeSession = {
  sessionId: 'fake-session-id',
  sendMessage: async function* (content: unknown) {
    sentContents.push(content)
    for (const message of promptMessages) yield message
  },
  getMessages: () => replayMessages,
  setPermissionMode: async (mode: string) => {
    modeCalls.push(mode)
  },
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
    const id = nextFakeSessionId
    if (id === 0) return fakeSession
    nextFakeSessionId++
    return { ...fakeSession, sessionId: `new-session-${id}` }
  },
  unstable_v2_resumeSession: async (
    id: string,
    options: { onPermissionRequest?: (m: unknown) => void },
  ) => {
    if (options.onPermissionRequest) permissionCallbacks.push(options.onPermissionRequest)
    return { ...fakeSession, sessionId: id, getMessages: () => replayMessages }
  },
}))
mock.module('./init.js', () => ({ init: async () => {} }))
// `studioConfigSurface` pulls in bun:bundle feature() macros that the test
// runner cannot transform, so supply a mutable registry instead.
mock.module('../utils/studioConfigSurface.js', () => ({
  buildConfigSettings: () => configSettings,
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
  permissionPresentationFor,
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

  it('maps tool names to ACP kinds', () => {
    const opened = toolUpdates({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/x' } },
          { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/x' } },
          { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'd', name: 'Grep', input: { pattern: 'z' } },
          { type: 'tool_use', id: 'e', name: 'WebFetch', input: { url: 'u' } },
          { type: 'tool_use', id: 'f', name: 'ExitPlanMode', input: {} },
          { type: 'tool_use', id: 'g', name: 'SomethingElse', input: {} },
        ],
      },
    } as never)
    expect(opened.map(u => ('kind' in u ? u.kind : undefined))).toEqual([
      'read', 'edit', 'execute', 'search', 'fetch', 'switch_mode', 'other',
    ])
  })

  it('emits diff + locations for edit tools and a terminal block for shell tools', () => {
    const opened = toolUpdates({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/a.ts', old_string: 'old', new_string: 'new' } },
          { type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/b.ts', content: 'body' } },
          { type: 'tool_use', id: 'n1', name: 'NotebookEdit', input: { notebook_path: '/n.ipynb', new_source: '1+1' } },
          { type: 'tool_use', id: 's1', name: 'Bash', input: { command: 'sed -i s/a/b/ /c.txt', _simulatedSedEdit: { filePath: '/c.txt', newContent: 'b' } } },
        ],
      },
    } as never)
    expect(opened[0]).toMatchObject({
      kind: 'edit',
      locations: [{ path: '/a.ts' }],
      content: [{ type: 'diff', path: '/a.ts', oldText: 'old', newText: 'new' }],
    })
    expect(opened[1]).toMatchObject({
      kind: 'edit',
      locations: [{ path: '/b.ts' }],
      content: [{ type: 'diff', path: '/b.ts', oldText: null, newText: 'body' }],
    })
    expect(opened[2]).toMatchObject({
      kind: 'edit',
      locations: [{ path: '/n.ipynb' }],
      content: [{ type: 'diff', path: '/n.ipynb', oldText: null, newText: '1+1' }],
    })
    expect(opened[3]).toMatchObject({
      kind: 'execute',
      locations: [{ path: '/c.txt' }],
      content: [
        { type: 'diff', path: '/c.txt', oldText: null, newText: 'b' },
        { type: 'terminal', terminalId: 's1' },
      ],
    })
  })

  it('gives Read a location and shell tools a terminal block without a diff', () => {
    const opened = toolUpdates({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/a.ts' } },
          { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    } as never)
    expect(opened[0]).toMatchObject({ kind: 'read', locations: [{ path: '/a.ts' }] })
    expect(opened[0]!.content).toBeUndefined()
    expect(opened[1]).toMatchObject({
      kind: 'execute',
      content: [{ type: 'terminal', terminalId: 'b1' }],
    })
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
    closeCalls.length = 0
    sentContents.length = 0
    modeCalls.length = 0
    configWrites.length = 0
    configSettings = []
    replayMessages = []
    nextFakeSessionId = 0
    promptMessages = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'characterization chunk' }] },
      },
    ]
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

  const permissionCases: Array<{
    optionId: string
    kind: string
    decision: PermissionResult
  }> = [
    {
      optionId: 'allow',
      kind: 'allow_once',
      decision: { behavior: 'allow', decisionClassification: 'user_temporary' },
    },
    {
      optionId: 'allow_always',
      kind: 'allow_always',
      decision: { behavior: 'allow', decisionClassification: 'user_permanent' },
    },
    {
      optionId: 'reject',
      kind: 'reject_once',
      decision: {
        behavior: 'deny',
        message: 'Permission denied by ACP client',
        decisionClassification: 'user_reject',
      },
    },
    {
      optionId: 'reject_always',
      kind: 'reject_always',
      decision: {
        behavior: 'deny',
        message: 'Permission denied by ACP client',
        decisionClassification: 'user_reject',
      },
    },
  ]

  for (const { optionId, kind, decision } of permissionCases) {
    it(`maps option ${optionId} to the right decision`, async () => {
      const h = createHarness()
      try {
        h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
        await h.waitFor(m => m.id === 1, 'initialize response')
        h.send({
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: { cwd: '/tmp' },
        })
        await h.waitFor(m => m.id === 2, 'session/new response')

        permissionCallbacks[0]!({
          type: 'permission_request',
          request_id: 'req-1',
          tool_name: 'Edit',
          tool_use_id: 'tool-1',
          input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' },
          uuid: 'uuid-1',
          session_id: 'fake-session-id',
        })
        const request = await h.waitFor(
          m => m.method === 'session/request_permission',
          'permission request',
        )
        const params = request.params as Record<string, unknown>
        const options = params.options as Array<{ optionId: string; kind: string }>
        expect(options.find(o => o.optionId === optionId)?.kind).toBe(kind)

        h.send({
          jsonrpc: '2.0',
          id: request.id,
          result: { outcome: { outcome: 'selected', optionId } },
        })
        for (let i = 0; i < 100 && responded.length === 0; i++) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        expect(responded).toEqual([{ toolUseId: 'tool-1', decision }])
      } finally {
        await h.close()
      }
    })
  }

  it('sends a stateless preview in _meta and lifts _meta.answers back into updatedInput', async () => {
    const h = createHarness()
    try {
      h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      await h.waitFor(m => m.id === 1, 'initialize response')
      h.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        params: { cwd: '/tmp' },
      })
      await h.waitFor(m => m.id === 2, 'session/new response')

      permissionCallbacks[0]!({
        type: 'permission_request',
        request_id: 'req-1',
        tool_name: 'Edit',
        tool_use_id: 'tool-1',
        input: {
          file_path: '/a.ts',
          old_string: 'const a = 1',
          new_string: 'const a = 2',
        },
        uuid: 'uuid-1',
        session_id: 'fake-session-id',
      })
      const request = await h.waitFor(
        m => m.method === 'session/request_permission',
        'permission request',
      )
      const params = request.params as Record<string, unknown>
      const meta = params._meta as Record<string, unknown>
      const preview = meta.preview as Record<string, unknown>
      expect(preview.title).toBe('Edit file')
      expect(preview.diff).toEqual({
        path: '/a.ts',
        oldText: 'const a = 1',
        newText: 'const a = 2',
      })

      h.send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          outcome: {
            outcome: 'selected',
            optionId: 'allow',
            _meta: { answers: { q1: 'yes' } },
          },
        },
      })
      for (let i = 0; i < 100 && responded.length === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(responded).toEqual([
        {
          toolUseId: 'tool-1',
          decision: {
            behavior: 'allow',
            decisionClassification: 'user_temporary',
            updatedInput: { answers: { q1: 'yes' } },
          },
        },
      ])
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
    nextFakeSessionId = 0
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

describe('permissionPresentationFor', () => {
  const cases: Array<{
    tool: string
    input: Record<string, string>
    title: string
    summary?: string
    plan?: boolean
    diff?: boolean
    diffPath?: string
  }> = [
    { tool: 'Bash', input: { command: 'pnpm test' }, title: 'Run command', summary: 'pnpm test' },
    {
      tool: 'PowerShell',
      input: { command: 'Get-ChildItem' },
      title: 'Run PowerShell command',
      summary: 'Get-ChildItem',
    },
    {
      tool: 'Edit',
      input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' },
      title: 'Edit file',
      summary: '/a.ts',
      diff: true,
    },
    {
      tool: 'Write',
      input: { file_path: '/b.ts', content: 'x' },
      title: 'Write file',
      summary: '/b.ts',
      diff: true,
    },
    {
      tool: 'NotebookEdit',
      input: { notebook_path: '/n.ipynb', new_source: 'x' },
      title: 'Edit notebook',
      summary: '/n.ipynb',
      diff: true,
      diffPath: '/n.ipynb',
    },
    { tool: 'WebFetch', input: { url: 'https://example.com' }, title: 'Fetch web page', summary: 'https://example.com' },
    { tool: 'Skill', input: { skill: 'commit' }, title: 'Run skill', summary: 'commit' },
    {
      tool: 'ExitPlanMode',
      input: { plan: '1. do it' },
      title: 'Approve plan',
      plan: true,
    },
    { tool: 'EnterPlanMode', input: {}, title: 'Enter plan mode' },
    {
      tool: 'Monitor',
      input: { description: 'wait for build' },
      title: 'Monitor background work',
      summary: 'wait for build',
    },
    { tool: 'ReviewArtifact', input: { file_path: '/r.md' }, title: 'Review artifact', summary: '/r.md' },
    { tool: 'Read', input: { file_path: '/a.ts' }, title: 'Read file', summary: '/a.ts' },
    { tool: 'Glob', input: { pattern: '**/*.ts' }, title: 'Search files (Glob)', summary: '**/*.ts' },
    { tool: 'Grep', input: { pattern: 'TODO' }, title: 'Search files (Grep)', summary: 'TODO' },
    { tool: 'Sandbox', input: { command: 'ls' }, title: 'Run Sandbox' },
  ]

  for (const { tool, input, title, summary, plan, diff, diffPath } of cases) {
    it(`maps ${tool} to a structured preview`, () => {
      const preview = permissionPresentationFor(tool, 't1', input)
      expect(preview.title).toBe(title)
      if (summary !== undefined) expect(preview.summary).toBe(summary)
      if (plan) expect(preview.plan).toBe(input.plan)
      else expect(preview.plan).toBeNull()
      if (diff) expect(preview.diff?.path).toBe(diffPath ?? input.file_path)
      else expect(preview.diff).toBeNull()
    })
  }
})

describe('acp M5 session surface', () => {
  beforeEach(() => {
    responded.length = 0
    permissionCallbacks.length = 0
    closeCalls.length = 0
    sentContents.length = 0
    modeCalls.length = 0
    configWrites.length = 0
    configSettings = []
    replayMessages = []
    nextFakeSessionId = 0
    promptMessages = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'characterization chunk' }] },
      },
    ]
  })

  const initialize = async (h: ReturnType<typeof createHarness>, id = 1, capabilities: Record<string, unknown> = {}) => {
    h.send({ jsonrpc: '2.0', id, method: 'initialize', params: { clientCapabilities: capabilities } })
    return h.waitFor(m => m.id === id, 'initialize')
  }

  it('lists two sessions and advertises image prompt support', async () => {
    const h = createHarness()
    try {
      const init = await initialize(h)
      expect((init.result as any).agentCapabilities.promptCapabilities).toEqual({
        image: true,
        audio: false,
        embeddedContext: false,
      })
      nextFakeSessionId = 1
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'first session')
      h.send({ jsonrpc: '2.0', id: 3, method: 'session/new', params: { cwd: '/other' } })
      await h.waitFor(m => m.id === 3, 'second session')
      h.send({ jsonrpc: '2.0', id: 4, method: 'session/list', params: {} })
      const listed = await h.waitFor(m => m.id === 4, 'session/list')
      expect((listed.result as any).sessions).toEqual([
        { sessionId: 'new-session-1', cwd: '/tmp' },
        { sessionId: 'new-session-2', cwd: '/other' },
      ])
    } finally {
      await h.close()
    }
  })

  it('sets permission mode and emits a current mode update', async () => {
    const h = createHarness()
    try {
      await initialize(h)
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new')
      h.send({ jsonrpc: '2.0', id: 3, method: 'session/set_mode', params: { sessionId: 'fake-session-id', modeId: 'acceptEdits' } })
      await h.waitFor(m => m.id === 3, 'session/set_mode')
      expect(modeCalls).toEqual(['acceptEdits'])
      const update = await h.waitFor(
        m => m.method === 'session/update' && (m.params as any)?.update?.sessionUpdate === 'current_mode_update' && (m.params as any)?.update?.currentModeId === 'acceptEdits',
        'current_mode_update',
      )
      expect(update.method).toBe('session/update')
    } finally {
      await h.close()
    }
  })

  it('passes image prompts through as base64 content blocks', async () => {
    const h = createHarness()
    try {
      await initialize(h)
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new')
      h.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/prompt',
        params: {
          sessionId: 'fake-session-id',
          prompt: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
        },
      })
      await h.waitFor(m => m.id === 3, 'session/prompt')
      expect(sentContents).toContainEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      ])
    } finally {
      await h.close()
    }
  })

  it('replays loaded user and assistant history once', async () => {
    const h = createHarness()
    replayMessages = [
      { type: 'user', message: { content: [{ type: 'text', text: 'previous question' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'previous answer' }] } },
    ]
    try {
      await initialize(h)
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/load', params: { sessionId: 'resumed-id', cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/load')
      const user = await h.waitFor(
        m => m.method === 'session/update' && (m.params as any)?.update?.content?.text === 'previous question',
        'replayed user chunk',
      )
      const assistant = await h.waitFor(
        m => m.method === 'session/update' && (m.params as any)?.update?.content?.text === 'previous answer',
        'replayed assistant chunk',
      )
      expect((user.params as any).update.sessionUpdate).toBe('user_message_chunk')
      expect((assistant.params as any).update.sessionUpdate).toBe('agent_message_chunk')
      const replayed = h.output.filter(m => m.method === 'session/update' && (m.params as any)?.update?.content?.text === 'previous answer')
      expect(replayed).toHaveLength(1)
    } finally {
      await h.close()
    }
  })

  it('forks into a new listed session without copying history', async () => {
    const h = createHarness()
    try {
      await initialize(h)
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new')
      nextFakeSessionId = 1
      h.send({ jsonrpc: '2.0', id: 3, method: 'session/fork', params: { sessionId: 'fake-session-id' } })
      const forked = await h.waitFor(m => m.id === 3, 'session/fork')
      expect((forked.result as any).sessionId).toBe('new-session-1')
      h.send({ jsonrpc: '2.0', id: 4, method: 'session/list', params: {} })
      const listed = await h.waitFor(m => m.id === 4, 'session/list')
      expect((listed.result as any).sessions).toContainEqual({ sessionId: 'new-session-1', cwd: '/tmp' })
    } finally {
      await h.close()
    }
  })

  it('closes and deletes sessions with awaited cleanup', async () => {
    const h = createHarness()
    try {
      await initialize(h)
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } })
      await h.waitFor(m => m.id === 2, 'session/new')
      h.send({ jsonrpc: '2.0', id: 3, method: 'session/delete', params: { sessionId: 'fake-session-id' } })
      await h.waitFor(m => m.id === 3, 'session/delete')
      expect(closeCalls).toHaveLength(1)
      h.send({ jsonrpc: '2.0', id: 4, method: 'session/load', params: { sessionId: 'second-id', cwd: '/tmp' } })
      await h.waitFor(m => m.id === 4, 'session/load')
      h.send({ jsonrpc: '2.0', id: 5, method: 'session/close', params: { sessionId: 'second-id' } })
      await h.waitFor(m => m.id === 5, 'session/close')
      expect(closeCalls).toHaveLength(2)
      h.send({ jsonrpc: '2.0', id: 6, method: 'session/list', params: {} })
      const listed = await h.waitFor(m => m.id === 6, 'session/list')
      expect((listed.result as any).sessions).toEqual([])
    } finally {
      await h.close()
    }
  })

  it('writes a config option and responds with the resulting options', async () => {
    configSettings = [{
      id: 'model',
      type: 'select',
      label: 'Model',
      description: 'Model setting',
      options: ['gpt', 'opus'],
      read: () => 'opus',
      write: (value: unknown) => configWrites.push({ id: 'model', value }),
    }]
    const h = createHarness()
    try {
      await initialize(h)
      h.send({ jsonrpc: '2.0', id: 2, method: 'session/set_config_option', params: { sessionId: 'fake-session-id', configId: 'model', value: 'gpt' } })
      const response = await h.waitFor(m => m.id === 2, 'config option response')
      expect(configWrites).toEqual([{ id: 'model', value: 'gpt' }])
      expect(response.result).toEqual({
        configOptions: [{
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'opus',
          options: [{ value: 'gpt', name: 'gpt' }, { value: 'opus', name: 'opus' }],
        }],
      })
      h.send({ jsonrpc: '2.0', id: 3, method: 'session/set_config_option', params: { sessionId: 'fake-session-id', configId: 'missing', value: 'gpt' } })
      expect((await h.waitFor(m => m.id === 3, 'unknown config option')).error).toMatchObject({ code: -32602 })
      h.send({ jsonrpc: '2.0', id: 4, method: 'authenticate', params: {} })
      expect((await h.waitFor(m => m.id === 4, 'authenticate')).result).toEqual({})
    } finally {
      await h.close()
    }
  })

  it('forwards fs reads to the client and resolves from a matching result', async () => {
    const h = createHarness()
    try {
      await initialize(h, 1, { fs: { readTextFile: true } })
      h.send({ jsonrpc: '2.0', id: 2, method: 'fs/read_text_file', params: { path: '/tmp/a.txt', sessionId: 'fake-session-id' } })
      const outbound = await h.waitFor(m => m.method === 'fs/read_text_file', 'outbound fs request')
      expect(outbound.params).toEqual({ path: '/tmp/a.txt', sessionId: 'fake-session-id' })
      h.send({ jsonrpc: '2.0', id: outbound.id, result: { content: 'hello file' } })
      const response = await h.waitFor(m => m.id === 2 && m.method === undefined, 'forwarded fs result')
      expect(response.result).toEqual({ content: 'hello file' })
    } finally {
      await h.close()
    }
  })
})
