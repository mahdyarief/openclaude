# OpenClaude Studio Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser UI that drives `@rayss-dev/openclaude` over ACP, with a WebSocket bridge that can later be reused by a Tauri desktop shell.

**Architecture:** A pnpm monorepo with three packages. `packages/bridge` owns the agent process and exposes one authenticated WebSocket endpoint. `packages/acp` wraps the official ACP SDK and maps updates into Zustand stores. `apps/web` renders those stores with React 19 and Tailwind v4. The bridge never interprets ACP semantics; it only forwards frames.

**Tech Stack:** Node 22+, TypeScript 5, pnpm 9, Vitest 2, `ws` 8, React 19, Vite 6, Tailwind v4, `@agentclientprotocol/sdk` 2.2.0, `@rayss-dev/openclaude` 0.33.3-by-rayss, Zustand 5.

## Global Constraints

- Node engine floor: `>=22.0.0` (OpenClaude's own requirement).
- Agent package is pinned to exactly `0.33.3-by-rayss`. Never use a range.
- Never patch files inside `node_modules` or the global npm install. The init workaround lives in our shim.
- All ACP payload paths are absolute.
- License is MIT; do not vendor `rayss868/openclaude` source.
- `session/update` notifications must be applied in arrival order per session.
- Bridge binds `127.0.0.1` unless `--host` is passed explicitly.
- Modularization is mandatory: one responsibility per file, no god files. A
  module that grows past roughly 250 lines of implementation is a signal to
  split it along the boundary of what it knows, not to keep appending.
- Single source of truth: ACP method names come from `AGENT_METHODS` and
  `CLIENT_METHODS` exported by `@agentclientprotocol/sdk`; payload types are
  re-exported from the package root (there is no `schema.*` namespace import).
  Never redeclare a protocol string or a payload type by hand.
- Package output asymmetry: `packages/acp` and `packages/ui` are source-first
  (`exports` points at `./src/index.ts`) because only Vite/Vitest consume them.
  `packages/bridge` is executed by Node, so it must be compiled to `dist/` with
  `tsc -b`; Node cannot run these `.js`-specifier sources directly.
- Typecheck policy: `tsconfig.base.json` sets `composite: true`, so every
  package that runs `tsc --noEmit` must set `composite: false` and `noEmit:
  true` in its own `tsconfig.json`. Build packages use `tsc -b` instead.
- No duplication: shared selectors, reducers, and formatting helpers live in
  exactly one module and are imported. Copy-pasted store logic is a defect.
- Dependency direction is one-way: `apps/web` → `packages/ui` → `packages/acp`
  → `packages/bridge` types only. `packages/acp` must never import React;
  `packages/bridge` must never import UI code.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `vitest.workspace.ts`

**Interfaces:**
- Produces: workspace layout that every later task builds inside.

- [ ] **Step 1: Create the workspace files**

`package.json`:
```json
{
  "name": "openclaude-studio",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b",
    "dev:web": "pnpm --filter @openclaude-studio/web dev"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
.env
```

`vitest.workspace.ts`:
```ts
export default ['packages/*', 'apps/*']
```

- [ ] **Step 2: Install and verify the toolchain**

Run: `pnpm install`
Expected: lockfile created, no errors.

Run: `pnpm exec tsc --version`
Expected: `Version 5.7.x`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore vitest.workspace.ts pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace"
```

---

### Task 2: Bridge with token auth and frame forwarding

**Files:**
- Create: `packages/bridge/package.json`, `packages/bridge/tsconfig.json`
- Create: `packages/bridge/src/index.ts`
- Create: `packages/bridge/test/fixtures/fake-agent.mjs`
- Create: `packages/bridge/test/bridge.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the workspace.
- Produces:
```ts
export type BridgeOptions = {
  host?: string
  port?: number
  token?: string
  agentCommand?: { command: string; args: string[] }
  cwd?: string
}
export function startBridge(options?: BridgeOptions): Promise<{
  url: string
  token: string
  close: () => Promise<void>
}>
```

- [ ] **Step 1: Create the package manifest**

`packages/bridge/package.json`:
```json
{
  "name": "@openclaude-studio/bridge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/cli.js",
    "typecheck": "tsc -p tsconfig.test.json"
  },
  "dependencies": { "ws": "^8.18.0" },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "vitest": "^2.1.8"
  }
}
```

`packages/bridge/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/bridge/tsconfig.test.json` (typechecks `src` and `test` without
emitting, and without the `rootDir: "src"` constraint):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 2: Write the fake agent fixture**

`packages/bridge/test/fixtures/fake-agent.mjs`:
```js
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', line => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.method === 'initialize' && message.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { protocolVersion: 1, agentCapabilities: { loadSession: false } },
    }) + '\n')
    return
  }
  if (message.method === 'session/new' && message.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'fake-session' },
    }) + '\n')
  }
})
```

- [ ] **Step 3: Write the failing test**

`packages/bridge/test/bridge.test.ts`:
```ts
import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { startBridge } from '../src/index.js'
import { fileURLToPath } from 'node:url'

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
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @openclaude-studio/bridge exec vitest run test/bridge.test.ts`
Expected: FAIL because `../src/index.js` does not exist.

- [ ] **Step 5: Implement the bridge**

`packages/bridge/src/index.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'

export type BridgeOptions = {
  host?: string
  port?: number
  token?: string
  agentCommand?: { command: string; args: string[] }
  cwd?: string
}

// Compiled output lives in dist/, the shim ships as source. Resolve upward.
const defaultShim = fileURLToPath(new URL('../src/shim.mjs', import.meta.url))

export async function startBridge(options: BridgeOptions = {}): Promise<{
  url: string
  token: string
  close: () => Promise<void>
}> {
  const host = options.host ?? '127.0.0.1'
  const token = options.token ?? randomBytes(24).toString('hex')
  const agentCommand = options.agentCommand ?? {
    command: process.execPath,
    args: [defaultShim],
  }
  const children = new Set<ChildProcess>()

  const server = createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${host}`)
    const presented = url.searchParams.get('token')
    const header = request.headers.authorization
    const authorized =
      presented === token || header === `Bearer ${token}`

    if (!authorized) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, ws => {
      const agent = spawn(agentCommand.command, agentCommand.args, {
        cwd: options.cwd ?? process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        env: { ...process.env, OPENCLAUDE_BRIDGE: '1' },
      })
      children.add(agent)

      // Agent stdout is newline-delimited JSON. Chunks can split a line, so
      // buffer through readline rather than sending raw chunks.
      const lines = createInterface({ input: agent.stdout, crlfDelay: Infinity })
      lines.on('line', line => {
        if (!line.trim()) return
        try {
          JSON.parse(line)
        } catch {
          process.stderr.write(`[bridge] dropping non-JSON agent line\n`)
          return
        }
        if (ws.readyState === ws.OPEN) ws.send(line)
      })

      agent.stderr.on('data', chunk => {
        process.stderr.write(`[agent] ${chunk.toString()}`)
      })

      ws.on('message', data => {
        if (agent.stdin.destroyed) return
        const text = data.toString()
        try {
          JSON.parse(text)
        } catch {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }))
          return
        }
        agent.stdin.write(text + '\n')
      })

      const kill = (): void => {
        children.delete(agent)
        if (agent.exitCode !== null || agent.signalCode !== null) return
        try {
          if (agent.pid !== undefined && process.platform !== 'win32') {
            process.kill(-agent.pid, 'SIGTERM')
          } else {
            agent.kill('SIGTERM')
          }
        } catch {
          agent.kill('SIGTERM')
        }
      }

      ws.on('close', kill)
      agent.on('exit', code => {
        children.delete(agent)
        if (ws.readyState === ws.OPEN) {
          ws.close(1011, `agent exited with ${code ?? 'signal'}`)
        }
      })
    })
  })

  await new Promise<void>(resolve => server.listen(options.port ?? 0, host, resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('bridge failed to bind')

  return {
    url: `ws://${host}:${address.port}`,
    token,
    close: async () => {
      for (const client of wss.clients as Set<WebSocket>) client.terminate()
      for (const child of children) {
        try { child.kill('SIGTERM') } catch { /* already gone */ }
      }
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
```

Note on `agent.stdin`: the bridge does not add a newline to the frame it forwards
because it forwards the exact client text plus one `\n`. The client is responsible
for sending a single JSON-RPC message per WebSocket frame.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @openclaude-studio/bridge exec vitest run test/bridge.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge
git commit -m "feat(bridge): authenticated websocket to stdio bridge"
```

---

### Task 3: Agent shim for the init workaround

**Files:**
- Create: `packages/bridge/src/shim.mjs`
- Create: `packages/bridge/src/resolve-agent.ts`
- Create: `packages/bridge/test/shim.test.ts`

**Interfaces:**
- Produces: `resolveAgentEntry(): { sdk: string; acp: string }`, throwing `AgentNotFoundError` when the package is absent.
- Produces: `shim.mjs`, executable by Node, that starts the ACP server after init.

- [ ] **Step 1: Write the failing test**

`packages/bridge/test/shim.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { resolveAgentEntry } from '../src/resolve-agent.js'

describe('resolveAgentEntry', () => {
  test('resolves the installed openclaude sdk and acp entries', () => {
    const entry = resolveAgentEntry()
    expect(entry.sdk).toMatch(/openclaude[/\]dist[/\]sdk\.mjs$/)
    expect(entry.acp).toMatch(/openclaude[/\]dist[/\]acp\.mjs$/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openclaude-studio/bridge exec vitest run test/shim.test.ts`
Expected: FAIL because `resolve-agent.js` does not exist.

- [ ] **Step 3: Implement resolution**

`packages/bridge/src/resolve-agent.ts`:
```ts
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export class AgentNotFoundError extends Error {
  constructor() {
    super(
      'Could not resolve @rayss-dev/openclaude. Install it with: npm i -g @rayss-dev/openclaude',
    )
    this.name = 'AgentNotFoundError'
  }
}

export function resolveAgentEntry(): { sdk: string; acp: string } {
  try {
    return {
      sdk: require.resolve('@rayss-dev/openclaude/sdk'),
      acp: require.resolve('@rayss-dev/openclaude/acp'),
    }
  } catch {
    throw new AgentNotFoundError()
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openclaude-studio/bridge exec vitest run test/shim.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Write the shim**

The shim is the only place that knows about the upstream init bug. It must stay
small, and it must be runnable as `node src/shim.mjs`.

`packages/bridge/src/shim.mjs`:
```js
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sdkPath = process.env.OPENCLAUDE_SDK_ENTRY ?? require.resolve('@rayss-dev/openclaude/sdk')
const acpPath = process.env.OPENCLAUDE_ACP_ENTRY ?? require.resolve('@rayss-dev/openclaude/acp')

const { queryAsync } = await import(sdkPath)

// dist/acp.mjs never calls init(); createSession then throws
// "Config accessed before allowed". queryAsync awaits init() before doing any
// model work, and an already-aborted signal makes it return without a request.
const abort = new AbortController()
abort.abort()
await queryAsync({ prompt: '', options: { cwd: process.cwd(), abortController: abort } })

// Importing the acp entry auto-starts the server.
await import(acpPath)
```

- [ ] **Step 6: Add the shim to the package manifest**

In `packages/bridge/package.json`, add:
```json
"files": ["dist", "src/shim.mjs"],
"dependencies": {
  "ws": "^8.18.0",
  "@rayss-dev/openclaude": "0.33.3-by-rayss",
  "@agentclientprotocol/sdk": "2.2.0"
}
```

- [ ] **Step 7: Smoke-test the shim against the real package**

Run:
```bash
cd packages/bridge
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"'"$PWD"'"}}' \
  | timeout 60 node src/shim.mjs
```
Expected: an `initialize` response followed by a `session/new` response containing a `sessionId`. If it prints `Config accessed before allowed`, the shim ordering is wrong.

- [ ] **Step 8: Commit**

```bash
git add packages/bridge
git commit -m "feat(bridge): add agent shim that runs init before ACP start"
```

---

### Task 4: ACP client wrapper and session store

**Files:**
- Create: `packages/acp/package.json`
- Create: `packages/acp/tsconfig.json`
- Create: `packages/acp/src/types.ts`
- Create: `packages/acp/src/connection.ts`
- Create: `packages/acp/src/updates.ts`
- Create: `packages/acp/src/session-store.ts`
- Create: `packages/acp/src/connection-store.ts`
- Create: `packages/acp/src/index.ts`
- Test: `packages/acp/test/updates.test.ts`
- Test: `packages/acp/test/connection.test.ts`

**Interfaces:**
- Consumes: bridge URL and token from Task 2 (`ws://host:port`, `token`).
- Produces:
  - `createAgentConnection(options: { url: string; token: string; cwd: string }): Promise<AgentConnectionHandle>`
  - `AgentConnectionHandle = { connection: ClientConnection; session: ActiveSession; sessionId: string; agentInfo: InitializeResponse; disconnect: () => void }`
  - `createSessionStore(sessionId: string, cwd: string): SessionStoreApi` with `getState`, `subscribe`, `applyUpdate`, `appendUserMessage`, `setStopReason`, `enqueuePermission`, `resolvePermission`
  - `createConnectionStore(): ConnectionStoreApi` with `getState`, `subscribe`, `setStatus`, `setAgentInfo`, `setError`
  - `applySessionUpdate(state: SessionState, notification: SessionNotification): SessionState` (pure)

**Module boundaries (enforced by review):**
- `types.ts` holds every state shape. No other file declares a state type.
- `updates.ts` is a pure reducer. It must not import React, Zustand, or the network.
- `connection.ts` owns transport and the ACP SDK. It must not know about UI state.
- `session-store.ts` and `connection-store.ts` are thin Zustand wrappers; each under 80 lines.

- [ ] **Step 1: Create the package manifest**

`packages/acp/package.json`:
```json
{
  "name": "@openclaude-studio/acp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@agentclientprotocol/sdk": "2.2.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`packages/acp/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 2: Define the state types**

`packages/acp/src/types.ts`:
```ts
import type {
  ContentBlock,
  Plan,
  SessionConfigOption,
  SessionModeState,
  StopReason,
  ToolCall,
  ToolCallUpdate,
  UsageUpdate,
} from '@agentclientprotocol/sdk'

export type MessageRole = 'user' | 'agent'

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; toolCallId: string }

export type ConversationMessage = {
  id: string
  role: MessageRole
  parts: MessagePart[]
}

export type PermissionRequest = {
  requestId: number | string
  sessionId: string
  toolCall: ToolCallUpdate
  options: Array<{ optionId: string; name: string; kind: string }>
}

export type SessionState = {
  sessionId: string
  cwd: string
  title: string | null
  messages: ConversationMessage[]
  toolCalls: Record<string, ToolCall>
  plan: Plan | null
  usage: UsageUpdate | null
  modes: SessionModeState | null
  configOptions: Array<SessionConfigOption>
  permissionQueue: PermissionRequest[]
  stopReason: StopReason | null
  streaming: boolean
  notice: { severity: string; title: string; description?: string | null } | null
}

export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'dead'

export type ConnectionState = {
  status: ConnectionStatus
  agentName: string | null
  agentVersion: string | null
  protocolVersion: number | null
  loadSessionSupported: boolean
  error: string | null
}
```

- [ ] **Step 3: Write the failing reducer test**

`packages/acp/test/updates.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { applySessionUpdate, emptySession } from '../src/updates.js'
import type { SessionNotification } from '@agentclientprotocol/sdk'

const base = emptySession('s1', '/work')

function notification(update: SessionNotification['update']): SessionNotification {
  return { sessionId: 's1', update }
}

describe('applySessionUpdate', () => {
  test('accumulates agent text chunks in arrival order', () => {
    const first = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
      }),
    )
    const second = applySessionUpdate(
      first,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' world' },
      }),
    )

    expect(second.messages).toHaveLength(1)
    expect(second.messages[0].role).toBe('agent')
    expect(second.messages[0].parts).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  test('keeps thought chunks separate from answer text', () => {
    const withThought = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'considering' },
      }),
    )
    const withText = applySessionUpdate(
      withThought,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'answer' },
      }),
    )

    expect(withText.messages[0].parts).toEqual([
      { kind: 'thought', text: 'considering' },
      { kind: 'text', text: 'answer' },
    ])
  })

  test('creates a tool call and then merges its update', () => {
    const created = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Read file',
        status: 'pending',
      }),
    )
    const updated = applySessionUpdate(
      created,
      notification({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'done' },
          },
        ],
      }),
    )

    expect(updated.toolCalls.t1.status).toBe('completed')
    expect(updated.toolCalls.t1.title).toBe('Read file')
    expect(updated.messages[0].parts).toEqual([{ kind: 'tool', toolCallId: 't1' }])
  })

  test('stores plan and usage without touching messages', () => {
    const withPlan = applySessionUpdate(
      base,
      notification({
        sessionUpdate: 'plan',
        entries: [{ content: 'step one', priority: 'high', status: 'pending' }],
      }),
    )
    const withUsage = applySessionUpdate(
      withPlan,
      notification({ sessionUpdate: 'usage_update', used: 10, size: 100 }),
    )

    expect(withUsage.plan?.entries).toHaveLength(1)
    expect(withUsage.usage).toEqual({ used: 10, size: 100 })
    expect(withUsage.messages).toHaveLength(0)
  })

  test('records a notice without touching messages', () => {
    const withNotice = applySessionUpdate(
      { ...base, streaming: true },
      notification({ sessionUpdate: 'notice', severity: 'info', title: 'done' }),
    )

    expect(withNotice.notice).toEqual({ severity: 'info', title: 'done' })
    expect(withNotice.messages).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @openclaude-studio/acp exec vitest run test/updates.test.ts`
Expected: FAIL with "Cannot find module '../src/updates.js'".

- [ ] **Step 5: Implement the pure reducer**

`packages/acp/src/updates.ts`:
```ts
import type { SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk'
import type {
  ConversationMessage,
  MessagePart,
  SessionState,
} from './types.js'

let messageCounter = 0

function nextId(prefix: string): string {
  messageCounter += 1
  return `${prefix}-${messageCounter}`
}

export function emptySession(sessionId: string, cwd: string): SessionState {
  return {
    sessionId,
    cwd,
    title: null,
    messages: [],
    toolCalls: {},
    plan: null,
    usage: null,
    modes: null,
    configOptions: [],
    permissionQueue: [],
    stopReason: null,
    streaming: false,
    notice: null,
  }
}

type TextPart = Extract<MessagePart, { kind: 'text' | 'thought' }>

function isTextual(part: MessagePart): part is TextPart {
  return part.kind === 'text' || part.kind === 'thought'
}

// A chunk belongs to the last message of the same role. If the last message has
// a different role, a new message starts. This mirrors how ACP streams a turn:
// all agent chunks for one turn arrive consecutively.
function appendChunk(
  messages: ConversationMessage[],
  role: ConversationMessage['role'],
  part: MessagePart,
): ConversationMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== role) {
    return [...messages, { id: nextId(role), role, parts: [part] }]
  }

  const previous = last.parts[last.parts.length - 1]
  const canMerge =
    previous !== undefined &&
    isTextual(previous) &&
    isTextual(part) &&
    previous.kind === part.kind

  if (canMerge) {
    const merged = { ...previous, text: previous.text + part.text } as TextPart
    return [
      ...messages.slice(0, -1),
      { ...last, parts: [...last.parts.slice(0, -1), merged] },
    ]
  }

  return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] }]
}

function applyUpdate(state: SessionState, update: SessionUpdate): SessionState {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      if (update.content.type !== 'text') return state
      return {
        ...state,
        messages: appendChunk(state.messages, 'user', {
          kind: 'text',
          text: update.content.text,
        }),
      }
    }
    case 'agent_message_chunk': {
      if (update.content.type !== 'text') return state
      return {
        ...state,
        streaming: true,
        messages: appendChunk(state.messages, 'agent', {
          kind: 'text',
          text: update.content.text,
        }),
      }
    }
    case 'agent_thought_chunk': {
      if (update.content.type !== 'text') return state
      return {
        ...state,
        streaming: true,
        messages: appendChunk(state.messages, 'agent', {
          kind: 'thought',
          text: update.content.text,
        }),
      }
    }
    case 'tool_call': {
      return {
        ...state,
        streaming: true,
        toolCalls: { ...state.toolCalls, [update.toolCallId]: update },
        messages: appendChunk(state.messages, 'agent', {
          kind: 'tool',
          toolCallId: update.toolCallId,
        }),
      }
    }
    case 'tool_call_update': {
      const existing = state.toolCalls[update.toolCallId]
      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [update.toolCallId]: { ...existing, ...update },
        },
      }
    }
    case 'plan':
      return { ...state, plan: { entries: update.entries } }
    case 'usage_update':
      return {
        ...state,
        usage: { used: update.used, size: update.size, cost: update.cost },
      }
    case 'available_commands_update':
      return state
    case 'current_mode_update':
      return state
    case 'config_option_update':
      return { ...state, configOptions: update.configOptions }
    case 'session_info_update':
      return { ...state, title: update.title ?? state.title }
    case 'notice':
      return {
        ...state,
        notice: {
          severity: update.severity,
          title: update.title,
          description: update.description,
        },
      }
    case 'compaction_update':
      return state
    case 'compaction_summary_chunk':
      return state
    default:
      return state
  }
}

export function applySessionUpdate(
  state: SessionState,
  notification: SessionNotification,
): SessionState {
  return applyUpdate(state, notification.update)
}
```

- [ ] **Step 6: Run the reducer test to verify it passes**

Run: `pnpm --filter @openclaude-studio/acp exec vitest run test/updates.test.ts`
Expected: 5 passed.

- [ ] **Step 7: Write the connection test**

`packages/acp/test/connection.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { bridgeSocketUrl } from '../src/connection.js'

describe('bridgeSocketUrl', () => {
  test('appends the token as a query parameter', () => {
    expect(bridgeSocketUrl('ws://127.0.0.1:8080', 'abc')).toBe(
      'ws://127.0.0.1:8080?token=abc',
    )
  })

  test('keeps an existing query string intact', () => {
    expect(bridgeSocketUrl('ws://host:1/path?x=1', 'a b')).toBe(
      'ws://host:1/path?x=1&token=a%20b',
    )
  })
})
```

- [ ] **Step 8: Implement the connection wrapper**

`packages/acp/src/connection.ts`:
```ts
import {
  client,
  CLIENT_METHODS,
  AGENT_METHODS,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientConnection,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'

export type AgentConnectionOptions = {
  url: string
  token: string
  cwd: string
  onUpdate: (notification: SessionNotification) => void
  onPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
}

export type AgentConnectionHandle = {
  connection: ClientConnection
  session: ActiveSession
  sessionId: string
  agentInfo: InitializeResponse
  disconnect: () => void
}

export function bridgeSocketUrl(url: string, token: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(token)}`
}

// The SDK client does not send `initialize` for you: buildSession().start()
// sends session/new directly, and the agent rejects it with -32600 until
// initialize has been answered. So the wrapper sends initialize first.
export async function createAgentConnection(
  options: AgentConnectionOptions,
): Promise<AgentConnectionHandle> {
  const stream = createWebSocketStream(bridgeSocketUrl(options.url, options.token))
  const app = client({ name: 'openclaude-studio' })
    .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
      options.onUpdate(params)
    })
    .onRequest(CLIENT_METHODS.session_request_permission, ({ params }) =>
      options.onPermission(params),
    )
    .onRequest(CLIENT_METHODS.fs_read_text_file, () => {
      throw new Error('fs/read_text_file is not implemented yet')
    })
    .onRequest(CLIENT_METHODS.fs_write_text_file, () => {
      throw new Error('fs/write_text_file is not implemented yet')
    })

  const connection = app.connect(stream)
  const agentInfo = await connection.agent.request(AGENT_METHODS.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'openclaude-studio', version: '0.0.0' },
  })

  const session = await connection.agent.buildSession(options.cwd).start()

  return {
    connection,
    session,
    sessionId: session.sessionId,
    agentInfo,
    disconnect: () => connection.close(),
  }
}
```

- [ ] **Step 9: Run the connection test**

Run: `pnpm --filter @openclaude-studio/acp exec vitest run test/connection.test.ts`
Expected: 1 passed.

- [ ] **Step 10: Write the stores**

`packages/acp/src/session-store.ts`:
```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import { applySessionUpdate, emptySession } from './updates.js'
import type { PermissionRequest, SessionState } from './types.js'
import type { SessionNotification } from '@agentclientprotocol/sdk'

