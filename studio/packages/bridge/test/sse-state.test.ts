import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBridge } from '../src/index.js'

const httpUrl = (wsUrl: string): string => wsUrl.replace(/^ws:/, 'http:')

let home = ''
let stateFile = ''
let closer: (() => Promise<void>) | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ocs-sse-'))
  stateFile = join(home, '.config', 'openclaude-studio', 'state.json')
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.OPENCLAUDE_STUDIO_STATE_FILE = stateFile
})

afterEach(async () => {
  await closer?.()
  closer = undefined
  delete process.env.HOME
  delete process.env.USERPROFILE
  delete process.env.OPENCLAUDE_STUDIO_STATE_FILE
  rmSync(home, { recursive: true, force: true })
})

// Reads SSE `event: state` payloads until one satisfies `match`.
function readStateEvent(
  stream: ReadableStream<Uint8Array>,
  match: (state: { sessions: { id: string }[] }) => boolean = () => true,
): Promise<string> {
  const reader = stream
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader()
  return new Promise((resolve, reject) => {
    let buffer = ''
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) return reject(new Error('stream ended before matching state event'))
        buffer += value
        let idx = buffer.indexOf('data:')
        while (idx !== -1) {
          const end = buffer.indexOf('\n', idx)
          if (end === -1) break
          const line = buffer.slice(idx, end).replace(/^data:\s*/, '').trim()
          buffer = buffer.slice(end + 1)
          try {
            const parsed = JSON.parse(line) as { sessions: { id: string }[] }
            if (match(parsed)) return resolve(line)
          } catch {
            /* not a data frame, keep reading */
          }
          idx = buffer.indexOf('data:')
        }
        pump()
      }, reject)
    }
    pump()
  })
}

describe('GET /state/stream (SSE)', () => {
  it('responds with text/event-stream and the current state', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/state/stream?token=${encodeURIComponent(bridge.token)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const payload = await readStateEvent(res.body!)
    const state = JSON.parse(payload) as { sessions: unknown[] }
    expect(Array.isArray(state.sessions)).toBe(true)
  })

  it('pushes an event when /state is updated via PUT', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const stream = await fetch(`${httpUrl(bridge.url)}/state/stream?token=${encodeURIComponent(bridge.token)}`)
    const reader = readStateEvent(stream.body!, state => state.sessions.some(s => s.id === 's1'))

    // Give the SSE subscription a tick to register before writing.
    await new Promise(resolve => setTimeout(resolve, 50))

    await fetch(`${httpUrl(bridge.url)}/state?token=${encodeURIComponent(bridge.token)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaces: [], activePath: null, sessions: [{ id: 's1', title: 's1' }] }),
    })

    const payload = await reader
    const state = JSON.parse(payload) as { sessions: { id: string }[] }
    expect(state.sessions.map(s => s.id)).toContain('s1')
  })

  it('assigns a distinct rev to concurrent writes', async () => {
    const bridge = await startBridge()
    closer = bridge.close
    const put = (id: string): Promise<Response> =>
      fetch(`${httpUrl(bridge.url)}/state?token=${encodeURIComponent(bridge.token)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaces: [], activePath: null, sessions: [{ id, title: id }] }),
      })

    const [a, b] = await Promise.all([put('a'), put('b')])
    const revs = [
      ((await a.json()) as { rev: number }).rev,
      ((await b.json()) as { rev: number }).rev,
    ].sort()

    expect(revs).toEqual([1, 2])
  })

  it('rejects a request without a token', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/state/stream`)
    expect(res.status).toBe(401)
  })

  it('normalizes permissionMode on PUT and replays it', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const put = (mode: string): Promise<Response> =>
      fetch(`${httpUrl(bridge.url)}/state?token=${encodeURIComponent(bridge.token)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaces: [],
          activePath: null,
          sessions: [],
          permissionMode: mode,
        }),
      })

    const res = await put('fullAccess')
    const saved = (await res.json()) as { permissionMode: string; rev: number }
    expect(saved.permissionMode).toBe('fullAccess')
    expect(saved.rev).toBe(1)

    // An unknown mode leaves the previously-set mode intact (no reset to default).
    const fallback = await put('not-a-mode')
    const savedFallback = (await fallback.json()) as { permissionMode: string }
    expect(savedFallback.permissionMode).toBe('fullAccess')

    // GET /state reflects the latest valid write.
    const res2 = await fetch(`${httpUrl(bridge.url)}/state?token=${encodeURIComponent(bridge.token)}`)
    const state = (await res2.json()) as { permissionMode: string }
    expect(state.permissionMode).toBe('fullAccess')
  })
})
