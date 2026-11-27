# Project-First Sessions — Detailed Tasks (part 1: bridge + acp)

> Companion to `2026-11-01-project-first-sessions.md`. Follow the Global Constraints there.

---

### Task 1: Bridge session store reader

**Files:**
- Create: `packages/bridge/src/sessions.ts`
- Test: `packages/bridge/src/sessions.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type ProjectSummary = { name: string; path: string; sessionCount: number }
  export type SessionSummary = { id: string; title: string; updatedAt: number; messageCount: number }
  export function projectsRoot(home?: string): string
  export function sanitizeCwd(cwd: string): string
  export function projectDirNameToPath(name: string): string
  export function listProjects(root: string): Promise<ProjectSummary[]>
  export function listSessions(root: string, cwd: string): Promise<SessionSummary[]>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { listProjects, listSessions, sanitizeCwd } from './sessions.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/bridge && pnpm exec vitest run src/sessions.test.ts`
Expected: FAIL with "Cannot find module './sessions.js'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ProjectSummary = { name: string; path: string; sessionCount: number }
export type SessionSummary = {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

// OpenClaude stores sessions under ~/.openclaude/projects, one directory per
// working directory, named by replacing every non-alphanumeric char with '-'.
export function projectsRoot(home: string = homedir()): string {
  return join(home, '.openclaude', 'projects')
}

export function sanitizeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function projectDirNameToPath(name: string): string {
  return name.replace(/-/g, '/')
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function listProjects(root: string): Promise<ProjectSummary[]> {
  const entries = await safeReaddir(root)
  const projects: ProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const files = await safeReaddir(dir)
    const sessionCount = files.filter(f => f.isFile() && f.name.endsWith('.jsonl')).length
    projects.push({ name: entry.name, path: projectDirNameToPath(entry.name), sessionCount })
  }
  return projects.sort((a, b) => a.path.localeCompare(b.path))
}

function firstUserText(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      message?: { content?: Array<{ type?: string; text?: string }> }
    }
    if (parsed.type !== 'user') return null
    const text = parsed.message?.content?.find(part => part.type === 'text')?.text
    return text?.trim() || null
  } catch {
    return null
  }
}

export async function listSessions(root: string, cwd: string): Promise<SessionSummary[]> {
  const dir = join(root, sanitizeCwd(cwd))
  const entries = await safeReaddir(dir)
  const sessions: SessionSummary[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const file = join(dir, entry.name)
    const info = await stat(file)
    let title: string | null = null
    let messageCount = 0
    try {
      const content = await readFile(file, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      messageCount = lines.length
      for (const line of lines) {
        title ??= firstUserText(line)
        if (title) break
      }
    } catch {
      // Unreadable session file: still surface it with a fallback title.
    }
    sessions.push({
      id: entry.name.slice(0, -'.jsonl'.length),
      title: title ?? entry.name.slice(0, -'.jsonl'.length),
      updatedAt: info.mtimeMs,
      messageCount,
    })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/bridge && pnpm exec vitest run src/sessions.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/sessions.ts packages/bridge/src/sessions.test.ts
git commit -m "feat(bridge): read OpenClaude session store from disk"
```

---

### Task 2: Bridge `/projects` and `/sessions` endpoints

**Files:**
- Modify: `packages/bridge/src/index.ts`
- Test: `packages/bridge/src/http.test.ts` (extend if present)

**Interfaces:**
- Consumes: `listProjects`, `listSessions`, `projectsRoot` from `./sessions.js`.
- Produces: `GET /projects?token=…` → `{ projects: ProjectSummary[] }`; `GET /sessions?cwd=<abs>&token=…` → `{ sessions: SessionSummary[] }`.

- [ ] **Step 1: Inspect the existing HTTP handler**

Run: `cd packages/bridge && grep -n "pathname\|/fs\|token\|createServer" src/index.ts | head -40`
Expected: shows the route dispatch and token check. Note exactly where the token check happens so the new routes sit after it.

- [ ] **Step 2: Write the failing test**

If `src/http.test.ts` exists, add this block and reuse its server helper. If it does not, skip creating a new harness here and instead add an integration assertion to the existing test style (the bridge tests already exercise the server).

```ts
import { describe, expect, test } from 'vitest'
import { createServer } from './test-server.js'

describe('session endpoints', () => {
  test('rejects a request without a token', async () => {
    const server = await createServer()
    const res = await fetch(`${server.url}/projects`)
    expect(res.status).toBe(401)
    await server.close()
  })
  test('lists projects with the token', async () => {
    const server = await createServer({
      projects: [{ name: '-home-dy-code-app', path: '/home/dy/code/app', sessionCount: 2 }],
    })
    const res = await fetch(`${server.url}/projects?token=${server.token}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      projects: [{ name: '-home-dy-code-app', path: '/home/dy/code/app', sessionCount: 2 }],
    })
    await server.close()
  })
  test('lists sessions for a cwd', async () => {
    const server = await createServer({ sessions: [{ id: 's1', title: 'hi', updatedAt: 1, messageCount: 2 }] })
    const res = await fetch(`${server.url}/sessions?cwd=${encodeURIComponent('/home/dy/code/app')}&token=${server.token}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessions: [{ id: 's1', title: 'hi', updatedAt: 1, messageCount: 2 }] })
    await server.close()
  })
  test('rejects a sessions request without cwd', async () => {
    const server = await createServer()
    const res = await fetch(`${server.url}/sessions?token=${server.token}`)
    expect(res.status).toBe(400)
    await server.close()
  })
})
```

If you must create `src/test-server.ts` because none exists, mirror the real handler's token logic and inject fakes:

```ts
import { createServer as createHttpServer, type Server } from 'node:http'
import { once } from 'node:events'
import type { ProjectSummary, SessionSummary } from './sessions.js'

export type TestServerOptions = { projects?: ProjectSummary[]; sessions?: SessionSummary[] }

export async function createServer(options: TestServerOptions = {}) {
  const token = 'test-token'
  const server: Server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.searchParams.get('token') !== token) {
      res.writeHead(401).end('unauthorized')
      return
    }
    if (url.pathname === '/projects') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ projects: options.projects ?? [] }))
      return
    }
    if (url.pathname === '/sessions') {
      const cwd = url.searchParams.get('cwd')
      if (!cwd) {
        res.writeHead(400).end('cwd is required')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions: options.sessions ?? [] }))
      return
    }
    res.writeHead(404).end('not found')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    token,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
