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
  const res = await fetch(`${httpOrigin(baseUrl)}/projects?token=${encodeURIComponent(token)}`, {
    method: 'GET',
  })
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
    { method: 'GET' },
  )
  if (!res.ok) throw new Error(`sessions request failed: ${res.status}`)
  const data = (await res.json()) as { sessions?: SessionSummary[] }
  return data.sessions ?? []
}

export type ReplayedPart =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; toolCallId: string }

export type ReplayedMessage = {
  id: string
  role: 'user' | 'agent'
  parts: ReplayedPart[]
}

export async function fetchSessionHistory(
  baseUrl: string,
  token: string,
  cwd: string,
  sessionId: string,
): Promise<ReplayedMessage[]> {
  const res = await fetch(
    `${httpOrigin(baseUrl)}/session-history?cwd=${encodeURIComponent(cwd)}&id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`,
    { method: 'GET' },
  )
  if (!res.ok) throw new Error(`session-history request failed: ${res.status}`)
  const data = (await res.json()) as { messages?: ReplayedMessage[] }
  return data.messages ?? []
}

export type UiStateWorkspace = { path: string; name: string }
export type UiStateSession = { id: string; title: string }
export type UiState = {
  workspaces: UiStateWorkspace[]
  activePath: string | null
  sessions: UiStateSession[]
  /** server-assigned monotonic revision; the client drops frames at or below its last seen rev */
  rev?: number
}

// The rail's pinned workspaces, active workspace, and open sessions live on the
// bridge so every device that connects sees the same state (seamless like orca).
export async function fetchUiState(baseUrl: string, token: string): Promise<UiState> {
  const res = await fetch(`${httpOrigin(baseUrl)}/state?token=${encodeURIComponent(token)}`, {
    method: 'GET',
  })
  if (!res.ok) throw new Error(`state request failed: ${res.status}`)
  return (await res.json()) as UiState
}

export async function saveUiState(
  baseUrl: string,
  token: string,
  state: UiState,
): Promise<UiState> {
  const res = await fetch(`${httpOrigin(baseUrl)}/state?token=${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error(`state save failed: ${res.status}`)
  return (await res.json()) as UiState
}

// Opens the SSE feed at `/state/stream` and invokes `onState` with each state
// update (the initial snapshot, then every write). Returns an unsubscribe
// function; the connection is closed on unmount. Keeps the rail in sync across
// devices without polling.
export function subscribeUiState(
  baseUrl: string,
  token: string,
  onState: (state: UiState) => void,
): () => void {
  const url = `${httpOrigin(baseUrl)}/state/stream?token=${encodeURIComponent(token)}`
  const source = new EventSource(url)
  const handler = (event: MessageEvent): void => {
    try {
      onState(JSON.parse(event.data) as UiState)
    } catch {
      /* ignore malformed frames */
    }
  }
  source.addEventListener('state', handler)
  return () => source.close()
}

export type BrowseEntry = { name: string; path: string; kind: 'file' | 'dir' }
export type BrowseListing = {
  path: string
  parent: string | null
  home: string
  entries: BrowseEntry[]
}
export type BrowseRoot = { name: string; path: string }

// Browsing walks the bridge host's filesystem, so a remote user can pick a
// project folder that has no OpenClaude session yet. `/fs` stays cwd-scoped
// for the explorer; `/browse` is the unscoped, token-authenticated sibling.
export async function browseDirectory(
  baseUrl: string,
  token: string,
  path?: string,
): Promise<BrowseListing> {
  const query = new URLSearchParams({ token })
  if (path) query.set('path', path)
  const res = await fetch(`${httpOrigin(baseUrl)}/browse?${query.toString()}`, { method: 'GET' })
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { error?: string }
    throw new Error(body.error ?? `browse request failed: ${res.status}`)
  }
  return (await res.json()) as BrowseListing
}

export async function listRoots(baseUrl: string, token: string): Promise<BrowseRoot[]> {
  const res = await fetch(
    `${httpOrigin(baseUrl)}/roots?token=${encodeURIComponent(token)}`,
    { method: 'GET' },
  )
  if (!res.ok) throw new Error(`roots request failed: ${res.status}`)
  const data = (await res.json()) as { roots?: BrowseRoot[] }
  return data.roots ?? []
}

export type FsEntry = { name: string; path: string; kind: 'file' | 'dir'; size: number }
export type FsListing = { root: string; path: string; entries: FsEntry[] }
export type FsFile = {
  root: string
  path: string
  size: number
  /** true when the file is binary or too large to preview as text */
  truncated: boolean
  text: string
}

// Lists one directory of the pinned workspace. `root` scopes the bridge to the
// workspace path; `path` is relative to that root.
export async function listWorkspaceDirectory(
  baseUrl: string,
  token: string,
  root: string,
  path = '.',
): Promise<FsListing> {
  const query = new URLSearchParams({ token, root, path })
  const res = await fetch(`${httpOrigin(baseUrl)}/fs?${query.toString()}`, { method: 'GET' })
  if (!res.ok) throw new Error(`fs request failed: ${res.status}`)
  return (await res.json()) as FsListing
}

// Reads a single workspace file for the explorer preview.
export async function readWorkspaceFile(
  baseUrl: string,
  token: string,
  root: string,
  path: string,
): Promise<FsFile> {
  const query = new URLSearchParams({ token, root, path })
  const res = await fetch(`${httpOrigin(baseUrl)}/file?${query.toString()}`, { method: 'GET' })
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { error?: string }
    throw new Error(body.error ?? `file request failed: ${res.status}`)
  }
  return (await res.json()) as FsFile
}

// Saves edited text back to one workspace file. The bridge answers with the
// re-read file so the caller can reset its dirty baseline from the same bytes
// the disk now holds.
export async function saveWorkspaceFile(
  baseUrl: string,
  token: string,
  root: string,
  path: string,
  text: string,
): Promise<FsFile> {
  const query = new URLSearchParams({ token, root, path })
  const res = await fetch(`${httpOrigin(baseUrl)}/file?${query.toString()}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { error?: string }
    throw new Error(body.error ?? `save request failed: ${res.status}`)
  }
  return (await res.json()) as FsFile
}
