import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { PassThrough } from 'node:stream'

type PermissionResult = {
  behavior: 'allow' | 'deny'
  message?: string
  decisionClassification?: string
}

const responded: Array<{ toolUseId: string; decision: PermissionResult }> = []
const permissionCallbacks: Array<(message: unknown) => void> = []

const fakeSession = {
  sessionId: 'fake-session-id',
  sendMessage: async function* () {},
  getMessages: () => [],
  interrupt: () => {},
  close: () => {},
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

const { createAcpServer } = await import('./acp.js')

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
      h.close()
    }
  })
})
