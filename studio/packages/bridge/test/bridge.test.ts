import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { startBridge } from '../src/index.js'
import { fileURLToPath } from 'node:url'
import { readFileSync, rmSync } from 'node:fs'

const fakeAgent = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url))

let closer: (() => Promise<void>) | undefined
afterEach(async () => {
  await closer?.()
  closer = undefined
})

// Browsers cannot set an Authorization header on a WebSocket handshake, so the
// token travels as a query parameter. The header form is accepted too, for
// Node clients and desktop sidecars.
function open(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('bridge', () => {
  test('rejects a connection without the token', async () => {
    const bridge = await startBridge({
      agentCommand: { command: process.execPath, args: [fakeAgent] },
    })
    closer = bridge.close

    await expect(open(bridge.url, 'wrong-token')).rejects.toThrow(/401/)
  })

  test('forwards frames between websocket and agent', async () => {
    const bridge = await startBridge({
      agentCommand: { command: process.execPath, args: [fakeAgent] },
    })
    closer = bridge.close

    const socket = await open(bridge.url, bridge.token)
    const reply = new Promise<unknown>(resolve => {
      socket.on('message', data => resolve(JSON.parse(data.toString())))
    })

    socket.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    }))

    expect(await reply).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: { loadSession: false } },
    })
    socket.close()
  })

  test('close() kills spawned agent processes', async () => {
    const pidFile = fileURLToPath(new URL('./fixtures/agent.pid', import.meta.url))
    const bridge = await startBridge({
      agentCommand: { command: process.execPath, args: [fakeAgent] },
      env: { FAKE_AGENT_PID_FILE: pidFile },
    })
    closer = undefined

    const socket = await open(bridge.url, bridge.token)
    socket.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    }))
    await new Promise(resolve => socket.once('message', resolve))

    const pid = Number(readFileSync(pidFile, 'utf8'))
    await bridge.close()

    const alive = (): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 2000
    while (alive() && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
    expect(alive()).toBe(false)
    rmSync(pidFile, { force: true })
  })
})