export type SessionStoreApi = StoreApi<SessionState> & {
  applyUpdate: (notification: SessionNotification) => void
  enqueuePermission: (request: PermissionRequest) => void
  resolvePermission: (requestId: PermissionRequest['requestId']) => void
  setStreaming: (streaming: boolean) => void
}

export function createSessionStore(
  sessionId: string,
  cwd: string,
): SessionStoreApi {
  const store = createStore<SessionState>(() => emptySession(sessionId, cwd))

  return {
    ...store,
    applyUpdate: notification => {
      store.setState(state => applySessionUpdate(state, notification))
    },
    enqueuePermission: request => {
      store.setState(state => ({
        ...state,
        permissionQueue: [...state.permissionQueue, request],
      }))
    },
    resolvePermission: requestId => {
      store.setState(state => ({
        ...state,
        permissionQueue: state.permissionQueue.filter(
          item => item.requestId !== requestId,
        ),
      }))
    },
    setStreaming: streaming => {
      store.setState({ streaming })
    },
  }
}
```

`packages/acp/src/connection-store.ts`:
```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ConnectionState, ConnectionStatus } from './types.js'

export type ConnectionStoreApi = StoreApi<ConnectionState> & {
  setStatus: (status: ConnectionStatus) => void
  setAgentInfo: (info: {
    name: string
    version: string
    protocolVersion: number
    loadSession: boolean
  }) => void
  setError: (error: string | null) => void
}

