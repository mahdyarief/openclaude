# OpenClaude Studio — Web UI Restructure (ZCode layout + BeautifulUI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the web client into a clean ZCode-style three-pane layout (left = projects/sessions rail, center = chat, right = folder explorer) built on vendored BeautifulUI primitives, and add a filesystem-serving HTTP endpoint to the bridge so the right panel can list the agent's working directory — all while preserving the existing modular, SSOT, no-god-file architecture.

**Architecture:** BeautifulUI is a copy-paste shadcn registry (not an npm package) — its `foundation` style + chosen primitives are vendored into `packages/ui` and re-exported from a single barrel so the app imports them only through `@openclaude-studio/ui`. The bridge gains an authenticated HTTP `GET /fs` directory-listing handler (read-only, scoped to its `cwd`). The web app keeps the existing `packages/acp` session state machine untouched; only `packages/ui` components and `apps/web` composition/layout change. New layout: `AppShell` (grid) → `ProjectRail` (left) + `ChatPane` (center) + `FileExplorer` (right).

**Tech Stack:** React 19, Tailwind CSS v4 (`@tailwindcss/vite`), BeautifulUI registry (shadcn-style, vendored), Vite 6, TypeScript 5.7 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), pnpm workspace, `ws` (bridge), `@agentclientprotocol/sdk@2.2.0`.

## Global Constraints

- **SSOT:** `packages/acp` is the only protocol/type boundary. `packages/ui` and `apps/web` import ACP types from `@openclaude-studio/acp`, never from `@agentclientprotocol/sdk` directly.
- **No god files / modular:** each UI component is a single-responsibility file under `packages/ui/src/`. No component file exceeds a focused scope; split by responsibility, not layer.
- **BeautifulUI vendoring rule:** vendor via `npx shadcn add https://www.beautifului.dev/r/<name>.json`; never import raw vendored paths from app code — re-export through `packages/ui/src/beautifui/index.ts`. The `foundation` style MUST be added first and imported once in `apps/web/src/index.css`.
- **Icon substitution rule:** BeautifulUI primitives reference `@central-icons-react/*` (paid). Replace with `lucide-react` equivalents in every vendored file (e.g. `IconPlusMedium` → `Plus`, `IconChevronDownSmall` → `ChevronDown`, `IconHome` → `Home`, `IconSettingsGear1` → `Settings`, `IconMagnifyingGlass` → `Search`).
- **Bridge token auth applies to ALL HTTP routes** (same bearer/`?token=` check already used for the WS upgrade in `packages/bridge/src/index.ts`). Never serve FS listing without it.
- **Compiler strictness:** `strict`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`. Code must pass `pnpm typecheck` in every touched package and `pnpm test`.
- **Web UI port stays 8768; bridge stays 8787.** Do not change these.
- **pnpm strictness:** every runtime dependency used by a package must be declared in that package's `package.json`. BeautifulUI's transitive deps (`clsx`, `tailwind-merge`, `lucide-react`, `shadow-plugin`, any radix primitive a chosen primitive needs) go in `packages/ui/package.json`.

## Reference inputs (read before implementing, do NOT copy verbatim)

- Validai `feat/foundation` `web/src/components/block/<feature>/` + `web/src/components/layout/sidebar/` block-scoped structure — target for "clean, modular codebase".
- Terax `src/modules/explorer` (Rust-side FS tree) + `src/modules/ai/components/AiChat.tsx` — shape of the right-pane folder tree and center chat.
- BeautifulUI registry: `foundation`, `sidebar-nav`, `chat-composer`, `streaming-text`, `thinking-state`, `approval-card`, `tool-chips`, `task-rows`, `code-block`, `context-cards`. Use only what the new layout needs; YAGNI extras.

---

### Task 1: Scaffold BeautifulUI foundation + vendoring pipeline in `packages/ui`

**Files:**
- Create: `packages/ui/src/beautifui/foundation.css` (copied from `https://www.beautifului.dev/r/foundation.json` `app/beautifui/foundation.css`)
- Create: `packages/ui/src/beautifui/index.ts` (re-export barrel)
- Modify: `packages/ui/src/index.ts` (add `export * from './beautifui/index.js'`)
- Modify: `apps/web/src/index.css` (add `@import '@openclaude-studio/ui/beautifui/foundation.css';`)
- Modify: `packages/ui/package.json` (add `shadow-plugin` to dependencies)
- Create: `packages/ui/package.json` edit + `components.json` (shadcn config pointing registry to beautifului.dev, aliases to `@openclaude-studio/ui/beautifui`)

