import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  agent,
  type Stream,
  type AgentApp,
  type RequestPermissionResponse,
  AGENT_METHODS,
} from '@agentclientprotocol/sdk'
import { bridgeSocketUrl } from '../src/connection.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBridge } from '../../bridge/src/index.js'

// In this test we replace the real WebSocket transport with an in-memory pair so
// we can assert exactly which ACP requests `createAgentConnection` sends,
// without any network or the `ws` dependency. `createWebSocketStream` is mocked
// to hand back a TransformStream pair (c2a = client->agent, a2c = agent->client).
// We capture that pair and attach a real SDK AgentApp to the opposite ends.

let captured: { c2a: TransformStream; a2c: TransformStream } | undefined

vi.mock('@agentclientprotocol/sdk/experimental/ws-client', () => {
  return {
    createWebSocketStream: () => {
      const c2a = new TransformStream()
      const a2c = new TransformStream()
      captured = { c2a, a2c }
      return { writable: c2a.writable, readable: a2c.readable }
    },
  }
})

// A structurally valid permission response: the fake agent never asks for
// permission, so the outcome is irrelevant, but typing it exactly avoids an
// `as any` that would weaken `exactOptionalPropertyTypes` checking.
const CANCELLED_PERMISSION: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }

type FakeAgentOptions = {
  onInitialize?: (params: unknown) => void
  onLoad?: (params: any) => void
  onNew?: (params: any) => void
  onPrompt?: (params: any) => void
  /** Requests this fake agent received from the client. */
  observed?: Array<{ method: string; params: unknown }>
  /** Probe forwarded client methods while handling session/new. */
  afterNew?: (ctx: any) => Promise<void>
}

function makeFakeAgent(opts: FakeAgentOptions = {}): AgentApp {
  const app = agent({ name: 'fake-agent' })
  app
    .onRequest(AGENT_METHODS.initialize, (ctx) => {
      opts.onInitialize?.(ctx.params)
      return {
        protocolVersion: 1,
        agentInfo: { name: 'fake-agent', version: '0.0.0' },
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      }
    })
    .onRequest(AGENT_METHODS.session_new, async (ctx) => {
      opts.onNew?.(ctx.params)
      opts.observed?.push({ method: AGENT_METHODS.session_new, params: ctx.params })
      await opts.afterNew?.(ctx)
      return { sessionId: 'fresh-session', _meta: null }
    })
    .onRequest(AGENT_METHODS.session_load, (ctx) => {
      opts.onLoad?.(ctx.params)
      return { _meta: null }
    })
    .onRequest(AGENT_METHODS.session_list, (ctx) => {
      opts.observed?.push({ method: AGENT_METHODS.session_list, params: ctx.params })
      return { sessions: [{ sessionId: 'sess-1', cwd: '/work' }] }
    })
    .onRequest(AGENT_METHODS.session_set_mode, (ctx) => {
      opts.observed?.push({ method: AGENT_METHODS.session_set_mode, params: ctx.params })
      return { _meta: null }
    })
    .onRequest(AGENT_METHODS.session_set_config_option, (ctx) => {
      opts.observed?.push({ method: AGENT_METHODS.session_set_config_option, params: ctx.params })
      return { configOptions: [] }
    })
    .onRequest(AGENT_METHODS.session_delete, () => ({ _meta: null }))
    .onRequest(AGENT_METHODS.session_close, () => ({ _meta: null }))
    .onRequest(AGENT_METHODS.session_resume, () => ({ sessionId: 'sess-1', _meta: null }))
    .onRequest(AGENT_METHODS.authenticate, () => ({ _meta: null }))
    .onRequest('*', (ctx) => {
      if (ctx.method === 'session/fork') return { sessionId: 'forked', _meta: null }
      return { _meta: null }
    })
    .onRequest(AGENT_METHODS.session_prompt, (ctx) => {
      opts.onPrompt?.(ctx.params)
      return { stopReason: 'end_turn' as const, _meta: null }
    })
  return app
}

