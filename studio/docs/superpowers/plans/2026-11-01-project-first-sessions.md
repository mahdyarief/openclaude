# Project-First Sessions with Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the session-first rail with a project-first model: the user picks a folder, the app discovers existing OpenClaude sessions for that folder, opens them as tabs, and only creates a new session on explicit request — a page refresh never spawns empty sessions.

**Architecture:** The bridge gains two read-only HTTP endpoints (`/projects`, `/sessions`) that read OpenClaude's on-disk session store (`~/.openclaude/projects/<sanitized-cwd>/<sessionId>.jsonl`). The web app keeps a persisted `activeProject` in localStorage, lists its sessions, and opens each session as an independent tab. Each tab opens its own WebSocket to the bridge, which spawns a separate agent process per connection, so several sessions stream concurrently. Nothing is created until the user asks for a new session or sends the first prompt in a fresh tab.

**Tech Stack:** TypeScript, Node `node:http` bridge, React 19, Tailwind v4, zustand/vanilla, `@agentclientprotocol/sdk@2.2.0`.

## Global Constraints

- Package manager: `pnpm` on the laptop; `corepack pnpm` on aspire.
- TypeScript: `strict`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`. NodeNext → relative imports need `.js`.
- Bridge tests run with `pnpm exec vitest run` from `packages/bridge` (`pnpm --filter <pkg> test` is a silent no-op there).
- `packages/acp` is the only protocol/type boundary. `packages/ui` and `apps/web` import ACP types from `@openclaude-studio/acp` only.
- Bridge is auth-gated: every HTTP endpoint must validate `?token=` the same way `/fs` does.
- All new bridge file paths must be validated against a fixed root; never accept a path that escapes it.
- No new dependencies. UI component base stays BeautifulUI + the existing `AppShell` grid.
- Every user-visible string is English.

## Key facts discovered (read before implementing)

- Upstream `@rayss-dev/openclaude@0.33.3-by-rayss` (`dist/acp.mjs`, spawned by our bridge via `shim.mjs`) handles ACP methods: `initialize`, `session/new`, `session/load`, `session/cancel`, `session/prompt`. There is **no** `session/list` over ACP — so the web must discover sessions by reading disk, not by asking the agent.
- Sessions live at `~/.openclaude/projects/<sanitized-path>/<sessionId>.jsonl`, with a sidecar `<sessionId>.replay.json`. `sanitized-path` replaces every non-alphanumeric char with `-` (e.g. `/home/dy/code/app` → `-home-dy-code-app`).
- The bridge spawns one agent child process per inbound WebSocket connection (see `packages/bridge/src/index.ts` `wss.on('connection')` → `spawn(agentCommand...)`). Therefore each tab (its own WebSocket) gets its own agent — concurrent sessions are real, not simulated by remounting a single pane.

## Task list

1. `packages/bridge/src/sessions.ts` (+test) — read `~/.openclaude/projects` from disk.
2. `packages/bridge/src/index.ts` — add `/projects` and `/sessions` HTTP routes (reuse `/fs` token check).
3. `packages/acp/src/connection.ts` (+test) — `createAgentConnection` gains optional `sessionId` → sends `session/load` instead of `session/new`.
4. `packages/acp/src/project.ts` (+test) — shared `ProjectSummary`/`SessionSummary` types + `listProjects`/`listProjectSessions` fetchers.
5. `apps/web/src/project-store.ts` (+test) — localStorage `activeProject` persistence (mirror of `bridge-config.ts`).
6. `apps/web/src/ProjectPicker.tsx` (+test) — folder/project selection screen.
7. `apps/web/src/use-tabs.ts` (+test) — tab list state (open/close/activate).
8. `apps/web/src/use-agent-session.ts` (+test) — load existing session; defer `session/new` until first prompt.
9. `packages/ui/src/shell/ProjectRail.tsx` (rewrite), new `SessionTabs.tsx`, `AppShell.tsx` (add `tabs` slot), `index.ts` export — project-first rail + tab strip.
10. `apps/web/src/Workbench.tsx` + `App.tsx` + `apps/web/src/use-projects.ts` (+test) — wire project-first flow with per-tab sessions.
11. Deploy to aspire, verify endpoints + no empty-session-on-refresh + concurrent tabs.

Detailed steps for each task are in the sibling files `2026-11-01-project-first-sessions.tasks.md`.