**Interfaces:**
- Consumes: `packages/ui` existing `cn` helper (`packages/ui/src/lib/cn.ts`).
- Produces: `foundation.css` design tokens (`--page`, `--surface`, `--ink`, `--line`, etc.), `beautifui/index.ts` barrel that later tasks import from.

- [ ] **Step 1: Fetch foundation payload and write it to `packages/ui/src/beautifui/foundation.css`**
  Run `npx shadcn add https://www.beautifului.dev/r/foundation.json` in `packages/ui`, then move/rename the emitted `app/beautifui/foundation.css` to `packages/ui/src/beautifui/foundation.css` (preserve exact content). Verify the file starts with `@import "tailwindcss";`.
- [ ] **Step 2: Create the barrel `packages/ui/src/beautifui/index.ts`**
```ts
export {}
```
- [ ] **Step 3: Wire the barrel and foundation into the package**
  Edit `packages/ui/src/index.ts` to append `export * from './beautifui/index.js'`.
  Edit `apps/web/src/index.css` to add, after the existing two lines:
```css
@import '@openclaude-studio/ui/beautifui/foundation.css';
```
  Add `"shadow-plugin": "^2.1.1"` to `packages/ui/package.json` `dependencies`.
- [ ] **Step 4: Install and typecheck**
  Run: `cd packages/ui && pnpm install && pnpm typecheck`
  Expected: exit 0, no type errors.
- [ ] **Step 5: Commit**
```bash
git add packages/ui apps/web/src/index.css
git commit -m "chore(ui): vendor BeautifulUI foundation tokens"
```

### Task 2: Vendor BeautifulUI primitives (sidebar, chat, stream, approval, tool-chips, code-block, context-cards) with lucide icons

**Files:**
- Create: `packages/ui/src/beautifui/SidebarNav.tsx`
- Create: `packages/ui/src/beautifui/ChatComposer.tsx`
- Create: `packages/ui/src/beautifui/StreamingText.tsx`
- Create: `packages/ui/src/beautifui/ThinkingState.tsx`
- Create: `packages/ui/src/beautifui/ApprovalCard.tsx`
- Create: `packages/ui/src/beautifui/ToolChips.tsx`
- Create: `packages/ui/src/beautifui/CodeBlock.tsx`
- Create: `packages/ui/src/beautifui/ContextCards.tsx`
- Modify: `packages/ui/src/beautifui/index.ts` (re-export all above)
- Modify: `packages/ui/package.json` (add `lucide-react`)

**Interfaces:**
- Consumes: `foundation.css` from Task 1.
- Produces: typed React components imported via `@openclaude-studio/ui` (e.g. `SidebarNav`, `ChatComposer`, `StreamingText`, `ThinkingState`, `ApprovalCard`, `ToolChips`, `CodeBlock`, `ContextCards`).

- [ ] **Step 1: Vendor each primitive**
  For each name in the file list, run `npx shadcn add https://www.beautifului.dev/r/<name>.json` in `packages/ui`, then move the emitted file into `packages/ui/src/beautifui/<Name>.tsx`. Keep the component's exported name; keep its CSS import line (e.g. `@import "./beautifui/<name>.css";` — also move the `.css` sibling alongside).
- [ ] **Step 2: Replace paid icons with lucide-react**
  In every vendored `.tsx`, remove `import { IconX } from "@central-icons-react/..."` lines and replace each `<IconX .../>` usage with the matching `lucide-react` component (`Plus`, `ChevronDown`, `Home`, `Settings`, `Search`, `PanelLeft`, `Check`, `X`, `Edit`, `ArrowLeft`, `Popsicle`→`Sparkles`, `Cross`→`X`). Add `import { <Used> } from 'lucide-react'` at top.
- [ ] **Step 3: Fix imports to project convention**
  Change any `react-dom` `createPortal` usage to import from `react-dom` (already standard). Ensure no `import "clsx"`/`tailwind-merge` duplication conflicts with existing `cn`.
- [ ] **Step 4: Re-export from barrel**
  Append to `packages/ui/src/beautifui/index.ts`:
```ts
export * from './SidebarNav.js'
export * from './ChatComposer.js'
export * from './StreamingText.js'
export * from './ThinkingState.js'
export * from './ApprovalCard.js'
export * from './ToolChips.js'
export * from './CodeBlock.js'
export * from './ContextCards.js'
```
  Add `"lucide-react": "^0.460.0"` to `packages/ui/package.json` `dependencies`.
