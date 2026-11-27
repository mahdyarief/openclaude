import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getSessionHistory, listProjects, listSessions, sanitizeCwd } from './sessions.js'

const dirs: string[] = []
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ocs-sessions-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('sanitizeCwd', () => {
  test('turns an absolute posix path into a project dir name', () => {
    expect(sanitizeCwd('/home/dy/code/app')).toBe('-home-dy-code-app')
  })
  test('replaces every non-alphanumeric character', () => {
    expect(sanitizeCwd('/home/dy/my_app.v2')).toBe('-home-dy-my-app-v2')
  })
})

describe('listProjects', () => {
  test('lists directories with their session counts', async () => {
    const root = await tempRoot()
    const project = join(root, '-home-dy-code-app')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 'a.jsonl'), '{}\n')
    await writeFile(join(project, 'b.jsonl'), '{}\n')
    await writeFile(join(project, 'b.replay.json'), '')
    expect(await listProjects(root)).toEqual([
      { name: '-home-dy-code-app', path: '/home/dy/code/app', sessionCount: 2 },
    ])
  })
  test('recovers the real cwd for a project whose name contains a hyphen', async () => {
    const root = await tempRoot()
    const project = join(root, 'd--github-agent-workspace')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 's1.jsonl'),
      JSON.stringify({ type: 'session', cwd: 'D:\\Github\\agent-workspace' }) + '\n',
    )
    expect(await listProjects(root)).toEqual([
      { name: 'd--github-agent-workspace', path: 'D:\\Github\\agent-workspace', sessionCount: 1 },
    ])
  })
  test('falls back to the inverted dir name when no session records a cwd', async () => {
    const root = await tempRoot()
    const project = join(root, 'd--github-agent-workspace')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 's1.jsonl'), '{}\n')
    expect(await listProjects(root)).toEqual([
      { name: 'd--github-agent-workspace', path: 'd//github/agent/workspace', sessionCount: 1 },
    ])
  })
  test('returns an empty list when the root does not exist', async () => {
    expect(await listProjects(join(tmpdir(), 'ocs-missing-root-xyz'))).toEqual([])
  })
})

describe('listSessions', () => {
  test('returns one summary per jsonl file with the first user text as title', async () => {
    const root = await tempRoot()
    const project = join(root, '-home-dy-code-app')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 's1.jsonl'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'first task' }] } }) + '\n',
    )
    await writeFile(join(project, 's2.jsonl'), '{}\n')
    const sessions = await listSessions(root, '/home/dy/code/app')
    expect(sessions.map(s => s.id).sort()).toEqual(['s1', 's2'])
    expect(sessions.find(s => s.id === 's1')?.title).toBe('first task')
  })
  test('ignores replay sidecar files', async () => {
    const root = await tempRoot()
    const project = join(root, '-home-dy-code-app')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 's1.jsonl'), '{}\n')
    await writeFile(join(project, 's1.replay.json'), '')
    expect(await listSessions(root, '/home/dy/code/app')).toHaveLength(1)
  })
})

describe('getSessionHistory', () => {
  function jsonl(lines: unknown[]): string {
    return lines.map(line => JSON.stringify(line)).join('\n') + '\n'
  }

  test('groups consecutive lines of one assistant turn by message.id', async () => {
    const root = await tempRoot()
    const project = join(root, '-home-dy-code-app')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 's1.jsonl'),
      jsonl([
        { type: 'user', message: { role: 'user', id: 'u1', content: [{ type: 'text', text: 'hello' }] } },
        { type: 'assistant', message: { role: 'assistant', id: 'a1', content: [{ type: 'thinking', thinking: 'hmm' }] } },
        { type: 'assistant', message: { role: 'assistant', id: 'a1', content: [{ type: 'text', text: 'reply' }] } },
        { type: 'assistant', message: { role: 'assistant', id: 'a1', content: [{ type: 'tool_use', id: 'tool-1' }] } },
      ]),
    )
    const history = await getSessionHistory(root, '/home/dy/code/app', 's1')
    expect(history).toEqual([
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'hello' }] },
      {
        id: 'a1',
        role: 'agent',
        parts: [
          { kind: 'thought', text: 'hmm' },
          { kind: 'text', text: 'reply' },
          { kind: 'tool', toolCallId: 'tool-1' },
        ],
      },
    ])
  })

  test('keeps separate turns distinct when ids differ', async () => {
    const root = await tempRoot()
    const project = join(root, '-home-dy-code-app')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 's2.jsonl'),
      jsonl([
        { type: 'user', message: { role: 'user', id: 'u1', content: 'a' } },
        { type: 'user', message: { role: 'user', id: 'u2', content: 'b' } },
      ]),
    )
    const history = await getSessionHistory(root, '/home/dy/code/app', 's2')
    expect(history.map(m => m.id)).toEqual(['u1', 'u2'])
  })

  test('skips system lines and empty turns', async () => {
    const root = await tempRoot()
    const project = join(root, '-home-dy-code-app')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 's3.jsonl'),
      jsonl([
        { type: 'system', message: { role: 'system', id: 'sys', content: 'boot' } },
        { type: 'assistant', message: { role: 'assistant', id: 'a1', content: [] } },
        '',
        { type: 'user', message: { role: 'user', id: 'u1', content: [{ type: 'text', text: 'real' }] } },
      ]),
    )
    const history = await getSessionHistory(root, '/home/dy/code/app', 's3')
    expect(history).toEqual([
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'real' }] },
    ])
  })

  test('returns an empty array for a missing session', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '-home-dy-code-app'), { recursive: true })
    expect(await getSessionHistory(root, '/home/dy/code/app', 'nope')).toEqual([])
  })
})
