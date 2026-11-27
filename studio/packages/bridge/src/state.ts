import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  type PermissionMode,
} from '@openclaude-studio/acp'

/**
 * Server-backed UI state so the rail is seamless across devices. The bridge is
 * a single shared instance (deployed on aspire), so every client that reaches
 * it reads and writes the same file — no per-browser localStorage, no per-token
 * bucket (tokenless mode has no token to key on). One instance → one state.
 */
export type PersistedSession = { id: string; title: string }
export type PersistedWorkspace = { path: string; name: string }
export type UiState = {
  workspaces: PersistedWorkspace[]
  activePath: string | null
  sessions: PersistedSession[]
  /** how much the agent may do without asking; server-backed so all devices agree */
  permissionMode: PermissionMode
  /** bumped on every write so clients can drop stale frames */
  rev: number
}

const EMPTY: UiState = {
  workspaces: [],
  activePath: null,
  sessions: [],
  permissionMode: DEFAULT_PERMISSION_MODE,
  rev: 0,
}

// Location of the state file. Override with OPENCLAUDE_STUDIO_STATE_FILE when
// the default location is not writable (e.g. a systemd unit that only allows
// writes to specific paths via ReadWritePaths).
export function statePath(home: string = homedir()): string {
  const override = process.env.OPENCLAUDE_STUDIO_STATE_FILE
  if (override) return override
  return join(home, '.config', 'openclaude-studio', 'state.json')
}

export async function readState(home: string = homedir()): Promise<UiState> {
  try {
    const raw = await readFile(statePath(home), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY
    const p = parsed as Partial<UiState>
    return {
      workspaces: Array.isArray(p.workspaces) ? p.workspaces : [],
      activePath: typeof p.activePath === 'string' ? p.activePath : null,
      sessions: Array.isArray(p.sessions) ? p.sessions : [],
      permissionMode: isPermissionMode(p.permissionMode)
        ? p.permissionMode
        : EMPTY.permissionMode,
      rev: typeof p.rev === 'number' ? p.rev : 0,
    }
  } catch {
    return EMPTY
  }
}

export async function writeState(next: UiState, home: string = homedir()): Promise<UiState> {
  const target = statePath(home)
  await mkdir(dirname(target), { recursive: true })
  const stamped: UiState = { ...next, rev: next.rev + 1 }
  await writeFile(target, JSON.stringify(stamped), 'utf8')
  return stamped
}