- [ ] **Step 5: Install and typecheck**
  Run: `cd packages/ui && pnpm install && pnpm typecheck`
  Expected: exit 0. (If a primitive pulls a radix dep, add it to `package.json` and re-install — do not leave an undeclared dep.)
- [ ] **Step 6: Commit**
```bash
git add packages/ui
git commit -m "feat(ui): vendor BeautifulUI primitives with lucide icons"
```

### Task 3: Add `/fs` directory-listing endpoint to the bridge (authenticated, cwd-scoped)

**Files:**
- Create: `packages/bridge/src/fs.ts` (pure `listDirectory(root, relPath)` helper + types)
- Create: `packages/bridge/test/fs.test.ts`
- Modify: `packages/bridge/src/index.ts` (handle `GET /fs` with token auth, JSON response)
- Modify: `packages/bridge/package.json` (add `@types/node` already present; ensure `node:fs`/`node:path` used — no new dep)

**Interfaces:**
```ts
// packages/bridge/src/fs.ts
export type FsEntry = { name: string; path: string; kind: 'file' | 'dir'; size: number }
export type FsListing = { root: string; path: string; entries: FsEntry[] }
export function listDirectory(root: string, relPath: string): FsListing  // throws on traversal outside root
```
- Consumes: bridge `cwd` (the agent working dir, `options.cwd ?? process.cwd()`).
- Produces: HTTP `GET /fs?path=<rel>&token=<tok>` returning `FsListing` JSON; consumed by web `FileExplorer` in Task 6.

- [ ] **Step 1: Write the failing test**
  Create `packages/bridge/test/fs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { listDirectory } from '../src/fs.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ocs-fs-'))
writeFileSync(join(root, 'a.txt'), 'hi')
mkdirSync(join(root, 'sub'))
writeFileSync(join(root, 'sub', 'b.txt'), 'yo')

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
```
- [ ] **Step 2: Run test to verify it fails**
  Run: `cd packages/bridge && pnpm exec vitest run test/fs.test.ts`
  Expected: FAIL — `listDirectory` not found.
- [ ] **Step 3: Implement `packages/bridge/src/fs.ts`**
  Implement `listDirectory(root, relPath)`: resolve `abs = normalize(join(root, relPath))`; throw if `abs` is not within `root` (use `relative(root, abs).startsWith('..')`); read dir; map each entry to `{ name, path: relative(root, entryAbs), kind, size }` (size 0 for dirs); sort dirs-first then by name.
- [ ] **Step 4: Run test to verify it passes**
  Run: `cd packages/bridge && pnpm exec vitest run test/fs.test.ts`
  Expected: PASS.
- [ ] **Step 5: Wire HTTP route in `index.ts`**
  In `createServer((req, res) => {...})`, before the 404, add: if `req.url` starts with `/fs`, parse `URL(req.url, 'http://localhost')`, check `token` param === bridge `token` (the same `token` variable in scope), else `res.writeHead(401).end()`. Otherwise call `listDirectory(cwd, params.get('path') ?? '.')` and `res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify(listing))`. Import `listDirectory` from `./fs.js` and `node:fs`/`node:path` as needed.
- [ ] **Step 6: Build bridge and run full bridge suite**
  Run: `cd packages/bridge && pnpm build && pnpm exec vitest run`
  Expected: build ok, all tests pass (including existing bridge.test.ts regression).
- [ ] **Step 7: Commit**
```bash
git add packages/bridge
git commit -m "feat(bridge): serve cwd-scoped /fs directory listing over HTTP"
```

### Task 4: Build `ProjectRail` (left pane — projects/sessions) on `SidebarNav`

**Files:**
- Create: `packages/ui/src/shell/ProjectRail.tsx`
- Create: `packages/ui/src/shell/ProjectRail.css` (or use foundation tokens)
- Modify: `packages/ui/src/index.ts` (re-export `ProjectRail`)

**Interfaces:**
```ts
export type ProjectRailProps = {
  sessions: Array<{ id: string; title: string }>
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}
```
- Consumes: `SidebarNav` from `@openclaude-studio/ui` (Task 2).
- Produces: left rail component used by `AppShell` (Task 7).

- [ ] **Step 1: Write the component**
  Build `ProjectRail.tsx` using `SidebarNav` styling tokens (`--surface`, `--ink`, `--line`). Render a header ("Sessions" + a `Plus` new button wired to `onNew`), then a scrollable list of `sessions` where the active one uses the glide/active style; clicking calls `onSelect(id)`. Use `cn()` from `../lib/cn.js`.
- [ ] **Step 2: Re-export**
  Append `export * from './shell/ProjectRail.js'` to `packages/ui/src/index.ts`.
