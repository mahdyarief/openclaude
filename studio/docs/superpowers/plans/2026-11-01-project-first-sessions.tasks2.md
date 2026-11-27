# Project-First Sessions — Detailed Tasks (part 2: web state + picker + tabs)

> Companion to `2026-11-01-project-first-sessions.md`. Follow the Global Constraints there.

---

### Task 5: Project selection persistence

**Files:**
- Create: `apps/web/src/project-store.ts`
- Test: `apps/web/src/project-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type ActiveProject = { path: string; name: string }
  export function readActiveProject(storage: Storage | null): ActiveProject | null
  export function saveActiveProject(storage: Storage, project: ActiveProject): void
  export function clearActiveProject(storage: Storage): void
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { clearActiveProject, readActiveProject, saveActiveProject } from './project-store.js'

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

describe('project store', () => {
  test('round-trips an active project', () => {
    const storage = memoryStorage()
    saveActiveProject(storage, { path: '/home/dy/code/app', name: 'app' })
    expect(readActiveProject(storage)).toEqual({ path: '/home/dy/code/app', name: 'app' })
  })
  test('returns null for malformed storage', () => {
    expect(readActiveProject(memoryStorage({ 'openclaude.project': '{oops' }))).toBeNull()
  })
  test('clears the project', () => {
    const storage = memoryStorage()
    saveActiveProject(storage, { path: '/p', name: 'p' })
    clearActiveProject(storage)
    expect(readActiveProject(storage)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/project-store.test.ts`
Expected: FAIL with "Cannot find module './project-store.js'"

- [ ] **Step 3: Write minimal implementation**

```ts
export type ActiveProject = { path: string; name: string }

const STORAGE_KEY = 'openclaude.project'

export function readActiveProject(storage: Storage | null): ActiveProject | null {
  if (!storage) return null
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ActiveProject).path === 'string' &&
      typeof (parsed as ActiveProject).name === 'string'
    ) {
      return parsed as ActiveProject
    }
  } catch {
    return null
  }
  return null
}

export function saveActiveProject(storage: Storage, project: ActiveProject): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(project))
}

export function clearActiveProject(storage: Storage): void {
  storage.removeItem(STORAGE_KEY)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/project-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/project-store.ts apps/web/src/project-store.test.ts
git commit -m "feat(web): persist the active project"
```

---

### Task 6: Project picker screen

**Files:**
- Create: `apps/web/src/ProjectPicker.tsx`
- Test: `apps/web/src/ProjectPicker.test.tsx` (or `.test.ts` if no testing-library)
- Modify: `apps/web/src/App.tsx` (wiring lands in Task 10)

**Interfaces:**
- Consumes: `ProjectSummary`, `listProjects` from `@openclaude-studio/acp`; `BridgeConfig` from `./bridge-config.js`; `ActiveProject` from `./project-store.js`.
- Produces: `manualProject(path)` helper and `<ProjectPicker config onSelect onDisconnect />`.

- [ ] **Step 1: Check the test tooling**

Run: `cd apps/web && cat package.json | grep -n "testing-library\|jsdom\|vitest"`
Expected: tells you whether `@testing-library/react` exists. If it does not, do **not** add it — test the pure helper `manualProject` instead.

- [ ] **Step 2: Write the failing test**

If testing-library exists:

```tsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ProjectPicker } from './ProjectPicker.js'

vi.mock('@openclaude-studio/acp', async importOriginal => ({
  ...(await importOriginal<typeof import('@openclaude-studio/acp')>()),
  listProjects: async () => [{ name: '-home-dy-code-app', path: '/home/dy/code/app', sessionCount: 3 }],
}))

describe('ProjectPicker', () => {
  test('lists projects and selects one', async () => {
    const onSelect = vi.fn()
    render(<ProjectPicker config={{ url: 'ws://h:8787', token: 't' }} onSelect={onSelect} onDisconnect={() => {}} />)
    await waitFor(() => expect(screen.getByText('/home/dy/code/app')).toBeTruthy())
    screen.getByText('/home/dy/code/app').click()
    expect(onSelect).toHaveBeenCalledWith({ path: '/home/dy/code/app', name: '-home-dy-code-app' })
  })
})
```

Otherwise:

```ts
import { describe, expect, test } from 'vitest'
import { manualProject } from './ProjectPicker.js'

describe('manualProject', () => {
  test('derives a name from a manual path', () => {
    expect(manualProject('/home/dy/code/app')).toEqual({ path: '/home/dy/code/app', name: '-home-dy-code-app' })
  })
  test('returns null for an empty path', () => {
    expect(manualProject('   ')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/ProjectPicker.test.tsx` (or `.test.ts`)
Expected: FAIL — module missing.

- [ ] **Step 4: Write the component**