```

> Prefer extending a real harness over adding a second one. The deliverable is the routes, not a new test harness.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/bridge && pnpm exec vitest run src/http.test.ts`
Expected: FAIL (routes missing)

- [ ] **Step 4: Implement the routes**

Add the import at the top of `packages/bridge/src/index.ts`:

```ts
import { listProjects, listSessions, projectsRoot } from './sessions.js'
```

Add these branches next to `/fs` (after the token check):

```ts
if (url.pathname === '/projects') {
  const projects = await listProjects(projectsRoot())
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ projects }))
  return
}

if (url.pathname === '/sessions') {
  const cwd = url.searchParams.get('cwd')
  if (!cwd) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'cwd is required' }))
    return
  }
  const sessions = await listSessions(projectsRoot(), cwd)
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ sessions }))
  return
}
```

Verify the handler is `async` (it must be, for `/fs`). If not, make it async.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/bridge && pnpm exec vitest run`
Expected: all bridge tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/index.ts packages/bridge/src/http.test.ts
git commit -m "feat(bridge): expose projects and sessions over http"
```

---

### Task 3: ACP connection supports loading an existing session

**Files:**
- Modify: `packages/acp/src/connection.ts`
- Test: `packages/acp/src/connection.test.ts`

**Interfaces:**
- Consumes: `AGENT_METHODS` from the SDK.
- Produces:
  ```ts
  export type AgentConnectionOptions = {
    url: string
    token: string
    cwd: string
    sessionId?: string
    onUpdate: (notification: SessionNotification) => void
    onPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  }
  ```
  `createAgentConnection` loads `sessionId` when provided, else starts a new session.

- [ ] **Step 1: Read the SDK session API (do not guess)**

Run: `cd packages/acp && grep -n "buildSession\|session_load\|session_new\|SessionBuilder" node_modules/@agentclientprotocol/sdk/dist/v1/acp.d.ts | head -30`
Expected: shows `buildSession` signatures / `AGENT_METHODS.session_load`. Record the exact shape before writing code.

- [ ] **Step 2: Write the failing test**

Extend the existing `connection.test.ts` (it already has a fake transport). Add:

```ts
test('sends session/load when a sessionId is provided', async () => {
  const { createAgentConnection, fakeAgent } = await setupFakeAgent()
  const handle = await createAgentConnection({
    url: fakeAgent.url,
    token: 't',
    cwd: '/repo',
    sessionId: 'sess-1',
    onUpdate: () => {},
    onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  })
  expect(fakeAgent.calls).toContainEqual({
    method: 'session/load',
    params: { cwd: '/repo', sessionId: 'sess-1', mcpServers: [] },
  })
  expect(handle.sessionId).toBe('sess-1')
})
```

Adapt `setupFakeAgent` to the harness already in the file. If none exists, use the existing integration fake and assert the same method name.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/acp && pnpm exec vitest run src/connection.test.ts`
Expected: FAIL — `sessionId` not accepted / `session/load` never sent.

- [ ] **Step 4: Implement load support**

Add `sessionId?: string` to `AgentConnectionOptions`. In `createAgentConnection`, after the existing `initialize` handshake and where `session/new` is currently started, branch:

```ts
const session = options.sessionId
  ? await connection.agent.request(AGENT_METHODS.session_load, {
      cwd: options.cwd,
      mcpServers: [],
      sessionId: options.sessionId,
    })
  : await connection.agent.buildSession(options.cwd).start()
```

If the SDK exposes a `SessionBuilder` overload for loading, prefer it over the raw request — but only after confirming the signature in Step 1. The required wire behavior is: method `session/load`, params `{ cwd, mcpServers: [], sessionId }`.

The returned `ActiveSession` must be wrapped the same way the current `session/new` result is wrapped so `handle.session`, `handle.sessionId`, `handle.agentInfo`, `handle.disconnect` keep their existing types. If `session/load` returns only a response (no `ActiveSession`), construct the handle with `sessionId: options.sessionId` and reuse the connection for `session/prompt`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/acp && pnpm exec vitest run src/connection.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/acp/src/connection.ts packages/acp/src/connection.test.ts
git commit -m "feat(acp): load an existing session by id"
```

---

### Task 4: Shared project/session types and fetchers

**Files:**
- Create: `packages/acp/src/project.ts`
- Test: `packages/acp/src/project.test.ts`
- Modify: `packages/acp/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (UI-facing mirror of Task 1's shapes).
- Produces:
  ```ts
  export type ProjectSummary = { name: string; path: string; sessionCount: number }
  export type SessionSummary = { id: string; title: string; updatedAt: number; messageCount: number }
  export function httpOrigin(bridgeUrl: string): string
  export async function listProjects(baseUrl: string, token: string): Promise<ProjectSummary[]>
  export async function listProjectSessions(baseUrl: string, token: string, cwd: string): Promise<SessionSummary[]>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from 'vitest'
import { httpOrigin, listProjects, listProjectSessions } from './project.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/acp && pnpm exec vitest run src/project.test.ts`
Expected: FAIL with "Cannot find module './project.js'"

- [ ] **Step 3: Write minimal implementation**

```ts
export type ProjectSummary = { name: string; path: string; sessionCount: number }
export type SessionSummary = {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

// The bridge serves HTTP on the same host/port as the WebSocket, so derive the
// REST origin from the bridge URL instead of asking the user for it again.
export function httpOrigin(bridgeUrl: string): string {
  const url = new URL(bridgeUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  return url.origin
}

export async function listProjects(baseUrl: string, token: string): Promise<ProjectSummary[]> {
  const res = await fetch(`${httpOrigin(baseUrl)}/projects?token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`projects request failed: ${res.status}`)
  const data = (await res.json()) as { projects?: ProjectSummary[] }
  return data.projects ?? []
}

export async function listProjectSessions(
  baseUrl: string,
  token: string,
  cwd: string,
): Promise<SessionSummary[]> {
  const res = await fetch(
    `${httpOrigin(baseUrl)}/sessions?cwd=${encodeURIComponent(cwd)}&token=${encodeURIComponent(token)}`,
  )
  if (!res.ok) throw new Error(`sessions request failed: ${res.status}`)
  const data = (await res.json()) as { sessions?: SessionSummary[] }
  return data.sessions ?? []
}
```

Add to `packages/acp/src/index.ts`:

```ts
export * from './project.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/acp && pnpm exec vitest run src/project.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/acp/src/project.ts packages/acp/src/project.test.ts packages/acp/src/index.ts
git commit -m "feat(acp): share project and session listing types"
```
