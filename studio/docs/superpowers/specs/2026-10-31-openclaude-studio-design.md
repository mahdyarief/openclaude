# OpenClaude Studio — Design Spec

**Date:** 2026-10-31
**Status:** Approved (design), pending implementation plan
**Repo:** `/home/dy/code/openclaude-studio` (git initialized, no remote yet)
**License:** MIT

## 1. Purpose

A web and desktop client for **`@rayss-dev/openclaude`** (the rayss fork). The UI layout is
inspired by ZCode's three-column workbench, but every component is owned by this repo and
is meant to be rewritten. The agent is never vendored: it is consumed as an installed npm
package that speaks ACP over stdio.

Explicit non-goals:

- Not a fork of `rayss868/openclaude`. That repo's `NOTICE` states the code is derived from
  proprietary Claude Code source and may not be redistributed. Only the npm package is used.
- Not a clone of `zai-org/ZCode`'s UI. Its `packages/ui` has 2,038 TS/TSX files and is coupled
  to a 107-method proprietary protocol (`@zcode/shared`, `@/store/StoreProvider`,
  `@zcode/provider`). Only its layout is an inspiration.
- Not a multi-tenant platform. Single operator, one agent process per session.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Repo strategy | New standalone repo | Avoid distributing proprietary derived source; ACP is a stable contract |
| UI system | React 19 + Tailwind v4 + BeautifulUI (shadcn registry) | BeautifulUI is copy-in source, so UI is fully ours and rewritable |
| ACP data layer | `@agentclientprotocol/sdk@2.2.0` (stable v1) | Official, typed, no CSS, no UI coupling |
| Rejected data layer | `@acp-components/core@0.1.0` | Pins SDK `0.22.1`; still pre-1.0; ideas borrowed, code not |
| Desktop | Tauri v2 wrapping the same web build | Small binary, OS WebView, proven sidecar pattern |
| Transport | WebSocket bridge in front of stdio | One client transport serves both web and desktop |
| Package manager | pnpm workspaces | Fast, strict, standard for this shape |

### 2.1 Upstream dependency

The agent is pinned to the rayss build, not to upstream Anthropic or to OpenClaw:

```json
{
  "dependencies": {
    "@rayss-dev/openclaude": "0.33.3-by-rayss"
  }
}
```

Facts this pin relies on, verified against the installed package:

- `bin.openclaude` exists, so PATH lookup works.
- `exports["./acp"]` resolves to `dist/acp.mjs`, so `require.resolve('@rayss-dev/openclaude/acp')`
  is the canonical entry lookup.
- `engines.node` is `>=22.0.0`, so the bridge and desktop require Node 22 or newer.
- `peerDependencies` are `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `react`, and
  `react-reconciler`. These are not bundled into `dist/acp.mjs`, so a global install must
  have them present. The bridge reports a missing-peer error explicitly instead of letting
  the agent crash with an unresolved import.

The pin is deliberate: `dist/acp.mjs` is not bundled and its entry behaviour changed between
versions, so an unpinned range can silently break startup. Upgrading is a manual step that
re-runs the smoke test.

## 3. Architecture

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ apps/desktop (Tauri v2)  │        │ browser                  │
│  spawns bridge sidecar   │        │  connects to remote      │
│  loads web build         │        │  bridge over Tailscale   │
└────────────┬─────────────┘        └────────────┬─────────────┘
             │ WebSocket JSON-RPC                │ WebSocket JSON-RPC
             └───────────────┬───────────────────┘
                             ▼
                    packages/bridge
              (WS ⇄ newline-delimited JSON)
                             │ stdio
                             ▼
        node <openclaude>/dist/acp.mjs
```

The bridge is protocol-agnostic. It forwards frames and enforces transport concerns only:
authentication, connection lifecycle, and process lifecycle. All ACP semantics live in
`packages/acp` on the client side.

### 3.1 Packages