// Attach the agent to the captured stream pair: the agent reads what the client
// wrote (c2a) and writes back on a2c.
function connectFakeAgent(app: AgentApp) {
  const pair = captured
  captured = undefined
  if (!pair) throw new Error('createWebSocketStream was not called')
  const agentStream: Stream = {
    readable: pair.c2a.readable as unknown as Stream['readable'],
    writable: pair.a2c.writable as unknown as Stream['writable'],
  }
  app.connect(agentStream)
}

describe('bridgeSocketUrl', () => {
  it('appends token as query param', () => {
    expect(bridgeSocketUrl('ws://localhost:1234/acp', 'secret')).toBe(
      'ws://localhost:1234/acp?token=secret',
    )
  })

  it('uses & when url already has a query', () => {
    expect(bridgeSocketUrl('ws://localhost:1234/acp?x=1', 'secret')).toBe(
      'ws://localhost:1234/acp?x=1&token=secret',
    )
  })
})

describe('createAgentConnection session selection', () => {
  beforeEach(() => {
    captured = undefined
  })

  it('sends session/load with cwd, empty mcpServers, and the given sessionId', async () => {
    let loadParams: any
    const app = makeFakeAgent({ onLoad: (p) => (loadParams = p) })

    const { createAgentConnection } = await import('../src/connection.js')
    const promise = createAgentConnection({
      url: 'ws://localhost:1234/acp',
      token: 'secret',
      cwd: '/work',
      sessionId: 'sess-1',
      onUpdate: () => {},
      onPermission: async () => CANCELLED_PERMISSION,
    })
    connectFakeAgent(app)
    const handle = await promise

    expect(loadParams).toEqual({ cwd: '/work', mcpServers: [], sessionId: 'sess-1' })
    expect(handle.sessionId).toBe('sess-1')
  })

  it('sends session/new when no sessionId is provided', async () => {
    let newParams: any
    const app = makeFakeAgent({ onNew: (p) => (newParams = p) })

    const { createAgentConnection } = await import('../src/connection.js')
    const promise = createAgentConnection({
      url: 'ws://localhost:1234/acp',
      token: 'secret',
      cwd: '/work',
      onUpdate: () => {},
      onPermission: async () => CANCELLED_PERMISSION,
    })
    connectFakeAgent(app)
    const handle = await promise

    expect(newParams).toBeDefined()
    expect(newParams.cwd).toBe('/work')
    expect(handle.sessionId).toBe('fresh-session')
  })
})

describe('connectHandshake defers session creation', () => {
  beforeEach(() => {
    captured = undefined
  })

  it('does not send session/new during the handshake', async () => {
    let newCalls = 0
    const app = makeFakeAgent({ onNew: () => (newCalls += 1) })

    const { connectHandshake } = await import('../src/connection.js')
    const promise = connectHandshake({
      url: 'ws://localhost:1234/acp',
      token: 'secret',
      onUpdate: () => {},
      onPermission: async () => CANCELLED_PERMISSION,
    })
    connectFakeAgent(app)
    const handshake = await promise

    // Give the fake agent a turn to process anything the client sent.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(newCalls).toBe(0)

    handshake.close()
  })

  it('sends session/new exactly once when startSession is called', async () => {
    const newParams: any[] = []
    const app = makeFakeAgent({ onNew: p => newParams.push(p) })

    const { connectHandshake } = await import('../src/connection.js')
    const promise = connectHandshake({
      url: 'ws://localhost:1234/acp',
      token: 'secret',
      onUpdate: () => {},
      onPermission: async () => CANCELLED_PERMISSION,
    })
    connectFakeAgent(app)
    const handshake = await promise

    const session = await handshake.startSession('/work')
    expect(session.sessionId).toBe('fresh-session')
    expect(newParams).toHaveLength(1)
    expect(newParams[0]?.cwd).toBe('/work')

    handshake.close()
  })
})

