# Project-First Sessions — Detailed Tasks (part 3: session hook, UI, wiring, deploy)

> Companion to `2026-11-01-project-first-sessions.md`. Follow the Global Constraints there.

---

### Task 8: `useAgentSession` loads and defers creation

**Files:**
- Modify: `apps/web/src/use-agent-session.ts`
- Test: `apps/web/src/use-agent-session.test.ts`

**Interfaces:**
- Consumes: `createAgentConnection` with the new `sessionId` option (Task 3).
- Produces:
  ```ts
  export type AgentSessionOptions = {
    url: string
    token: string
    cwd: string
    /** Existing session to load. Omit to create one only on the first prompt. */
    sessionId?: string
  }
  export function sessionMode(sessionId: string | undefined): { kind: 'load'; sessionId: string } | { kind: 'new' }
  export function useAgentSession(options: AgentSessionOptions): AgentSession
  ```
  `AgentSession` gains `sessionId: string | null` and `ensureSession: () => Promise<string | null>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { sessionMode } from './use-agent-session.js'

describe('sessionMode', () => {
  test('loads when a session id is present', () => {
    expect(sessionMode('abc')).toEqual({ kind: 'load', sessionId: 'abc' })
  })
  test('defers creation when no session id is present', () => {
    expect(sessionMode(undefined)).toEqual({ kind: 'new' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/use-agent-session.test.ts`
Expected: FAIL — `sessionMode` not exported.

- [ ] **Step 3: Implement the mode helper and split connect**

```ts
export type SessionMode = { kind: 'load'; sessionId: string } | { kind: 'new' }

export function sessionMode(sessionId: string | undefined): SessionMode {
  return sessionId ? { kind: 'load', sessionId } : { kind: 'new' }
}
```

Refactor `useAgentSession(config: BridgeConfig)` to `useAgentSession(options: AgentSessionOptions)`:

- `connect()` always performs the handshake and keeps the `AgentConnectionHandle`.
- For `kind: 'load'`, pass `sessionId` to `createAgentConnection` and become `ready` immediately.
- For `kind: 'new'`, become `ready` with `sessionId = null`; `ensureSession()` starts a new session via the SDK (same call the current `newSession` uses), stores the id, resets the local session store, and returns the id. `sendPrompt` awaits `ensureSession()` before sending.
- Remove the mount-time auto-`newSession` so a refresh never creates a session.
- Keep the existing 10s handshake timeout.

Return shape:

```ts
type AgentSession = {
  state: SessionState
  status: ConnectionStatus
  error: string | null
  sessionId: string | null
  sendPrompt: (text: string) => void
  cancel: () => void
  ensureSession: () => Promise<string | null>
  pendingPermission: PermissionRequest | null
  respondPermission: (optionId: string | null) => void
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/use-agent-session.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm -r typecheck`
Expected: all packages pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/use-agent-session.ts apps/web/src/use-agent-session.test.ts
git commit -m "feat(web): load sessions and defer creation until first prompt"
```

---

### Task 9: Project rail and session tabs UI

**Files:**
- Modify: `packages/ui/src/shell/ProjectRail.tsx`
- Create: `packages/ui/src/shell/SessionTabs.tsx`
- Modify: `packages/ui/src/shell/AppShell.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/shell/ProjectRail.test.tsx`

**Interfaces:**
- Consumes: nothing (pure presentational).
- Produces:
  ```ts
  export type ProjectRailProps = {
    project: { path: string; name: string } | null
    sessions: Array<{ id: string; title: string; active: boolean }>
    onSelectSession: (id: string) => void
    onNewSession: () => void
    onChangeProject: () => void
  }
  export type SessionTabsProps = {
    tabs: Array<{ sessionId: string; title: string }>
    activeId: string | null
    onActivate: (sessionId: string) => void
    onClose: (sessionId: string) => void
  }
  ```
  `AppShellProps` gains `tabs?: ReactNode`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectRail } from './ProjectRail.js'

describe('ProjectRail', () => {
  test('shows the project path and session titles', () => {
    const html = renderToStaticMarkup(
      <ProjectRail
        project={{ path: '/home/dy/code/app', name: 'app' }}
        sessions={[{ id: 's1', title: 'First task', active: true }]}
        onSelectSession={() => {}}
        onNewSession={() => {}}
        onChangeProject={() => {}}
      />,
    )
    expect(html).toContain('/home/dy/code/app')
    expect(html).toContain('First task')
  })
})
```

