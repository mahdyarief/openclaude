import { describe, it, expect, afterEach } from 'vitest'
import { listDirectory, readFileScoped, writeFileScoped } from '../src/fs.js'
import { startBridge } from '../src/index.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ocs-fs-'))
writeFileSync(join(root, 'a.txt'), 'hi')
mkdirSync(join(root, 'sub'))
writeFileSync(join(root, 'sub', 'b.txt'), 'yo')
const binaryRoot = mkdtempSync(join(tmpdir(), 'ocs-fs-bin-'))
writeFileSync(join(binaryRoot, 'image.png'), Buffer.alloc(0))

describe('listDirectory', () => {
  it('lists entries with kind and size', () => {
    const out = listDirectory(root, '.')
    const names = out.entries.map(e => e.name).sort()
    expect(names).toEqual(['a.txt', 'sub'])
    expect(out.entries.find(e => e.name === 'sub')?.kind).toBe('dir')
  })
  it('rejects traversal outside root', () => {
    expect(() => listDirectory(root, '../')).toThrow()
  })
})

describe('readFileScoped', () => {
  it('reads a text file relative to root', () => {
    const out = readFileScoped(root, 'sub/b.txt')
    expect(out.text).toBe('yo')
    expect(out.truncated).toBe(false)
    expect(out.path).toBe(join('sub', 'b.txt'))
  })

  it('rejects traversal outside root', () => {
    expect(() => readFileScoped(root, '../secret.txt')).toThrow()
  })

  it('rejects a directory', () => {
    expect(() => readFileScoped(root, 'sub')).toThrow()
  })

  it('flags binary extensions as truncated without text', () => {
    const out = readFileScoped(binaryRoot, 'image.png')
    expect(out.truncated).toBe(true)
  })
})

describe('writeFileScoped', () => {
  const writeRoot = mkdtempSync(join(tmpdir(), 'ocs-fs-write-'))
  writeFileSync(join(writeRoot, 'note.txt'), 'before')
  mkdirSync(join(writeRoot, 'dir'))

  it('writes text that readFileScoped then returns', () => {
    writeFileScoped(writeRoot, 'note.txt', 'after')
    expect(readFileScoped(writeRoot, 'note.txt').text).toBe('after')
  })

  it('rejects traversal outside root', () => {
    expect(() => writeFileScoped(writeRoot, '../secret.txt', 'x')).toThrow()
  })

  it('rejects a directory target', () => {
    expect(() => writeFileScoped(writeRoot, 'dir', 'x')).toThrow()
  })
})

describe('GET /fs CORS', () => {
  let closer: (() => Promise<void>) | undefined
  afterEach(async () => {
    await closer?.()
    closer = undefined
  })

  const httpUrl = (wsUrl: string): string => wsUrl.replace(/^ws:/, 'http:')

  it('allows cross-origin reads on success', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/fs?path=.&token=${encodeURIComponent(bridge.token)}`,
      { headers: { origin: 'http://localhost:8768' } },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8768')
    const body = await res.json() as { entries: { name: string }[] }
    expect(body.entries.map(e => e.name).sort()).toEqual(['a.txt', 'sub'])
  })

  it('keeps 401 for a wrong token but still exposes CORS', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/fs?path=.&token=wrong-token`,
      { headers: { origin: 'http://localhost:8768' } },
    )

    expect(res.status).toBe(401)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8768')
  })

  it('answers OPTIONS /fs with 204 and CORS headers', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/fs`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8768' },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8768')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
  })

  it('scopes /fs to the root query parameter', async () => {
    const other = mkdtempSync(join(tmpdir(), 'ocs-fs-other-'))
    writeFileSync(join(other, 'only-here.txt'), 'x')
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/fs?path=.&root=${encodeURIComponent(other)}&token=${encodeURIComponent(bridge.token)}`,
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { root: string; entries: { name: string }[] }
    expect(body.root).toBe(other)
    expect(body.entries.map(e => e.name)).toEqual(['only-here.txt'])
  })
})