```tsx
import { useEffect, useState } from 'react'
import { listProjects, type ProjectSummary } from '@openclaude-studio/acp'
import type { BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'

export function manualProject(path: string): ActiveProject | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  return { path: trimmed, name: trimmed.replace(/[^a-zA-Z0-9]/g, '-') }
}

export function ProjectPicker({
  config,
  onSelect,
  onDisconnect,
}: {
  config: BridgeConfig
  onSelect: (project: ActiveProject) => void
  onDisconnect: () => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [manual, setManual] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listProjects(config.url, config.token)
      .then(next => {
        if (!cancelled) setProjects(next)
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [config.url, config.token])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6 text-ink">
      <section className="flex w-full max-w-2xl flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Choose a project</h1>
          <button type="button" onClick={onDisconnect} className="text-sm text-ink-2 hover:text-ink">
            Disconnect
          </button>
        </header>

        {error ? <p role="alert" className="text-sm text-red">{error}</p> : null}

        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {projects.map(project => (
            <li key={project.path}>
              <button
                type="button"
                onClick={() => onSelect({ path: project.path, name: project.name })}
                className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-sm hover:bg-hover"
              >
                <span className="font-mono">{project.path}</span>
                <span className="text-ink-2">{project.sessionCount} sessions</span>
              </button>
            </li>
          ))}
          {projects.length === 0 && !error ? (
            <li className="px-3 py-2 text-sm text-ink-2">No projects found on the bridge.</li>
          ) : null}
        </ul>

        <form
          onSubmit={event => {
            event.preventDefault()
            const project = manualProject(manual)
            if (project) onSelect(project)
          }}
          className="flex gap-2 border-t border-line pt-4"
        >
          <input
            value={manual}
            onChange={event => setManual(event.target.value)}
            placeholder="/absolute/path/to/project"
            className="flex-1 rounded-[var(--radius-control)] bg-canvas p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-accent"
          />
          <button type="submit" className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-white">
            Open folder
          </button>
        </form>
      </section>
    </main>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/ProjectPicker.test.tsx` (or `.test.ts`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ProjectPicker.tsx apps/web/src/ProjectPicker.test.tsx
git commit -m "feat(web): add project picker screen"
```

---

### Task 7: Tab state

**Files:**
- Create: `apps/web/src/use-tabs.ts`
- Test: `apps/web/src/use-tabs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Tab = { sessionId: string; title: string }
  export type TabsState = { tabs: Tab[]; activeId: string | null }
  export function reduceTabs(state: TabsState, action: TabsAction): TabsState
  export function useTabs(): TabsState & {
    openTab: (tab: Tab) => void
    closeTab: (sessionId: string) => void
    activate: (sessionId: string) => void
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { reduceTabs } from './use-tabs.js'

describe('reduceTabs', () => {
  test('opens a tab and activates it', () => {
    const state = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: { sessionId: 'a', title: 'A' } })
    expect(state).toEqual({ tabs: [{ sessionId: 'a', title: 'A' }], activeId: 'a' })
  })
  test('opening the same tab twice does not duplicate it', () => {
    const first = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: { sessionId: 'a', title: 'A' } })
    const second = reduceTabs(first, { type: 'open', tab: { sessionId: 'a', title: 'A' } })
    expect(second.tabs).toHaveLength(1)
  })
  test('closing the active tab activates the neighbour', () => {
    const state = reduceTabs(
      { tabs: [{ sessionId: 'a', title: 'A' }, { sessionId: 'b', title: 'B' }], activeId: 'b' },
      { type: 'close', sessionId: 'b' },
    )
    expect(state.activeId).toBe('a')
  })
  test('closing the last tab leaves no active tab', () => {
    const state = reduceTabs({ tabs: [{ sessionId: 'a', title: 'A' }], activeId: 'a' }, { type: 'close', sessionId: 'a' })
    expect(state).toEqual({ tabs: [], activeId: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/use-tabs.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
import { useCallback, useState } from 'react'

export type Tab = { sessionId: string; title: string }
export type TabsState = { tabs: Tab[]; activeId: string | null }
export type TabsAction =
  | { type: 'open'; tab: Tab }
  | { type: 'close'; sessionId: string }
  | { type: 'activate'; sessionId: string }

export function reduceTabs(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      const exists = state.tabs.some(tab => tab.sessionId === action.tab.sessionId)
      return { tabs: exists ? state.tabs : [...state.tabs, action.tab], activeId: action.tab.sessionId }
    }
    case 'activate':
      return state.tabs.some(tab => tab.sessionId === action.sessionId)
        ? { ...state, activeId: action.sessionId }
        : state
    case 'close': {
      const index = state.tabs.findIndex(tab => tab.sessionId === action.sessionId)
      if (index === -1) return state
      const tabs = state.tabs.filter(tab => tab.sessionId !== action.sessionId)
      const activeId =
        state.activeId === action.sessionId ? (tabs[Math.min(index, tabs.length - 1)]?.sessionId ?? null) : state.activeId
      return { tabs, activeId }
    }
  }
}

export function useTabs() {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null })
  const openTab = useCallback((tab: Tab) => setState(s => reduceTabs(s, { type: 'open', tab })), [])
  const closeTab = useCallback((sessionId: string) => setState(s => reduceTabs(s, { type: 'close', sessionId })), [])
  const activate = useCallback((sessionId: string) => setState(s => reduceTabs(s, { type: 'activate', sessionId })), [])
  return { ...state, openTab, closeTab, activate }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/use-tabs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/use-tabs.ts apps/web/src/use-tabs.test.ts
git commit -m "feat(web): add tab state for multiple sessions"
```