describe('ACP client capabilities and forwarded requests', () => {
  beforeEach(() => {
    captured = undefined
  })

  type ProbeResult = unknown
  function makeProbingAgent(results: Record<string, ProbeResult>, root: string, initialize?: (params: unknown) => void) {
    const app = agent({ name: 'probing-agent' })
    const record = (method: string, result: ProbeResult) => { results[method] = result }
    app
      .onRequest(AGENT_METHODS.initialize, ctx => {
        initialize?.(ctx.params)
        return {
          protocolVersion: 1,
          agentInfo: { name: 'probing-agent', version: '0.0.0' },
        }
      })
      .onRequest(AGENT_METHODS.session_list, () => ({ sessions: [{ sessionId: 's1', cwd: root }] }))
      .onRequest(AGENT_METHODS.session_set_mode, () => ({ _meta: null }))
      .onRequest(AGENT_METHODS.session_set_config_option, () => ({
        configOptions: [{ id: 'model', name: 'Model', type: 'select', currentValue: 'fast', options: [] }],
      }))
      .onRequest(AGENT_METHODS.session_delete, () => ({ _meta: null }))
      .onRequest(AGENT_METHODS.session_close, () => ({ _meta: null }))
      .onRequest(AGENT_METHODS.session_resume, () => ({ sessionId: 's1', _meta: null }))
      .onRequest(AGENT_METHODS.authenticate, () => ({ _meta: null }))
      .onRequest('*', ctx => {
        if (ctx.method === 'session/fork') return { sessionId: 'forked', _meta: null }
        return { _meta: null }
      })
      // While handling session/new, ask the client to prove every forwarded
      // method has a live handler and record each response.
      .onRequest(AGENT_METHODS.session_new, async ctx => {
        const sessionId = 's1'
        record('fs/read_text_file', await ctx.client.request('fs/read_text_file', { sessionId, path: join(root, 'note.txt') }))
        record('fs/write_text_file', await ctx.client.request('fs/write_text_file', { sessionId, path: join(root, 'note.txt'), content: 'changed' }))
        const terminal = await ctx.client.createTerminal({
          sessionId,
          command: process.execPath,
          args: ['-e', 'process.stdout.write("hello")'],
          cwd: root,
        })
        record('terminal/wait_for_exit', await terminal.waitForExit())
        record('terminal/output', await terminal.currentOutput())
        await terminal.release()
        record('terminal/release', true)
        const killTerminal = await ctx.client.createTerminal({
          sessionId,
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          cwd: root,
        })
        await killTerminal.kill()
        record('terminal/kill', await killTerminal.waitForExit())
        await killTerminal.release()
        record('elicitation/create', await ctx.client.request('elicitation/create', {
          sessionId,
          mode: 'form',
          message: 'Need input',
          requestedSchema: { type: 'object', properties: {} },
        }))
        return { sessionId, _meta: null }
      })
    return app
  }

  it('advertises real fs, terminal and elicitation handlers and scopes fs to cwd', async () => {
    // The shared /file HTTP seam is authenticated and root-scoped. A temporary
    // bridge rooted at the workspace makes the ACP fs handlers exercise the
    // same seam used by the file explorer.
    const parent = mkdtempSync(join(tmpdir(), 'studio-acp-'))
    const root = join(parent, 'workspace')
    writeFileSync(join(parent, 'outside.txt'), 'outside')
    mkdirSync(root)
    writeFileSync(join(root, 'note.txt'), 'original')
    const bridge = await startBridge({ cwd: root, token: 'secret' })
    const results: Record<string, unknown> = {}
    let capabilities: any
    const app = makeProbingAgent(results, root, params => { capabilities = (params as any).clientCapabilities })
    let handle: Awaited<ReturnType<typeof import('../src/connection.js').createAgentConnection>> | undefined
    try {
      const { createAgentConnection, readWorkspaceFile } = await import('../src/connection.js').then(async mod => ({
        ...mod,
        readWorkspaceFile: (await import('../src/project.js')).readWorkspaceFile,
      }))
      const promise = createAgentConnection({
        url: bridge.url,
        token: bridge.token,
        cwd: root,
        onUpdate: () => {},
        onPermission: async () => CANCELLED_PERMISSION,
      })
      connectFakeAgent(app)
      handle = await promise
      expect(capabilities).toMatchObject({
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        elicitation: { form: {}, url: {} },
      })
      expect(results['fs/read_text_file']).toEqual({ content: 'original' })
      expect(results['fs/write_text_file']).toEqual({})
      expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('changed')
      expect(results['terminal/output']).toMatchObject({ output: 'hello', truncated: false })
      expect(results['terminal/wait_for_exit']).toEqual({ exitCode: 0, signal: null })
      expect(results['terminal/release']).toBe(true)
      expect(results['terminal/kill']).toMatchObject({ signal: 'SIGTERM' })
      expect(results['elicitation/create']).toEqual({ action: 'cancel' })
      await expect(readWorkspaceFile(bridge.url, bridge.token, root, '../outside.txt'))
        .rejects.toThrow(/path escapes root/)
      expect(existsSync(join(root, 'outside.txt'))).toBe(false)
      expect(handle.mcpServers).toEqual([])
    } finally {
      handle?.disconnect()
      await bridge.close()
    }
  })

  it('exposes typed agent session methods and threads MCP status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-acp-'))
    writeFileSync(join(root, 'note.txt'), 'original')
    const bridge = await startBridge({ cwd: root, token: 'secret' })
    const results: Record<string, unknown> = {}
    const app = makeProbingAgent(results, root)
    let handle: Awaited<ReturnType<typeof import('../src/connection.js').createAgentConnection>> | undefined
    try {
      const { createAgentConnection } = await import('../src/connection.js')
      const promise = createAgentConnection({
        url: bridge.url,
        token: bridge.token,
        cwd: root,
        onUpdate: () => {},
        onPermission: async () => CANCELLED_PERMISSION,
        mcpServers: [{ name: 'docs', type: 'http', url: 'https://docs.invalid/mcp', headers: [] }],
      })
      connectFakeAgent(app)
      handle = await promise
      expect(handle.mcpServers).toMatchObject([{ name: 'docs', status: 'approved' }])
      expect(await handle.listSessions()).toMatchObject({ sessions: [{ sessionId: 's1', cwd: root }] })
      expect(await handle.authenticate({ methodId: 'api-key' })).toEqual({ _meta: null })
      expect(await handle.setSessionMode({ sessionId: 's1', modeId: 'plan' })).toEqual({ _meta: null })
      expect(await handle.setConfigOption({ sessionId: 's1', configId: 'model', value: 'fast' })).toMatchObject({ configOptions: [{ id: 'model' }] })
      expect(await handle.forkSession({ sessionId: 's1' })).toEqual({ sessionId: 'forked', _meta: null })
      expect(await handle.resumeSession({ sessionId: 's1', cwd: root })).toEqual({ sessionId: 's1', _meta: null })
      expect(await handle.deleteSession({ sessionId: 's1' })).toEqual({ _meta: null })
      expect(await handle.closeSession({ sessionId: 's1' })).toEqual({ _meta: null })
    } finally {
      handle?.disconnect()
      await bridge.close()
    }
  })
})