`renderToStaticMarkup` avoids adding a testing-library dependency. Interaction logic is covered by the reducer tests in Task 7.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm exec vitest run src/shell/ProjectRail.test.tsx`
Expected: FAIL — props mismatch.

- [ ] **Step 3: Rewrite `ProjectRail`**

```tsx
"use client";

import { FolderOpen, Plus } from "lucide-react";

import { cn } from "../lib/cn.js";

export type ProjectRailProps = {
  project: { path: string; name: string } | null;
  sessions: Array<{ id: string; title: string; active: boolean }>;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onChangeProject: () => void;
};

export function ProjectRail({
  project,
  sessions,
  onSelectSession,
  onNewSession,
  onChangeProject,
}: ProjectRailProps) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-line bg-surface">
      <header className="flex items-start gap-2 border-b border-line px-3 py-3">
        <FolderOpen size={16} className="mt-0.5 shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{project?.path ?? "No project"}</p>
          <button type="button" onClick={onChangeProject} className="text-xs text-ink-2 hover:text-ink">
            Change project
          </button>
        </div>
      </header>

      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Sessions</h2>
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New session"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-ink-2 hover:bg-hover hover:text-ink"
        >
          <Plus size={16} />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-2">No sessions in this project yet</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  aria-current={session.active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm",
                    session.active ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                  )}
                >
                  <span className="truncate">{session.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Create `SessionTabs`**

```tsx
"use client";

import { X } from "lucide-react";

import { cn } from "../lib/cn.js";

export type SessionTabsProps = {
  tabs: Array<{ sessionId: string; title: string }>;
  activeId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export function SessionTabs({ tabs, activeId, onActivate, onClose }: SessionTabsProps) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex min-h-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1">
      {tabs.map((tab) => {
        const active = tab.sessionId === activeId;
        return (
          <div
            key={tab.sessionId}
            className={cn(
              "group flex shrink-0 items-center rounded-[var(--radius-control)]",
              active ? "bg-hover-2" : "hover:bg-hover",
            )}
          >
            <button
              type="button"
              onClick={() => onActivate(tab.sessionId)}
              aria-current={active ? "page" : undefined}
              className={cn("max-w-[180px] truncate px-3 py-1.5 text-sm", active ? "text-ink" : "text-ink-2")}
            >
              {tab.title}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.sessionId)}
              aria-label={`Close ${tab.title}`}
              className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Add the tabs slot to `AppShell`**

```tsx
export type AppShellProps = {
  rail: ReactNode
  tabs?: ReactNode
  chat: ReactNode
  explorer: ReactNode
  overlay?: ReactNode
}
```

Render `{tabs}` above the chat region inside `<main>`:

```tsx
<main data-region="chat" className="flex min-h-0 flex-col">
  {tabs}
  {overlay ? <div className="px-4 pt-4">{overlay}</div> : null}
  <div className="min-h-0 flex-1">{chat}</div>
</main>
```

- [ ] **Step 6: Export `SessionTabs`**

Add to `packages/ui/src/index.ts`:

```ts
export * from './shell/SessionTabs.js'
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd packages/ui && pnpm exec vitest run && cd ../.. && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/shell/ProjectRail.tsx packages/ui/src/shell/SessionTabs.tsx packages/ui/src/shell/AppShell.tsx packages/ui/src/index.ts packages/ui/src/shell/ProjectRail.test.tsx
git commit -m "feat(ui): project-first rail and session tabs"
```

---

### Task 10: Wire the workbench to projects and tabs

**Files:**
- Modify: `apps/web/src/Workbench.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/use-projects.ts`
- Test: `apps/web/src/use-projects.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–9.
- Produces: the final app flow.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { groupSessions } from './use-projects.js'

describe('groupSessions', () => {
  test('marks the active session', () => {
    const sessions = [
      { id: 'a', title: 'A', updatedAt: 2, messageCount: 1 },
      { id: 'b', title: 'B', updatedAt: 1, messageCount: 1 },
    ]
    expect(groupSessions(sessions, 'b')).toEqual([
      { id: 'a', title: 'A', active: false },
      { id: 'b', title: 'B', active: true },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/use-projects.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `use-projects`**

```ts
import { useCallback, useEffect, useState } from 'react'
import { listProjectSessions, type SessionSummary } from '@openclaude-studio/acp'

export function groupSessions(
  sessions: SessionSummary[],
  activeId: string | null,
): Array<{ id: string; title: string; active: boolean }> {
  return sessions.map(session => ({
    id: session.id,
    title: session.title,
    active: session.id === activeId,
  }))
}

export function useProjectSessions(
  url: string,
  token: string,
  cwd: string,
): { sessions: SessionSummary[]; loading: boolean; error: string | null; refresh: () => void } {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listProjectSessions(url, token, cwd))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [url, token, cwd])

  useEffect(() => {
    void load()
  }, [load])

  return { sessions, loading, error, refresh: () => void load() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/use-projects.test.ts`
Expected: PASS

- [ ] **Step 5: Rewrite `Workbench`**

Key requirement: **keep every open tab mounted** so each tab's WebSocket and streaming continue in the background. Render all tabs and hide inactive ones with CSS:

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { AppShell, ChatPane, FileExplorer, ProjectRail, SessionTabs } from '@openclaude-studio/ui'
import type { BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'
import { useAgentSession } from './use-agent-session.js'
import { useFileTree } from './use-file-tree.js'
import { groupSessions, useProjectSessions } from './use-projects.js'
import { useTabs } from './use-tabs.js'

export function Workbench({
  config,
  project,
  onChangeProject,
  onConnectionFailed,
}: {
  config: BridgeConfig
  project: ActiveProject
  onChangeProject: () => void
  onConnectionFailed?: () => void
}) {
  const { tabs, activeId, openTab, closeTab, activate } = useTabs()
  const { sessions, refresh } = useProjectSessions(config.url, config.token, project.path)
  const { tree, loading, error: fsError, refresh: refreshFiles } = useFileTree(config.url, config.token)

  const railSessions = groupSessions(sessions, activeId)

  return (
    <AppShell
      rail={
        <ProjectRail
          project={project}
          sessions={railSessions}
          onSelectSession={id => {
            const found = sessions.find(session => session.id === id)
            openTab({ sessionId: id, title: found?.title ?? id })
          }}
          onNewSession={() => openTab({ sessionId: `new-${Date.now()}`, title: 'New session' })}
          onChangeProject={onChangeProject}
        />
      }
      tabs={<SessionTabs tabs={tabs} activeId={activeId} onActivate={activate} onClose={closeTab} />}
      chat={
        tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-2">
            Select a session or create a new one.
          </div>
        ) : (
          tabs.map(tab => (
            <div key={tab.sessionId} className={tab.sessionId === activeId ? 'h-full' : 'hidden'}>
              <SessionPane
                config={config}
                cwd={project.path}
                sessionId={tab.sessionId.startsWith('new-') ? undefined : tab.sessionId}
                onSessionCreated={refresh}
                onConnectionFailed={onConnectionFailed}
              />
            </div>
          ))
        )
      }
      explorer={<FileExplorer tree={tree} loading={loading} error={fsError} onRefresh={refreshFiles} />}
    />
  )
}

function SessionPane({
  config,
  cwd,
  sessionId,
  onSessionCreated,
  onConnectionFailed,
}: {
  config: BridgeConfig
  cwd: string
  sessionId?: string
  onSessionCreated: () => void
  onConnectionFailed?: () => void
}) {
  const { state, status, error, sendPrompt, cancel, ensureSession, pendingPermission, respondPermission } =
    useAgentSession({ url: config.url, token: config.token, cwd, sessionId })
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (status === 'dead') onConnectionFailed?.()
  }, [status, onConnectionFailed])

  const disabled = status !== 'ready'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || disabled) return
    setDraft('')
    if (!sessionId) await ensureSession()
    sendPrompt(text)
    onSessionCreated()
  }

  return (
    <ChatPane
      messages={state.messages}
      toolCalls={state.toolCalls}
      streaming={state.streaming}
      status={status}
      stopReason={state.stopReason}
    >
      {pendingPermission ? (
        <div role="dialog" aria-modal="true" className="m-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="mb-3 text-sm text-ink-2">
            The agent wants to run <code>{pendingPermission.toolCall.toolCallId}</code>.
          </p>
          {error ? <p role="alert" className="mb-3 text-sm text-red">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            {pendingPermission.options.map(option => (
              <button key={option.optionId} type="button" onClick={() => respondPermission(option.optionId)} className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white">
                {option.name}
              </button>
            ))}
            <button type="button" onClick={() => respondPermission(null)} className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm text-ink hover:bg-hover">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit} className="flex items-end gap-2 bg-surface p-3">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          disabled={disabled}
          rows={2}
          placeholder={disabled ? 'Connecting…' : 'Ask OpenClaude…'}
          className="min-h-[3rem] flex-1 resize-none rounded-[var(--radius-control)] bg-canvas p-3 text-sm text-ink outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
        />
        {state.streaming ? (
          <button type="button" onClick={cancel} className="rounded-[var(--radius-control)] border border-line px-4 py-2 text-sm text-ink hover:bg-hover">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={disabled} className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            Send
          </button>
        )}
      </form>
    </ChatPane>
  )
}
```

Confirm by reading `packages/ui/src/shell/ChatPane.tsx` that `children` renders as the bottom composer. If `ChatPane` supports only one composer slot and the permission block breaks the layout, move the permission block into `AppShell`'s `overlay`.

- [ ] **Step 6: Rewrite `App`**

```tsx
import { useState } from 'react'
import { ConnectScreen } from './ConnectScreen.js'
import { ProjectPicker } from './ProjectPicker.js'
import { Workbench } from './Workbench.js'
import { readBridgeConfig, saveBridgeConfig, type BridgeConfig } from './bridge-config.js'
import { clearActiveProject, readActiveProject, saveActiveProject, type ActiveProject } from './project-store.js'

export function App() {
  const [config, setConfig] = useState<BridgeConfig | null>(() =>
    readBridgeConfig(window.location.search, localStorage, window.location.hostname),
  )
  const [failed, setFailed] = useState(false)
  const [project, setProject] = useState<ActiveProject | null>(() => readActiveProject(localStorage))

  if (!config || failed) {
    return (
      <ConnectScreen
        initial={config}
        onConnect={next => {
          saveBridgeConfig(localStorage, next)
          setFailed(false)
          setConfig(next)
        }}
      />
    )
  }

  if (!project) {
    return (
      <ProjectPicker
        config={config}
        onSelect={next => {
          saveActiveProject(localStorage, next)
          setProject(next)
        }}
        onDisconnect={() => {
          clearActiveProject(localStorage)
          localStorage.removeItem('openclaude.bridge')
          setProject(null)
          setConfig(null)
        }}
      />
    )
  }

  return (
    <Workbench
      config={config}
      project={project}
      onChangeProject={() => {
        clearActiveProject(localStorage)
        setProject(null)
      }}
      onConnectionFailed={() => {
        localStorage.removeItem('openclaude.bridge')
        setFailed(true)
      }}
    />
  )
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd apps/web && pnpm exec vitest run && cd ../.. && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/Workbench.tsx apps/web/src/App.tsx apps/web/src/use-projects.ts apps/web/src/use-projects.test.ts
git commit -m "feat(web): project-first workbench with session tabs"
```

---

### Task 11: End-to-end verification on aspire

**Files:** none (verification only)

- [ ] **Step 1: Build and deploy**

```bash
ssh dy@100.84.56.62
cd /home/dy/code/openclaude-studio
git fetch https://github.com/mahdyarief/openclaude-studio.git feat/project-first-sessions
git merge --ff-only FETCH_HEAD
corepack pnpm install
corepack pnpm -r build
sudo systemctl restart openclaude-studio openclaude-studio-web
```

- [ ] **Step 2: Verify the bridge endpoints**

```bash
TOKEN=d7f4102c12ba90e2954741e85286b4960a8d4897485c5ada
curl -s "http://127.0.0.1:8787/projects?token=$TOKEN" | head -c 400
curl -s "http://127.0.0.1:8787/sessions?cwd=/home/dy/code/openclaude-studio&token=$TOKEN" | head -c 400
```

Expected: JSON with a `projects` array, then a `sessions` array (may be empty).

- [ ] **Step 3: Verify no empty session on refresh**

```bash
DIR=~/.openclaude/projects/-home-dy-code-openclaude-studio
before=$(ls "$DIR"/*.jsonl 2>/dev/null | wc -l)
# load http://100.84.56.62:8768/ and refresh twice in a browser
after=$(ls "$DIR"/*.jsonl 2>/dev/null | wc -l)
echo "before=$before after=$after"
```

Expected: `before == after`.

- [ ] **Step 4: Verify load and concurrent tabs**

Open two existing sessions as two tabs. Confirm each shows its own history, and that sending a prompt in one tab streams while the other stays interactive. Confirm the bridge spawns one agent child per tab (one WebSocket each), `session/load` is used for opened sessions, and `session/new` only after the first prompt in a fresh tab.

- [ ] **Step 5: Update `deploy/README.md`**

Add a short section: the bridge now also serves `GET /projects` and `GET /sessions?cwd=…`, both token-gated, and the web UI is project-first (pick a folder, sessions load from disk).

- [ ] **Step 6: Commit the doc update**

```bash
git add deploy/README.md
git commit -m "docs(deploy): document project and session endpoints"
```
