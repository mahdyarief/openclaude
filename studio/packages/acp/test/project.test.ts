import { describe, expect, test, vi } from 'vitest'
import { httpOrigin, listProjects, listProjectSessions } from '../src/project.js'

describe('httpOrigin', () => {
  test('maps ws to http', () => {
    expect(httpOrigin('ws://100.84.56.62:8787')).toBe('http://100.84.56.62:8787')
  })
  test('maps wss to https', () => {
    expect(httpOrigin('wss://example.test')).toBe('https://example.test')
  })
})

describe('listProjects', () => {
  test('requests the projects endpoint with the token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ projects: [{ name: 'n', path: '/p', sessionCount: 1 }] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const projects = await listProjects('ws://host:8787', 'tok')
    expect(fetchMock).toHaveBeenCalledWith('http://host:8787/projects?token=tok', expect.anything())
    expect(projects).toEqual([{ name: 'n', path: '/p', sessionCount: 1 }])
    vi.unstubAllGlobals()
  })
})

describe('listProjectSessions', () => {
  test('encodes cwd and token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sessions: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await listProjectSessions('ws://host:8787', 'tok', '/a b/c')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host:8787/sessions?cwd=%2Fa%20b%2Fc&token=tok',
      expect.anything(),
    )
    vi.unstubAllGlobals()
  })
})
