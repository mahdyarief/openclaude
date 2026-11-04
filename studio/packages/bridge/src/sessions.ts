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

// The project directory name is a lossy sanitization of the real cwd (every
// non-alphanumeric char becomes '-'), so inverting it ('-' → '/') yields wrong
// paths for any cwd containing a hyphen (e.g. `D:/Github/my-app` →
// `D:/Github/my/app`). Recover the real cwd from the session files instead;
// each records it under `cwd`. Fall back to the inverted name only when no
// session carries one (e.g. an empty project directory).
async function recoverCwd(dir: string): Promise<string | null> {
  const files = await safeReaddir(dir)
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
    try {
      const content = await readFile(join(dir, file.name), 'utf8')
      for (const line of content.split('\n')) {
        if (!line.includes('"cwd"')) continue
        try {
          const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd
          if (typeof cwd === 'string' && cwd) return cwd
        } catch {
          // ignore malformed lines
        }
      }
    } catch {
      // unreadable file: keep scanning the others
    }
  }
  return null
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
    const path = (await recoverCwd(dir)) ?? projectDirNameToPath(entry.name)
    projects.push({ name: entry.name, path, sessionCount })
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

// A replayed conversation message (matches the web's ConversationMessage shape:
// a role plus ordered parts), so history from disk can be loaded straight into
// the session store without the bridge knowing about ACP streaming.
export type ReplayedPart =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; toolCallId: string }

export type ReplayedMessage = {
  id: string
  role: 'user' | 'agent'
  parts: ReplayedPart[]
}

// Map an OpenClaude JSONL session file into replayed messages. We only need the
// user/assistant turns with their text, thinking, and tool-call blocks; system
// lines, snapshots, and control records are skipped. Tool *results* are not
// separate messages — they belong to the preceding tool call and are elided
// here since the store keys tool calls by id during streaming, not history.
function parseSessionHistory(content: string): ReplayedMessage[] {
  const messages: ReplayedMessage[] = []
  // OpenClaude writes one JSONL line per content block, and consecutive lines
  // for the same assistant turn repeat the same `message.id`. Group by that id
  // so a turn with thinking + text + several tool calls stays one message.
  let currentId: string | null = null

  for (const raw of content.split('\n')) {
    if (!raw.trim()) continue
    let record: {
      message?: { id?: string; role?: string; content?: unknown }
    }
    try {
      record = JSON.parse(raw)
    } catch {
      continue
    }
    const role = record.message?.role
    if (role !== 'user' && role !== 'assistant') continue

    const id = record.message?.id ?? null
    const isSameTurn = id !== null && id === currentId
    let message = isSameTurn ? messages[messages.length - 1] : undefined
    if (!message) {
      message = {
        id: id ?? `${role}-${messages.length}`,
        role: role === 'user' ? 'user' : 'agent',
        parts: [],
      }
      messages.push(message)
      currentId = id
    }

    const content = record.message?.content
    if (typeof content === 'string') {
      if (content.trim()) message.parts.push({ kind: 'text', text: content })
    } else if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        const kind = block['type']
        if (kind === 'text' && typeof block['text'] === 'string' && (block['text'] as string).trim()) {
          message.parts.push({ kind: 'text', text: block['text'] as string })
        } else if (kind === 'thinking' && typeof block['thinking'] === 'string') {
          message.parts.push({ kind: 'thought', text: block['thinking'] as string })
        } else if (kind === 'tool_use' && typeof block['id'] === 'string') {
          message.parts.push({ kind: 'tool', toolCallId: block['id'] as string })
        }
      }
    }
  }
  return messages.filter(message => message.parts.length > 0)
}

export async function getSessionHistory(root: string, cwd: string, sessionId: string): Promise<ReplayedMessage[]> {
  const fileName = `${sessionId}.jsonl`
  // The client only knows the session id and the cwd it guesses from the
  // restored tab; that guess can be wrong early in load, and `sanitizeCwd` is a
  // lossy mapping ('-' swallows real hyphens in a path). Rather than trust the
  // directory derived from `cwd`, scan every project dir and match the session
  // that actually recorded this `cwd` (each JSONL stores its `cwd`). This is why
  // a freshly opened session no longer renders blank until a manual refresh.
  let directHit: string | null = null
  for (const entry of await safeReaddir(root)) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, fileName)
    try {
      await stat(candidate)
    } catch {
      continue
    }
    if (entry.name === sanitizeCwd(cwd)) {
      directHit = candidate
      break
    }
    const recovered = await recoverCwd(join(root, entry.name))
    if (recovered === cwd) {
      directHit = candidate
      break
    }
    if (directHit === null) directHit = candidate
  }

  if (directHit === null) return []
  try {
    const content = await readFile(directHit, 'utf8')
    return parseSessionHistory(content)
  } catch {
    return []
  }
}