```
openclaude-studio/
├── apps/
│   ├── web/          Vite + React 19; the actual UI
│   └── desktop/      Tauri v2 shell; sidecar management
├── packages/
│   ├── acp/          ACP client wrapper + Zustand stores (framework-agnostic)
│   ├── bridge/       Node WS ↔ stdio bridge
│   └── ui/           Shell layout + feature components (BeautifulUI sources)
├── docs/
└── package.json      pnpm workspace root
```

### 3.2 `packages/bridge`

Responsibility: own the child process and expose one WebSocket endpoint.

- Spawns the **agent shim** (section 3.2.1), not `dist/acp.mjs` directly, with `cwd` from the
  client's first message.
- Resolves the SDK and ACP entries via `require.resolve('@rayss-dev/openclaude/sdk')` and
  `require.resolve('@rayss-dev/openclaude/acp')`, falling back to PATH lookup of
  `openclaude` with a clear error if absent.
- Binds `127.0.0.1` by default; `--host` opt-in for remote exposure.
- Requires `Authorization: Bearer <token>` before the WebSocket upgrade. Token from
  `--token`, `OPENCLAUDE_BRIDGE_TOKEN`, or a generated one printed to stdout at startup.
- One agent process per WebSocket connection. Connection close kills the process group.
- Rejects malformed frames with a JSON-RPC parse error; never crashes on client input.
- Emits `bridge/status` events for `starting`, `ready`, `agent-exit`.

Interfaces:

```ts
export type BridgeOptions = {
  host?: string          // default '127.0.0.1'
  port?: number          // default 0 (ephemeral)
  token?: string         // default random
  acpEntry?: string      // default resolved
  cwd?: string           // default process.cwd()
}
export function startBridge(options?: BridgeOptions): Promise<{
  url: string
  token: string
  close: () => Promise<void>
}>
```

#### 3.2.1 Agent shim (replaces patching the bundle)

Older `dist/acp.mjs` builds never called `init()`, so `session/new` threw
`Config accessed before allowed`. The entrypoint now calls `init()` itself on the first
JSON-RPC message, via `runOutsideSdkContext(init)` (`src/entrypoints/acp.ts:1406–1411`).
Verified on 2026-11-16 against the real package: sending `initialize` followed by
`session/new` to the shim returns a real `sessionId` with no warm-up and no bundle patch.

The bridge therefore ships a minimal shim that only resolves the ESM-only export map and
imports the ACP entry (it auto-starts the stdio server):

```js
const acpPath = process.env.OPENCLAUDE_ACP_ENTRY ?? resolveEntry('@rayss-dev/openclaude/acp')
await import(acpPath)
```

The shim exists to centralise entry resolution and keep the option of an environment
override. The integration test `packages/bridge/test/shim-real-agent.test.ts` asserts that
`session/new` succeeds against the real package, so a future upstream regression in
`init()` cannot pass silently.

### 3.3 `packages/acp`

Responsibility: turn ACP messages into UI state, with no React dependency.

- `createAgentConnection({ url, token })` wraps `@agentclientprotocol/sdk` `client()` with a
  WebSocket stream.
- `sessionStore` (Zustand vanilla): messages, streaming chunks, tool calls, permission
  queue, plan, usage, session list.
- `connectionStore`: per-connection status, agent info, capabilities, error.
- Actions: `createSession`, `loadSession`, `sendPrompt`, `cancelPrompt`, `respondPermission`,
  `closeSession`.

Streaming rule: `session/update` notifications are applied in arrival order by chaining onto
a per-session promise. Out-of-order application is a correctness bug, not a display quirk.

### 3.4 `packages/ui`

Responsibility: render state. No protocol knowledge.

- `WorkbenchShell` — three regions plus a collapsible right panel. Each region is a separate
  exported component receiving explicit props, so any one can be replaced without touching
  the others.
- Region components: `SessionRail`, `ConversationPane`, `ContextPanel`, `ComposerBar`.
- BeautifulUI primitives (shadcn registry, copied into `packages/ui/src/beautifului/`):
  Streaming Text, Thinking, Tool Chips, Task Rows, Approval Card, Prompt Bar, Context Cards.
