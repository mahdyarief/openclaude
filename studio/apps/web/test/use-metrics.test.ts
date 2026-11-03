import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { httpOrigin } from '@openclaude-studio/acp'
import { fetchMetrics } from '../src/use-metrics.js'
import type { BridgeConfig } from '../src/bridge-config.js'

const servers: ReturnType<typeof createServer>[] = []

async function startFakeBridge(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ config: BridgeConfig; close: () => void }> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return {
    config: { url: `http://127.0.0.1:${address.port}`, token: 'test-token' },
    close: () => server.close(),
  }
}

const payload = {
  timestamp: 1,
  cpuPercent: 12,
  cpuCount: 4,
  load1: 0.5,
  load5: 0.4,
  load15: 0.3,
  memory: { rssBytes: 1024, heapUsedBytes: 512, heapTotalBytes: 768, externalBytes: 16 },
  systemMemory: { totalBytes: 2048, freeBytes: 1024, usedPercent: 50 },
  uptimeSeconds: 10,
  bridgeUptimeSeconds: 5,
  activeSessions: 2,
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('fetchMetrics', () => {
  test('reads host metrics from the bridge endpoint', async () => {
    let requestedUrl: string | undefined
    const { config } = await startFakeBridge((req, res) => {
      requestedUrl = req.url
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })

    const metrics = await fetchMetrics(config)

    expect(requestedUrl).toBe('/metrics?token=test-token')
    expect(metrics).toEqual(payload)
  })

  test('rejects when the bridge is unreachable', async () => {
    await expect(
      fetchMetrics({ url: 'http://127.0.0.1:1', token: 'x' }),
    ).rejects.toThrow()
  })

  test('rejects when the token is wrong', async () => {
    const { config } = await startFakeBridge((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
    })

    await expect(fetchMetrics(config)).rejects.toThrow(/401/)
  })

  test('builds the request URL from httpOrigin', () => {
    const config: BridgeConfig = { url: 'http://localhost:9999', token: 'test-token' }
    const url = `${httpOrigin(config.url)}/metrics?token=${encodeURIComponent(config.token)}`
    expect(url).toBe('http://localhost:9999/metrics?token=test-token')
  })
})
