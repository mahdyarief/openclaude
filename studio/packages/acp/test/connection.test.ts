import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  agent,
  type Stream,
  type AgentApp,
  type RequestPermissionResponse,
  AGENT_METHODS,
} from '@agentclientprotocol/sdk'
import { bridgeSocketUrl } from '../src/connection.js'

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

function makeFakeAgent(opts: {
  onLoad?: (params: any) => void
  onNew?: (params: any) => void
  onPrompt?: (params: any) => void
}): AgentApp {
  const app = agent({ name: 'fake-agent' })
  app
    .onRequest(AGENT_METHODS.initialize, () => ({
      protocolVersion: 1,
      agentInfo: { name: 'fake-agent', version: '0.0.0' },
    }))
    .onRequest(AGENT_METHODS.session_new, (ctx) => {
      opts.onNew?.(ctx.params)
      return { sessionId: 'fresh-session', _meta: null }
    })
    .onRequest(AGENT_METHODS.session_load, (ctx) => {
      opts.onLoad?.(ctx.params)
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