- Theming exclusively through CSS variables in `packages/ui/src/theme.css`. No theme props.

### 3.5 `apps/web`

- Vite app. Reads `bridge` URL and token from `?bridge=` / `?token=` query params or
  `localStorage`.
- Ships a connection screen when no bridge is configured.
- Builds to static assets consumable by both the browser and Tauri.

### 3.6 `apps/desktop`

- Tauri v2. On startup: spawn the bridge sidecar on an ephemeral port, read its printed
  `url` and `token`, then load the web build with those params.
- On exit: terminate the sidecar.
- Requires Node ≥ 22 on the host, matching OpenClaude's own requirement. If `node` or the
  openclaude package is missing, show install instructions rather than failing silently.
- No Node bundling in phase 1. Revisit only if distribution demands it.

## 4. Data flow

1. Client opens WS with bearer token.
2. Bridge spawns the agent and pipes frames.
3. Client sends `initialize`, then `session/new` with a `cwd`.
4. Agent emits `session/update` notifications; store maps them to UI state.
5. `session/request_permission` from the agent becomes an Approval Card; the answer is sent
   back as the JSON-RPC response.
6. On prompt completion the store records `stopReason`.

## 5. Error handling

| Failure | Behaviour |
|---|---|
| Bad/missing token | 401 before upgrade; no process spawned |
| Agent entry not found | Bridge exits with a message naming the expected package |
| Agent process dies | WS closes with code 1011; session marked `dead`; UI offers restart |
| Malformed frame from client | JSON-RPC parse error reply; connection stays open |
| Malformed frame from agent | Logged and dropped; connection stays open |
| Slow consumer | Bounded buffer per connection; overflow closes with 1013 |

## 6. Testing

- **Unit (Vitest):** session-update mapping, permission queue, store reducers, bridge token
  check and frame forwarding.
- **Integration:** bridge against a fake ACP agent script that emits fixture JSON-RPC, so
  tests do not need model credentials.
- **Smoke:** one end-to-end run through the shim against the real package, asserting
  `initialize` then `session/new` returns a session id. This is the regression guard for the
  init workaround. A full prompt test is skipped when no credentials are configured.
- **Manual gate:** desktop app launches, creates a session, streams a reply, and survives
  agent restart.

## 7. Phases

Status verified 2026-11-16; evidence lives in
`studio/docs/superpowers/plans/2026-11-05-acp-terminal-parity.md`.

1. [x] `packages/acp` + `packages/bridge` with the fake-agent integration test.
2. [x] Web shell and one end-to-end session against the real agent.
3. [x] Tool calls, permissions, diff view (M2/M5).
4. [ ] Tauri desktop — deferred: Rust/cargo toolchain absent in the working environment.
   Inputs are ready (bridge url + token, static web build) and it needs no rework; it is
   outside the ACP 1:1 parity promise.
5. [x] Deploy on aspire (`studio/deploy/`: two systemd units, `serve.mjs`, README),
   replacing the current unauthenticated `acp-web.mjs` service.

## 8. Open items

- The upstream ACP init issue is resolved in the installed build: `src/entrypoints/acp.ts:1406–1411` calls `runOutsideSdkContext(init)` on
  the first JSON-RPC message. The bridge shim only resolves the ESM-only export map and
  imports the entry; no installed file is patched. Verified 2026-11-16 by driving
  `initialize` + `session/new` against the real package.
- The integration test `packages/bridge/test/shim-real-agent.test.ts` asserts `session/new`
  returns a real `sessionId` against the real package. It skips on a clean checkout where
  the gitignored root `dist/` has not been built, so it cannot mask an `init()` regression
  in CI runs that build first.
- The bridge supports multiple concurrent sessions per agent process. One process can
  serve one connection while owning a map of independently addressable sessions; this
  is a settled decision (D3), not an open question.