- [ ] **Step 3: Typecheck**
  Run: `cd packages/ui && pnpm typecheck`
  Expected: exit 0.
- [ ] **Step 4: Commit**
```bash
git add packages/ui
git commit -m "feat(ui): add ProjectRail left pane"
```

### Task 5: Build `ChatPane` (center) + `MessageList` with StreamingText/ThinkingState/CodeBlock

**Files:**
- Create: `packages/ui/src/shell/ChatPane.tsx`
- Create: `packages/ui/src/shell/MessageList.tsx`
- Create: `packages/ui/src/shell/MessageBubble.tsx`
- Modify: `packages/ui/src/index.ts` (re-export the three)

**Interfaces:**
```ts
export type ChatPaneProps = {
  messages: ConversationMessage[]
  streaming: boolean
  status: ConnectionStatus
  stopReason: StopReason | null
  children: ReactNode // composer
}
export type MessageListProps = { messages: ConversationMessage[]; streaming: boolean }
```
  (`ConversationMessage`, `ConnectionStatus`, `StopReason` imported from `@openclaude-studio/acp`.)
- Consumes: `StreamingText`, `ThinkingState`, `CodeBlock` from `@openclaude-studio/ui` (Task 2); `ConversationMessage` type from `acp`.
- Produces: center pane + message rendering used by `AppShell`.

- [ ] **Step 1: Write `MessageBubble.tsx`**
  Render one `ConversationMessage`: user vs agent alignment; for `thought` parts render `<ThinkingState>`; for `text` parts render `<StreamingText>` when `streaming` and it is the last agent message, else plain text; for `tool` parts render a `<ToolChips>`-style chip using `toolCalls[toolCallId].title`.
- [ ] **Step 2: Write `MessageList.tsx`**
  Map `messages` to `<MessageBubble>`; auto-scroll to bottom on update (use a `ref` + `useEffect`).
- [ ] **Step 3: Write `ChatPane.tsx`**
  Compose a header (status + `formatStopReason`), `<MessageList>`, and `children` (composer) pinned at bottom. Use `cn()`.
- [ ] **Step 4: Re-export and typecheck**
  Append the three exports to `packages/ui/src/index.ts`. Run `cd packages/ui && pnpm typecheck`. Expected: exit 0.
- [ ] **Step 5: Commit**
```bash
git add packages/ui
git commit -m "feat(ui): add ChatPane and message rendering"
```

### Task 6: Build `FileExplorer` (right pane) consuming bridge `/fs`

**Files:**
- Create: `apps/web/src/use-file-tree.ts` (hook: fetch `/fs`, build tree)
- Create: `packages/ui/src/shell/FileExplorer.tsx`
- Modify: `packages/ui/src/index.ts` (re-export `FileExplorer`)
- Modify: `apps/web/package.json` (add `lucide-react` if not already; it is only in `packages/ui` — web imports icons via re-export OR add directly)

**Interfaces:**
```ts
// use-file-tree.ts
export type FileNode = { name: string; path: string; kind: 'file' | 'dir'; children?: FileNode[] }
export function useFileTree(baseUrl: string, token: string): { tree: FileNode[]; loading: boolean; error: string | null; refresh: () => void }
```
- Consumes: bridge `GET /fs` from Task 3. `BridgeConfig` (`{url, token}`) from `apps/web/src/bridge-config.ts`.
- Produces: right-pane tree used by `AppShell`.

- [ ] **Step 1: Write `use-file-tree.ts`**
  Hook fetches `GET <baseUrl-origin>/fs?path=<enc>&token=<enc>` (derive origin from `config.url` which is `ws://host:port` → replace `ws` with `http`). Parse `FsListing`, convert flat `entries` into a nested `FileNode[]` tree (split `path` on `/`). Expose `tree`, `loading`, `error`, `refresh`. Use `fetch` with `AbortController`.
- [ ] **Step 2: Write `FileExplorer.tsx`**
  Recursive collapsible tree using `lucide-react` `Folder`/`FolderOpen`/`File` icons; clicking a dir expands; root header "Files" + refresh button. Empty/loading/error states. Uses `cn()`.
- [ ] **Step 3: Re-export + add dep**
  Append `export * from './shell/FileExplorer.js'` to `packages/ui/src/index.ts`. If `apps/web` needs lucide directly, add `"lucide-react"` to `apps/web/package.json` (otherwise import icons from `@openclaude-studio/ui` re-export — choose ONE and be consistent).