const initial: ConnectionState = {
  status: 'idle',
  agentName: null,
  agentVersion: null,
  protocolVersion: null,
  loadSessionSupported: false,
  error: null,
}

export function createConnectionStore(): ConnectionStoreApi {
  const store = createStore<ConnectionState>(() => initial)

  return {
    ...store,
    setStatus: status => store.setState({ status }),
    setAgentInfo: info =>
      store.setState({
        agentName: info.name,
        agentVersion: info.version,
        protocolVersion: info.protocolVersion,
        loadSessionSupported: info.loadSession,
      }),
    setError: error => store.setState({ error }),
  }
}
```

- [ ] **Step 11: Write the package barrel**

`packages/acp/src/index.ts`:
```ts
export * from './types.js'
export * from './updates.js'
export * from './connection.js'
export * from './session-store.js'
export * from './connection-store.js'

// Re-export the protocol types the UI needs, so packages/ui never imports the
// SDK directly. This is the single place that decides what the UI may know.
export type {
  ContentBlock,
  Plan,
  PlanEntry,
  PromptResponse,
  SessionConfigOption,
  SessionModeState,
  StopReason,
  ToolCall,
  ToolCallUpdate,
  UsageUpdate,
} from '@agentclientprotocol/sdk'
```

- [ ] **Step 12: Run all package tests and typecheck**

Run:
```bash
pnpm --filter @openclaude-studio/acp exec vitest run
pnpm --filter @openclaude-studio/acp run typecheck
```
Expected: tests pass; `tsc` exits 0.

- [ ] **Step 13: Commit**

```bash
git add packages/acp
git commit -m "feat(acp): add client wrapper, pure update reducer, and vanilla stores"
```

---

### Task 5: UI shell and connection screen

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/theme.css`
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/shell/WorkbenchShell.tsx`
- Create: `packages/ui/src/shell/SessionRail.tsx`
- Create: `packages/ui/src/shell/ConversationPane.tsx`
- Create: `packages/ui/src/shell/ContextPanel.tsx`
- Create: `packages/ui/src/shell/ComposerBar.tsx`
- Create: `packages/ui/src/index.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/ConnectScreen.tsx`
- Create: `apps/web/src/bridge-config.ts`
- Test: `apps/web/test/bridge-config.test.ts`

**Interfaces:**
- Consumes: `@openclaude-studio/acp` types only (`SessionState`, `ConnectionState`).
- Produces:
  - `WorkbenchShell` props: `{ rail: ReactNode; conversation: ReactNode; context: ReactNode; composer: ReactNode }`
  - `readBridgeConfig(search: string, storage: Storage | null): { url: string; token: string } | null`
  - `saveBridgeConfig(storage: Storage, config: { url: string; token: string }): void`

**Module boundaries:**
- Every shell region is its own file and takes explicit props. `WorkbenchShell` only arranges them.
- `packages/ui` never imports from `apps/web` and never imports the ACP SDK directly; it takes state as props.
- `theme.css` is the only file with color values. Components use CSS variables.

- [ ] **Step 1: Write the failing config test**

`apps/web/test/bridge-config.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { readBridgeConfig, saveBridgeConfig } from '../src/bridge-config.js'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('bridge config', () => {
  test('prefers query parameters over stored values', () => {
    const storage = memoryStorage({
      'openclaude.bridge': JSON.stringify({ url: 'ws://stored', token: 'stored' }),
    })

    expect(readBridgeConfig('?bridge=ws%3A%2F%2Fquery&token=t1', storage)).toEqual({
      url: 'ws://query',
      token: 't1',
    })
  })

  test('falls back to storage when the query is empty', () => {
    const storage = memoryStorage({
      'openclaude.bridge': JSON.stringify({ url: 'ws://stored', token: 'stored' }),
    })

    expect(readBridgeConfig('', storage)).toEqual({
      url: 'ws://stored',
      token: 'stored',
    })
  })

  test('returns null when nothing is configured', () => {
    expect(readBridgeConfig('', memoryStorage())).toBeNull()
  })

  test('ignores malformed stored json', () => {
    const storage = memoryStorage({ 'openclaude.bridge': '{oops' })
    expect(readBridgeConfig('', storage)).toBeNull()
  })

  test('persists a config', () => {
    const storage = memoryStorage()
    saveBridgeConfig(storage, { url: 'ws://x', token: 'y' })
    expect(readBridgeConfig('', storage)).toEqual({ url: 'ws://x', token: 'y' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openclaude-studio/web exec vitest run test/bridge-config.test.ts`
Expected: FAIL with "Cannot find module '../src/bridge-config.js'".

- [ ] **Step 3: Implement the config reader**

`apps/web/src/bridge-config.ts`:
```ts
export type BridgeConfig = { url: string; token: string }

const STORAGE_KEY = 'openclaude.bridge'

function parseStored(storage: Storage): BridgeConfig | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as BridgeConfig).url === 'string' &&
      typeof (parsed as BridgeConfig).token === 'string'
    ) {
      return parsed as BridgeConfig
    }
  } catch {
    return null
  }
  return null
}

export function readBridgeConfig(
  search: string,
  storage: Storage | null,
): BridgeConfig | null {
  const params = new URLSearchParams(search)
  const url = params.get('bridge')
  const token = params.get('token')
  if (url && token) return { url, token }
  return storage ? parseStored(storage) : null
}

export function saveBridgeConfig(storage: Storage, config: BridgeConfig): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(config))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openclaude-studio/web exec vitest run test/bridge-config.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Create the UI package**

`packages/ui/package.json`:
```json
{
  "name": "@openclaude-studio/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./theme.css": "./src/theme.css"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "typescript": "^5.7.2"
  }
}
```

`packages/ui/src/lib/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 6: Write the theme variables**

`packages/ui/src/theme.css`:
```css
:root {
  --oc-bg: 220 20% 7%;
  --oc-surface: 220 16% 11%;
  --oc-surface-raised: 220 14% 15%;
  --oc-border: 220 12% 22%;
  --oc-text: 220 20% 94%;
  --oc-text-muted: 220 10% 62%;
  --oc-accent: 262 80% 66%;
  --oc-danger: 0 72% 58%;
  --oc-success: 152 55% 50%;
  --oc-radius: 0.75rem;
  --oc-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.oc-shell {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr) 20rem;
  height: 100dvh;
  background: hsl(var(--oc-bg));
  color: hsl(var(--oc-text));
}

@media (max-width: 1024px) {
  .oc-shell { grid-template-columns: 4.5rem minmax(0, 1fr); }
  .oc-shell > [data-region='context'] { display: none; }
}
```

- [ ] **Step 7: Write the shell components**

`packages/ui/src/shell/WorkbenchShell.tsx`:
```tsx
import type { ReactNode } from 'react'

export type WorkbenchShellProps = {
  rail: ReactNode
  conversation: ReactNode
  context: ReactNode
  composer: ReactNode
}

export function WorkbenchShell({
  rail,
  conversation,
  context,
  composer,
}: WorkbenchShellProps) {
  return (
    <div className="oc-shell">
      <aside data-region="rail" className="min-h-0 overflow-y-auto">
        {rail}
      </aside>
      <main data-region="conversation" className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">{conversation}</div>
        {composer}
      </main>
      <aside data-region="context" className="min-h-0 overflow-y-auto">
        {context}
      </aside>
    </div>
  )
}
```

`packages/ui/src/shell/SessionRail.tsx`:
```tsx
export type SessionRailProps = {
  sessions: Array<{ id: string; title: string }>
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function SessionRail({ sessions, activeId, onSelect, onNew }: SessionRailProps) {
  return (
    <nav className="flex h-full flex-col gap-2 p-3">
      <button
        type="button"
        onClick={onNew}
        className="rounded-[var(--oc-radius)] bg-[hsl(var(--oc-accent))] px-3 py-2 text-sm font-medium text-white"
      >
        New session
      </button>
      <ul className="flex flex-col gap-1">
        {sessions.map(session => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              aria-current={session.id === activeId ? 'page' : undefined}
              className="w-full truncate rounded-[var(--oc-radius)] px-3 py-2 text-left text-sm text-[hsl(var(--oc-text-muted))] hover:bg-[hsl(var(--oc-surface-raised))] aria-[current=page]:bg-[hsl(var(--oc-surface-raised))] aria-[current=page]:text-[hsl(var(--oc-text))]"
            >
              {session.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

`packages/ui/src/shell/ConversationPane.tsx`:
```tsx
import type { ConversationMessage } from '@openclaude-studio/acp'

export type ConversationPaneProps = {
  messages: ConversationMessage[]
  streaming: boolean
}

export function ConversationPane({ messages, streaming }: ConversationPaneProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      {messages.map(message => (
        <article
          key={message.id}
          data-role={message.role}
          className="rounded-[var(--oc-radius)] border border-[hsl(var(--oc-border))] bg-[hsl(var(--oc-surface))] p-4"
        >
          <header className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--oc-text-muted))]">
            {message.role}
          </header>
          <div className="flex flex-col gap-2 whitespace-pre-wrap text-sm">
            {message.parts.map((part, index) =>
              part.kind === 'text' ? (
                <p key={index}>{part.text}</p>
              ) : part.kind === 'thought' ? (
                <p key={index} className="italic text-[hsl(var(--oc-text-muted))]">
                  {part.text}
                </p>
              ) : (
                <p key={index} className="font-mono text-xs text-[hsl(var(--oc-text-muted))]">
                  tool: {part.toolCallId}
                </p>
              ),
            )}
          </div>
        </article>
      ))}
      {streaming ? (
        <p aria-live="polite" className="text-xs text-[hsl(var(--oc-text-muted))]">
          Agent is working…
        </p>
      ) : null}
    </div>
  )
}
```

`packages/ui/src/shell/ContextPanel.tsx`:
```tsx
import type { Plan, ToolCall } from '@openclaude-studio/acp'

export type ContextPanelProps = {
  plan: Plan | null
  toolCalls: Record<string, ToolCall>
}

export function ContextPanel({ plan, toolCalls }: ContextPanelProps) {
  const calls = Object.values(toolCalls)

  return (
    <div className="flex flex-col gap-6 p-4">
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--oc-text-muted))]">
          Plan
        </h2>
        {plan && plan.entries.length > 0 ? (
          <ol className="flex flex-col gap-1 text-sm">
            {plan.entries.map((entry, index) => (
              <li key={index} data-status={entry.status}>
                {entry.content}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[hsl(var(--oc-text-muted))]">No plan yet.</p>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--oc-text-muted))]">
          Tool calls
        </h2>
        {calls.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {calls.map(call => (
              <li key={call.toolCallId} data-status={call.status}>
                {call.title ?? call.toolCallId}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[hsl(var(--oc-text-muted))]">No tool calls yet.</p>
        )}
      </section>
    </div>
  )
}
```

`packages/ui/src/shell/ComposerBar.tsx`:
```tsx
import { useState, type FormEvent } from 'react'

export type ComposerBarProps = {
  disabled: boolean
  onSend: (text: string) => void
  onCancel: () => void
  streaming: boolean
}

export function ComposerBar({ disabled, onSend, onCancel, streaming }: ComposerBarProps) {
  const [value, setValue] = useState('')

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    onSend(text)
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-[hsl(var(--oc-border))] bg-[hsl(var(--oc-surface))] p-3"
    >
      <textarea
        value={value}
        onChange={event => setValue(event.target.value)}
        disabled={disabled}
        rows={2}
        placeholder="Ask OpenClaude…"
        className="min-h-[3rem] flex-1 resize-none rounded-[var(--oc-radius)] bg-[hsl(var(--oc-bg))] p-3 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--oc-accent))]"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--oc-radius)] border border-[hsl(var(--oc-border))] px-4 py-2 text-sm"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled}
          className="rounded-[var(--oc-radius)] bg-[hsl(var(--oc-accent))] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      )}
    </form>
  )
}
```

`packages/ui/src/index.ts`:
```ts
export * from './shell/WorkbenchShell.js'
export * from './shell/SessionRail.js'
export * from './shell/ConversationPane.js'
export * from './shell/ContextPanel.js'
export * from './shell/ComposerBar.js'
```

- [ ] **Step 8: Create the web app scaffold**

`apps/web/package.json`:
```json
{
  "name": "@openclaude-studio/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openclaude-studio/acp": "workspace:*",
    "@openclaude-studio/ui": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "composite": false,
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`packages/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "composite": false,
    "noEmit": true
  },
  "include": ["src"]
}
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaude Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.js'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`apps/web/src/index.css`:
```css
@import 'tailwindcss';
@import '@openclaude-studio/ui/theme.css';
```

- [ ] **Step 9: Write the connection screen**

`apps/web/src/ConnectScreen.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import type { BridgeConfig } from './bridge-config.js'

export type ConnectScreenProps = {
  initial: BridgeConfig | null
  onConnect: (config: BridgeConfig) => void
}

export function ConnectScreen({ initial, onConnect }: ConnectScreenProps) {
  const [url, setUrl] = useState(initial?.url ?? 'ws://127.0.0.1:8787')
  const [token, setToken] = useState(initial?.token ?? '')

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!url.trim() || !token.trim()) return
    onConnect({ url: url.trim(), token: token.trim() })
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[hsl(var(--oc-bg))] p-6 text-[hsl(var(--oc-text))]">
      <form
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-4 rounded-[var(--oc-radius)] border border-[hsl(var(--oc-border))] bg-[hsl(var(--oc-surface))] p-6"
      >
        <h1 className="text-lg font-semibold">Connect to a bridge</h1>
        <label className="flex flex-col gap-1 text-sm">
          Bridge URL
          <input
            value={url}
            onChange={event => setUrl(event.target.value)}
            className="rounded-[var(--oc-radius)] bg-[hsl(var(--oc-bg))] p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--oc-accent))]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Token
          <input
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            className="rounded-[var(--oc-radius)] bg-[hsl(var(--oc-bg))] p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--oc-accent))]"
          />
        </label>
        <button
          type="submit"
          className="rounded-[var(--oc-radius)] bg-[hsl(var(--oc-accent))] px-4 py-2 text-sm font-medium text-white"
        >
          Connect
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 10: Write the app entry that chooses a screen**

`apps/web/src/App.tsx`:
```tsx
import { useState } from 'react'
import { ConnectScreen } from './ConnectScreen.js'
import { readBridgeConfig, saveBridgeConfig, type BridgeConfig } from './bridge-config.js'

export function App() {
  const [config, setConfig] = useState<BridgeConfig | null>(() =>
    readBridgeConfig(window.location.search, window.localStorage),
  )

  if (!config) {
    return (
      <ConnectScreen
        initial={null}
        onConnect={next => {
          saveBridgeConfig(window.localStorage, next)
          setConfig(next)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center text-[hsl(var(--oc-text-muted))]">
      Bridge configured at {config.url}. Workbench arrives in Task 6.
    </div>
  )
}
```

- [ ] **Step 11: Run tests, typecheck, and build**

Run:
```bash
pnpm --filter @openclaude-studio/web exec vitest run
pnpm --filter @openclaude-studio/ui run typecheck
pnpm --filter @openclaude-studio/web run typecheck
pnpm --filter @openclaude-studio/web run build
```
Expected: tests pass, both typechecks exit 0, and Vite writes `apps/web/dist`.

- [ ] **Step 12: Commit**

```bash
git add packages/ui apps/web
git commit -m "feat(web): add workbench shell, theme tokens, and bridge connect screen"
```

---

### Task 6: Live session workbench

**Files:**
- Create: `apps/web/src/use-agent-session.ts`
- Create: `apps/web/src/Workbench.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/format.ts`
- Test: `apps/web/test/format.test.ts`

**Interfaces:**
- Consumes: `createAgentConnection`, `createSessionStore`, `createConnectionStore`, `emptySession` from Task 4; shell components from Task 5.
- Produces:
  - `useAgentSession(config: BridgeConfig): { state: SessionState; status: ConnectionStatus; error: string | null; sendPrompt: (text: string) => void; cancel: () => void; newSession: () => void }`
  - `formatStopReason(reason: StopReason | null): string`

**Ordering rule:** `session/update` notifications are applied through a single
promise chain per session. The chain is stored in a ref and every incoming
notification appends to it. This is the mechanism that guarantees arrival order.

- [ ] **Step 1: Write the failing format test**

`apps/web/test/format.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { formatStopReason } from '../src/format.js'

describe('formatStopReason', () => {
  test('maps end_turn to a human label', () => {
    expect(formatStopReason('end_turn')).toBe('Finished')
  })

  test('maps max_tokens', () => {
    expect(formatStopReason('max_tokens')).toBe('Stopped: token limit')
  })

  test('maps cancelled', () => {
    expect(formatStopReason('cancelled')).toBe('Cancelled')
  })

  test('falls back for null', () => {
    expect(formatStopReason(null)).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openclaude-studio/web exec vitest run test/format.test.ts`
Expected: FAIL with "Cannot find module '../src/format.js'".

- [ ] **Step 3: Implement the formatter**

`apps/web/src/format.ts`:
```ts
import type { StopReason } from '@openclaude-studio/acp'

const LABELS: Record<StopReason, string> = {
  end_turn: 'Finished',
  max_tokens: 'Stopped: token limit',
  max_turn_requests: 'Stopped: turn limit',
  refusal: 'Stopped: refused',
  cancelled: 'Cancelled',
}

export function formatStopReason(reason: StopReason | null): string {
  return reason ? LABELS[reason] : ''
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openclaude-studio/web exec vitest run test/format.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Implement the session hook**

`apps/web/src/use-agent-session.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createAgentConnection,
  createConnectionStore,
  createSessionStore,
  emptySession,
  type AgentConnectionHandle,
  type ConnectionStatus,
  type SessionState,
} from '@openclaude-studio/acp'
import type { BridgeConfig } from './bridge-config.js'

type SessionApi = {
  state: SessionState
  status: ConnectionStatus
  error: string | null
  sendPrompt: (text: string) => void
  cancel: () => void
  newSession: () => void
}

export function useAgentSession(config: BridgeConfig): SessionApi {
  const [state, setState] = useState<SessionState>(() => emptySession('', ''))
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<AgentConnectionHandle | null>(null)
  // One promise chain per session enforces arrival order for updates.
  const updateChain = useRef<Promise<void>>(Promise.resolve())

  const connect = useCallback(async () => {
    setStatus('connecting')
    setError(null)
    const sessionStore = createSessionStore('', '')

    try {
      const handle = await createAgentConnection({
        url: config.url,
        token: config.token,
        cwd: '.',
        onUpdate: notification => {
          updateChain.current = updateChain.current.then(() => {
            sessionStore.applyUpdate(notification)
            setState(sessionStore.getState())
          })
        },
        onPermission: async request => {
          sessionStore.enqueuePermission({
            requestId: request.toolCall.toolCallId,
            sessionId: request.sessionId,
            toolCall: request.toolCall,
            options: request.options.map(option => ({
              optionId: option.optionId,
              name: option.name,
              kind: option.kind,
            })),
          })
          setState(sessionStore.getState())
          // Task 7 replaces this auto-allow with the approval card.
          const allow = request.options.find(option => option.kind === 'allow_once')
          return allow
            ? { outcome: 'selected', optionId: allow.optionId }
            : { outcome: 'cancelled' }
        },
      })

      handleRef.current = handle
      sessionStore.setState(state => ({
        ...state,
        sessionId: handle.sessionId,
        cwd: '.',
        title: `Session ${handle.sessionId.slice(0, 8)}`,
      }))
      setState(sessionStore.getState())
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('dead')
    }
  }, [config.url, config.token])

  useEffect(() => {
    void connect()
    return () => {
      handleRef.current?.disconnect()
      handleRef.current = null
    }
  }, [connect])

  const sendPrompt = useCallback((text: string) => {
    const handle = handleRef.current
    if (!handle) return
    void handle.session.prompt(text).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])

  const cancel = useCallback(() => {
    void handleRef.current?.connection.agent.request('session/cancel', {
      sessionId: handleRef.current.sessionId,
    })
  }, [])

  const newSession = useCallback(() => {
    void connect()
  }, [connect])

  return { state, status, error, sendPrompt, cancel, newSession }
}
```

- [ ] **Step 6: Write the workbench container**

`apps/web/src/Workbench.tsx`:
```tsx
import {
  ComposerBar,
  ContextPanel,
  ConversationPane,
  SessionRail,
  WorkbenchShell,
} from '@openclaude-studio/ui'
import type { BridgeConfig } from './bridge-config.js'
import { formatStopReason } from './format.js'
import { useAgentSession } from './use-agent-session.js'

export function Workbench({ config }: { config: BridgeConfig }) {
  const { state, status, error, sendPrompt, cancel, newSession } =
    useAgentSession(config)

  return (
    <WorkbenchShell
      rail={
        <SessionRail
          sessions={
            state.sessionId
              ? [{ id: state.sessionId, title: state.title ?? state.sessionId }]
              : []
          }
          activeId={state.sessionId || null}
          onSelect={() => {}}
          onNew={newSession}
        />
      }
      conversation={
        <div className="flex flex-col gap-2 p-6">
          <p role="status" className="text-xs text-[hsl(var(--oc-text-muted))]">
            {status === 'connecting' ? 'Connecting…' : formatStopReason(state.stopReason)}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-[hsl(var(--oc-danger))]">
              {error}
            </p>
          ) : null}
          <ConversationPane messages={state.messages} streaming={state.streaming} />
        </div>
      }
      context={<ContextPanel plan={state.plan} toolCalls={state.toolCalls} />}
      composer={
        <ComposerBar
          disabled={status !== 'ready'}
          streaming={state.streaming}
          onSend={sendPrompt}
          onCancel={cancel}
        />
      }
    />
  )
}
```

- [ ] **Step 7: Wire the workbench into the app**

Replace the placeholder return in `apps/web/src/App.tsx`:
```tsx
  return <Workbench config={config} />
```
and add the import:
```tsx
import { Workbench } from './Workbench.js'
```

- [ ] **Step 8: Run tests, typecheck, and build**

Run:
```bash
pnpm --filter @openclaude-studio/web exec vitest run
pnpm --filter @openclaude-studio/web run typecheck
pnpm --filter @openclaude-studio/web run build
```
Expected: tests pass, typecheck exits 0, build writes `apps/web/dist`.

- [ ] **Step 9: Manual end-to-end check against the real agent**

Run in one terminal:
```bash
pnpm --filter @openclaude-studio/bridge run start -- --token dev-token
```
Open the web app with `?bridge=ws://127.0.0.1:<printed port>&token=dev-token`, send a
short prompt, and confirm text streams into the conversation pane in order.
Expected: chunks appear in arrival order; no interleaving of thought and answer.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): stream a live ACP session into the workbench"
```

---

### Task 7: Permission approval card

**Files:**
- Create: `packages/ui/src/shell/ApprovalCard.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/shell/WorkbenchShell.tsx`
- Modify: `apps/web/src/use-agent-session.ts`
- Modify: `apps/web/src/Workbench.tsx`
- Test: `packages/acp/test/permission-queue.test.ts`

**Interfaces:**
- Consumes: `PermissionRequest` and the stores from Task 4.
- Produces:
  - `ApprovalCard` props: `{ request: PermissionRequest; onDecide: (optionId: string) => void; onCancel: () => void }`
  - `useAgentSession(...)` gains `pendingPermission: PermissionRequest | null` and `respondPermission: (optionId: string | null) => void`.
  - `WorkbenchShell` gains an optional `overlay?: ReactNode` prop rendered above the conversation.

**Why the hook must change:** the permission handler currently returns
immediately with an auto-allow. A real approval card needs the handler to stay
pending until the user decides, so the handler stores a resolver function and
`respondPermission` calls it.

- [ ] **Step 1: Write the failing permission queue test**

`packages/acp/test/permission-queue.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { createSessionStore } from '../src/session-store.js'

const request = {
  requestId: 'call-1',
  sessionId: 's1',
  toolCall: { toolCallId: 'call-1', title: 'Write file' },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
}

describe('permission queue', () => {
  test('enqueues a permission request', () => {
    const store = createSessionStore('s1', '/work')
    store.enqueuePermission(request)
    expect(store.getState().permissionQueue).toHaveLength(1)
  })

  test('resolving removes exactly one request', () => {
    const store = createSessionStore('s1', '/work')
    store.enqueuePermission(request)
    store.enqueuePermission({ ...request, requestId: 'call-2' })
    store.resolvePermission('call-1')
    expect(store.getState().permissionQueue.map(item => item.requestId)).toEqual([
      'call-2',
    ])
  })

  test('resolving an unknown id leaves the queue unchanged', () => {
    const store = createSessionStore('s1', '/work')
    store.enqueuePermission(request)
    store.resolvePermission('missing')
    expect(store.getState().permissionQueue).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to see the current behaviour**

Run: `pnpm --filter @openclaude-studio/acp exec vitest run test/permission-queue.test.ts`
Expected: PASS. Task 4 already implements `enqueuePermission` and
`resolvePermission`; this test locks that contract before Task 7 changes how the
UI consumes it. If it fails, fix the store before continuing.

- [ ] **Step 3: Write the approval card**

`packages/ui/src/shell/ApprovalCard.tsx`:
```tsx
import type { PermissionRequest } from '@openclaude-studio/acp'

export type ApprovalCardProps = {
  request: PermissionRequest
  onDecide: (optionId: string) => void
  onCancel: () => void
}

export function ApprovalCard({ request, onDecide, onCancel }: ApprovalCardProps) {
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      className="mx-auto my-4 w-full max-w-xl rounded-[var(--oc-radius)] border border-[hsl(var(--oc-border))] bg-[hsl(var(--oc-surface-raised))] p-4"
    >
      <h2 id="approval-title" className="mb-1 text-sm font-semibold">
        Permission required
      </h2>
      <p className="mb-3 text-sm text-[hsl(var(--oc-text-muted))]">
        {request.toolCall.title ?? 'The agent wants to run a tool.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {request.options.map(option => (
          <button
            key={option.optionId}
            type="button"
            onClick={() => onDecide(option.optionId)}
            className="rounded-[var(--oc-radius)] bg-[hsl(var(--oc-accent))] px-3 py-2 text-sm font-medium text-white"
          >
            {option.name}
          </button>
        ))}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--oc-radius)] border border-[hsl(var(--oc-border))] px-3 py-2 text-sm"
        >
          Reject
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add the overlay slot to the shell**

In `packages/ui/src/shell/WorkbenchShell.tsx`, add `overlay?: ReactNode` to the
props type and render it inside the conversation column above the composer:
```tsx
<main data-region="conversation" className="flex min-h-0 flex-col">
  {overlay}
  <div className="min-h-0 flex-1 overflow-y-auto">{conversation}</div>
  {composer}
</main>
```

Export the card from `packages/ui/src/index.ts`:
```ts
export * from './shell/ApprovalCard.js'
```

- [ ] **Step 5: Make the permission handler wait for a decision**

In `apps/web/src/use-agent-session.ts`, add state and a resolver ref:
```ts
const [pendingPermission, setPendingPermission] =
  useState<PermissionRequest | null>(null)
const permissionResolver = useRef<
  ((response: RequestPermissionResponse) => void) | null
>(null)
```

Replace the `onPermission` body with:
```ts
onPermission: request => {
  const permission: PermissionRequest = {
    requestId: request.toolCall.toolCallId,
    sessionId: request.sessionId,
    toolCall: request.toolCall,
    options: request.options.map(option => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    })),
  }
  sessionStore.enqueuePermission(permission)
  setState(sessionStore.getState())
  setPendingPermission(permission)
  return new Promise<RequestPermissionResponse>(resolve => {
    permissionResolver.current = resolve
  })
},
```

Add the response action:
```ts
const respondPermission = useCallback((optionId: string | null) => {
  const resolve = permissionResolver.current
  permissionResolver.current = null
  setPendingPermission(null)
  if (!resolve) return
  resolve(
    optionId
      ? { outcome: 'selected', optionId }
      : { outcome: 'cancelled' },
  )
}, [])
```

Return `pendingPermission` and `respondPermission` from the hook and add them to
the `SessionApi` type.

- [ ] **Step 6: Render the card in the workbench**

In `apps/web/src/Workbench.tsx`, destructure `pendingPermission` and
`respondPermission`, and pass:
```tsx
overlay={
  pendingPermission ? (
    <ApprovalCard
      request={pendingPermission}
      onDecide={respondPermission}
      onCancel={() => respondPermission(null)}
    />
  ) : null
}
```

Import `ApprovalCard` from `@openclaude-studio/ui`.

- [ ] **Step 7: Run tests, typecheck, and build**

Run:
```bash
pnpm --filter @openclaude-studio/acp exec vitest run
pnpm --filter @openclaude-studio/web exec vitest run
pnpm --filter @openclaude-studio/ui run typecheck
pnpm --filter @openclaude-studio/web run typecheck
pnpm --filter @openclaude-studio/web run build
```
Expected: all tests pass, typechecks exit 0, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/acp packages/ui apps/web
git commit -m "feat(web): gate tool calls behind an approval card"
```

---

### Task 8: Deploy on aspire behind systemd

**Files:**
- Create: `packages/bridge/src/cli.ts`
- Modify: `packages/bridge/package.json`
- Create: `deploy/openclaude-studio.service`
- Create: `deploy/README.md`

**Interfaces:**
- Consumes: `startBridge` from Task 2.
- Produces: a long-running service on `127.0.0.1:8787` that prints the token once
  at startup and never restarts a crashed agent on its own.

**Security note:** the bridge must bind `127.0.0.1` by default. Remote access is
provided by Tailscale, not by binding `0.0.0.0`. The token is a bearer secret:
it goes in the environment file with `chmod 600`, never in the unit file.

- [ ] **Step 1: Write the CLI entry**

`packages/bridge/src/cli.ts`:
```ts
import { startBridge } from './index.js'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const token = flag('token') ?? process.env.OPENCLAUDE_BRIDGE_TOKEN
const host = flag('host') ?? process.env.OPENCLAUDE_BRIDGE_HOST ?? '127.0.0.1'
const port = Number(flag('port') ?? process.env.OPENCLAUDE_BRIDGE_PORT ?? 8787)

if (!token) {
  process.stderr.write(
    'Refusing to start without a token. Pass --token or set OPENCLAUDE_BRIDGE_TOKEN.\n',
  )
  process.exit(1)
}

const bridge = await startBridge({ host, port, token })
process.stdout.write(`bridge listening on ${bridge.url}\n`)

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`received ${signal}, shutting down\n`)
  await bridge.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
```

Add the bin entry to `packages/bridge/package.json`:
```json
"bin": { "openclaude-studio-bridge": "./dist/cli.js" },
"scripts": {
  "build": "tsc -b",
  "start": "node dist/cli.js"
}
```

The bridge must be compiled before it runs. Node's `--experimental-strip-types`
does not rewrite `./index.js` specifiers to `index.ts`, so running `src/cli.ts`
directly fails with `ERR_MODULE_NOT_FOUND`. Build first with
`pnpm --filter @openclaude-studio/bridge build`.

- [ ] **Step 2: Write the systemd unit**

`deploy/openclaude-studio.service`:
```ini
[Unit]
Description=OpenClaude Studio bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dy
WorkingDirectory=/home/dy/code/openclaude-studio
EnvironmentFile=/home/dy/.config/openclaude-studio/bridge.env
ExecStart=/usr/bin/env node packages/bridge/dist/cli.js
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/dy/.local/share/openclaude /home/dy/.config/openclaude /home/dy/code/openclaude-studio
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

- [ ] **Step 3: Write the deployment notes**

`deploy/README.md`:
```markdown
# Deploying the bridge on aspire

1. Create the environment file:

   ```bash
   install -d -m 700 ~/.config/openclaude-studio
   printf 'OPENCLAUDE_BRIDGE_TOKEN=%s\n' "$(openssl rand -hex 24)" \
     > ~/.config/openclaude-studio/bridge.env
   chmod 600 ~/.config/openclaude-studio/bridge.env
   ```

2. Install dependencies and build the bridge:

   ```bash
   cd /home/dy/code/openclaude-studio
   pnpm install
   pnpm --filter @openclaude-studio/bridge build
   ```

   Rebuild after any change under `packages/bridge/src` and restart the unit.

3. Install and start the unit:

   ```bash
   sudo cp deploy/openclaude-studio.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now openclaude-studio
   ```

4. Read the token once for the browser URL:

   ```bash
   sudo cat ~/.config/openclaude-studio/bridge.env
   ```

5. Open the web app over Tailscale with
   `?bridge=ws://127.0.0.1:8787&token=<token>` when the browser runs on aspire,
   or `ws://<tailscale-host>:8787` when it runs on another tailnet device.

Do not bind the bridge to `0.0.0.0`. Tailscale already restricts who can reach
the port, and the bearer token is the second layer.
```

- [ ] **Step 4: Verify the unit starts and serves**

Run:
```bash
sudo systemctl daemon-reload
sudo systemctl start openclaude-studio
sudo systemctl status openclaude-studio --no-pager
sudo journalctl -u openclaude-studio -n 20 --no-pager
```
Expected: `active (running)`, and the journal contains `bridge listening on
ws://127.0.0.1:8787`.

- [ ] **Step 5: Verify a rejected token is rejected before spawn**

Run:
```bash
node -e "
const ws = new WebSocket('ws://127.0.0.1:8787?token=wrong');
ws.onopen = () => { console.log('UNEXPECTED OPEN'); process.exit(1) };
ws.onerror = () => { console.log('rejected as expected'); process.exit(0) };
setTimeout(() => { console.log('no response'); process.exit(1) }, 3000);
"
```
Expected: `rejected as expected`, and `pgrep -af shim.mjs` shows no new process.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge deploy
git commit -m "feat(deploy): add bridge CLI and hardened systemd unit"
```

---

## Self-Review Notes

**Spec coverage**

| Spec section | Implemented by |
|---|---|
| 2.1 pinned agent version | Task 1 dependency pin; Task 3 smoke test |
| 3.2 bridge responsibilities | Task 2 |
| 3.2.1 shim | Task 3 |
| 3.3 `packages/acp` | Task 4 |
| 3.4 `packages/ui` | Task 5, Task 7 |
| 3.5 `apps/web` | Task 5, Task 6 |
| 3.6 `apps/desktop` (Tauri) | Deferred; the web build and bridge are the inputs it needs |
| 4 data flow | Task 6 |
| 5 error handling | Task 2 (token, malformed frames, agent exit), Task 6 (dead status) |
| 6 testing | Tasks 2, 3, 4, 5, 6, 7 |
| 7 phase 5 (deploy) | Task 8 |

**Deferred by design:** the Tauri shell is phase 4 of the spec and is not part of
this plan. The bridge URL/token contract and the static web build are exactly
what it needs, so it can be planned separately without rework.

**Placeholder scan:** no task contains TBD, TODO, or "similar to Task N". Every
code step contains the code to write.

**Type consistency:** `SessionState`, `ConnectionState`, `PermissionRequest`, and
`AgentConnectionHandle` are declared once in Task 4 and referenced by name in
Tasks 5 through 7. Method constants use the SDK's exported `AGENT_METHODS` and
`CLIENT_METHODS`, so no protocol string is hand-written.

**Known risk to watch during execution:** the SDK's `buildSession().start()`
sends `session/new` but not `initialize`; Task 4 sends `initialize` explicitly.
If a future SDK version starts sending it automatically, the explicit request
will fail with a duplicate-initialize error and the smoke test in Task 3 will
catch it.