describe('loaded-session prompt wiring', () => {
  beforeEach(() => {
    captured = undefined
  })

  async function openLoadedSession(onPrompt: (params: any) => void) {
    const app = makeFakeAgent({ onPrompt })
    const { createAgentConnection } = await import('../src/connection.js')
    const promise = createAgentConnection({
      url: 'ws://localhost:1234/acp',
      token: 'secret',
      cwd: '/work',
      sessionId: 'sess-1',
      onUpdate: () => {},
      onPermission: async () => CANCELLED_PERMISSION,
    })
    connectFakeAgent(app)
    return promise
  }

  it('sends session/prompt with { sessionId, prompt: [text block] } for a string', async () => {
    let promptParams: any
    const handle = await openLoadedSession((p) => (promptParams = p))

    await handle.session.prompt('hi')

    expect(promptParams).toEqual({
      sessionId: 'sess-1',
      prompt: [{ type: 'text', text: 'hi' }],
    })
  })

  it('wraps a single content block in an array', async () => {
    let promptParams: any
    const handle = await openLoadedSession((p) => (promptParams = p))

    await handle.session.prompt({ type: 'text', text: 'block' })

    expect(promptParams.prompt).toEqual([{ type: 'text', text: 'block' }])
  })

  it('passes an array of content blocks through unchanged', async () => {
    let promptParams: any
    const handle = await openLoadedSession((p) => (promptParams = p))
    const blocks = [
      { type: 'text' as const, text: 'one' },
      { type: 'text' as const, text: 'two' },
    ]

    await handle.session.prompt(blocks)

    expect(promptParams.prompt).toEqual(blocks)
  })
})