- [ ] **Step 4: Typecheck web**
  Run: `cd apps/web && pnpm typecheck`
  Expected: exit 0.
- [ ] **Step 5: Commit**
```bash
git add apps/web packages/ui
git commit -m "feat(ui): add FileExplorer right pane with bridge /fs"
```

### Task 7: Compose `AppShell` (ZCode 3-pane grid) and rewire `Workbench`/`App`

**Files:**
- Create: `packages/ui/src/shell/AppShell.tsx`
- Modify: `packages/ui/src/index.ts` (re-export `AppShell`)
- Modify: `apps/web/src/Workbench.tsx` (replace `WorkbenchShell` usage with `AppShell` + new panes)
- Delete: `packages/ui/src/shell/WorkbenchShell.tsx`, `SessionRail.tsx`, `ConversationPane.tsx`, `ContextPanel.tsx`, `ComposerBar.tsx` (superseded — move their responsibilities into `ProjectRail`/`ChatPane`/`FileExplorer`/composer)
- Modify: `apps/web/src/use-agent-session.ts` (no logic change needed; keep surface)

**Interfaces:**
```ts
export type AppShellProps = {
  rail: ReactNode
  chat: ReactNode
  explorer: ReactNode
  overlay?: ReactNode
}
```
- Consumes: `ProjectRail`, `ChatPane`, `FileExplorer`, `ApprovalCard` (from `@openclaude-studio/ui`).
- Produces: top-level layout used by `Workbench`.

- [ ] **Step 1: Write `AppShell.tsx`**
  CSS grid: `grid-cols-[260px_1fr_280px]` on `>=1024px`, collapsing to `grid-cols-[1fr]` (chat only) below, with the rail and explorer toggled by `PanelLeft`/`PanelRight` buttons in a thin top bar. Dark, foundation tokens only.
- [ ] **Step 2: Re-export and delete superseded files**
  Append `export * from './shell/AppShell.js'` to `packages/ui/src/index.ts`. `git rm` the five old shell files listed above.
- [ ] **Step 3: Rewrite `Workbench.tsx`**
  Use `useAgentSession`, render `<AppShell rail={<ProjectRail .../>} chat={<ChatPane ...>{composer}</ChatPane>} explorer={<FileExplorer .../>} overlay={pendingPermission && <ApprovalCard .../>} />`. Wire `onSelect` to a `loadSession`/noop, `onNew` to `newSession`, composer = `<ComposerBar>` (keep existing `ComposerBar` OR inline a `ChatComposer`-based one — pick the BeautifulUI `ChatComposer` and adapt `onSend`).
- [ ] **Step 4: Typecheck all + test**
  Run: `pnpm -r typecheck && pnpm test` (root). Expected: all exit 0.
- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(web): compose ZCode 3-pane AppShell and rewire Workbench"
```

### Task 8: Build, deploy verification on aspire, and doc update

**Files:**
- Modify: `deploy/README.md` (note the `/fs` endpoint and three-pane layout)
- Modify: `apps/web/vite.config.ts` (unchanged — confirm 8768)

**Interfaces:** none new.

- [ ] **Step 1: Production build locally**
  Run: `pnpm --filter @openclaude-studio/web build`
  Expected: `apps/web/dist` produced, no errors.
- [ ] **Step 2: Push to github and sync aspire**
```bash
git push github HEAD
```
  Then on aspire (separate step, via ssh): `cd /home/dy/code/openclaude-studio && git fetch https://github.com/mahdyarief/openclaude-studio.git master && git merge FETCH_HEAD` (direct push rejected because master is checked out there).
- [ ] **Step 3: Rebuild on aspire & restart bridge + web server**
  On aspire: `corepack pnpm --filter @openclaude-studio/bridge build`, `sudo systemctl restart openclaude-studio`, restart the `/tmp/serve.mjs` static server on port 8768.
- [ ] **Step 4: Smoke-verify**
  - `curl -s -o /dev/null -w "%{http_code}" "http://100.84.56.62:8768/"` → `200`
  - `curl -s "http://100.84.56.62:8787/fs?path=.&token=<token>"` → JSON `FsListing` (use the token from `~/.config/openclaude-studio/bridge.env`)
  - `curl -s -o /dev/null -w "%{http_code}" "http://100.84.56.62:8787/fs?path=.&token=wrong"` → `401`
- [ ] **Step 5: Update deploy README**
  Document the three-pane layout and the new `/fs` endpoint + token requirement.
- [ ] **Step 6: Commit README**
```bash
git add deploy/README.md
git commit -m "docs(deploy): document 3-pane layout and /fs endpoint"
```