describe('GET /file', () => {
  let closer: (() => Promise<void>) | undefined
  afterEach(async () => {
    await closer?.()
    closer = undefined
  })

  const httpUrl = (wsUrl: string): string => wsUrl.replace(/^ws:/, 'http:')

  it('returns file text for a scoped path', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const query = new URLSearchParams({ path: 'sub/b.txt', root, token: bridge.token })
    const res = await fetch(`${httpUrl(bridge.url)}/file?${query.toString()}`)

    expect(res.status).toBe(200)
    const body = await res.json() as { text: string; truncated: boolean }
    expect(body.text).toBe('yo')
    expect(body.truncated).toBe(false)
  })

  it('rejects a missing token', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/file?path=a.txt&root=${encodeURIComponent(root)}`)

    expect(res.status).toBe(401)
  })

  it('returns 400 with an error message for a bad path', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const query = new URLSearchParams({ path: '../escape.txt', root, token: bridge.token })
    const res = await fetch(`${httpUrl(bridge.url)}/file?${query.toString()}`)

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('escapes root')
  })
})

describe('PUT /file', () => {
  let closer: (() => Promise<void>) | undefined
  afterEach(async () => {
    await closer?.()
    closer = undefined
  })

  const httpUrl = (wsUrl: string): string => wsUrl.replace(/^ws:/, 'http:')

  it('writes text and returns the re-read file', async () => {
    const writeRoot = mkdtempSync(join(tmpdir(), 'ocs-fs-put-'))
    writeFileSync(join(writeRoot, 'note.txt'), 'before')
    const bridge = await startBridge({ cwd: writeRoot })
    closer = bridge.close

    const query = new URLSearchParams({ path: 'note.txt', root: writeRoot, token: bridge.token })
    const res = await fetch(`${httpUrl(bridge.url)}/file?${query.toString()}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'after' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { text: string }
    expect(body.text).toBe('after')
    expect(readFileScoped(writeRoot, 'note.txt').text).toBe('after')
  })

  it('rejects a missing token', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/file?path=a.txt&root=${encodeURIComponent(root)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'nope' }),
    })

    expect(res.status).toBe(401)
  })

  it('rejects traversal with 400', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const query = new URLSearchParams({ path: '../escape.txt', root, token: bridge.token })
    const res = await fetch(`${httpUrl(bridge.url)}/file?${query.toString()}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('escapes root')
  })

  it('rejects a body without a text string', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const query = new URLSearchParams({ path: 'a.txt', root, token: bridge.token })
    const res = await fetch(`${httpUrl(bridge.url)}/file?${query.toString()}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    })

    expect(res.status).toBe(400)
  })
})

describe('tokenless mode', () => {
  let closer: (() => Promise<void>) | undefined
  afterEach(async () => {
    await closer?.()
    closer = undefined
  })

  const httpUrl = (wsUrl: string): string => wsUrl.replace(/^ws:/, 'http:')

  it('serves /fs without a token', async () => {
    const bridge = await startBridge({ cwd: root, tokenless: true })
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/fs?path=.&root=${encodeURIComponent(root)}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { entries: { name: string }[] }
    expect(body.entries.map(e => e.name)).toContain('a.txt')
  })

  it('writes via PUT /file without a token', async () => {
    const writeRoot = mkdtempSync(join(tmpdir(), 'ocs-fs-tokenless-'))
    writeFileSync(join(writeRoot, 'note.txt'), 'before')
    const bridge = await startBridge({ cwd: writeRoot, tokenless: true })
    closer = bridge.close

    const res = await fetch(
      `${httpUrl(bridge.url)}/file?path=note.txt&root=${encodeURIComponent(writeRoot)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'after' }),
      },
    )

    expect(res.status).toBe(200)
    expect(readFileScoped(writeRoot, 'note.txt').text).toBe('after')
  })

  it('still rejects requests without a token when tokenless is off', async () => {
    const bridge = await startBridge({ cwd: root })
    closer = bridge.close

    const res = await fetch(`${httpUrl(bridge.url)}/fs?path=.&root=${encodeURIComponent(root)}`)
    expect(res.status).toBe(401)
  })
})
