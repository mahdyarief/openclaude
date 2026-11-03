import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBridge } from '../src/index.js'

const httpUrl = (wsUrl: string): string => wsUrl.replace(/^ws:/, 'http:')

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
let home = ''
let closer: (() => Promise<void>) | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ocs-sessions-http-'))
  const project = join(home, '.openclaude', 'projects', '-home-dy-code-app')
  mkdirSync(project, { recursive: true })
  writeFileSync(
    join(project, 's1.jsonl'),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'first task' }] } }) + '\n',
  )
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(async () => {
  await closer?.()
  closer = undefined
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile
  rmSync(home, { recursive: true, force: true })
})

describe('GET /projects', () => {
  it('rejects a request without a token', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/projects`)

    expect(res.status).toBe(401)
  })

  it('lists projects with the token and reflects the origin', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/projects?token=${encodeURIComponent(bridge.token)}`,
      { headers: { origin: 'http://localhost:8768' } },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8768')
    const body = await res.json() as { projects: unknown[] }
    expect(body.projects).toEqual([
      { name: '-home-dy-code-app', path: '/home/dy/code/app', sessionCount: 1 },
    ])
  })
})

describe('GET /metrics', () => {
  it('requires the token', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/metrics`)

    expect(res.status).toBe(401)
  })

  it('returns host resource metrics with the token', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/metrics?token=${encodeURIComponent(bridge.token)}`,
      { headers: { origin: 'http://localhost:8768' } },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8768')
    const body = await res.json() as {
      cpuPercent: number
      cpuCount: number
      memory: { rssBytes: number }
      systemMemory: { totalBytes: number; usedPercent: number }
      activeSessions: number
    }
    expect(body.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(body.cpuCount).toBeGreaterThanOrEqual(1)
    expect(body.memory.rssBytes).toBeGreaterThan(0)
    expect(body.systemMemory.totalBytes).toBeGreaterThan(0)
    expect(body.activeSessions).toBe(0)
  })
})

describe('GET /sessions', () => {
  it('rejects a request without a token', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/sessions?cwd=${encodeURIComponent('/home/dy/code/app')}`,
    )

    expect(res.status).toBe(401)
  })

  it('rejects a request without cwd', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/sessions?token=${encodeURIComponent(bridge.token)}`)

    expect(res.status).toBe(400)
  })

  it('lists sessions for a cwd and reflects the origin', async () => {
    const bridge = await startBridge()
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/sessions?cwd=${encodeURIComponent('/home/dy/code/app')}&token=${encodeURIComponent(bridge.token)}`,
      { headers: { origin: 'http://localhost:8768' } },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8768')
    const body = await res.json() as { sessions: Array<{ id: string; title: string; messageCount: number }> }
    expect(body.sessions.map(s => s.id)).toEqual(['s1'])
    expect(body.sessions[0]?.title).toBe('first task')
    expect(body.sessions[0]?.messageCount).toBe(1)
  })
})
