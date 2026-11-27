import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

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

const MAX_PREVIEW_BYTES = 512 * 1024
// A preview is text-only; sniffing NUL bytes catches binaries cheaply.
const BINARY_HINTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.zip', '.gz',
  '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf',
  '.otf', '.mp3', '.mp4', '.mov', '.avi', '.wasm', '.class', '.jar', '.bin',
])

// Lists a directory relative to `root`, scoped so that traversal outside `root`
// throws. Used by the bridge's authenticated GET /fs endpoint.
export function listDirectory(root: string, relPath: string): FsListing {
  const abs = resolve(root, relPath)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || resolve(root, rel) !== abs) {
    throw new Error(`path escapes root: ${relPath}`)
  }

  const entries = readdirSync(abs, { withFileTypes: true })
    .map(entry => {
      const entryAbs = join(abs, entry.name)
      const isDir = entry.isDirectory()
      return {
        name: entry.name,
        path: relative(root, entryAbs),
        kind: isDir ? ('dir' as const) : ('file' as const),
        size: isDir ? 0 : statSync(entryAbs).size,
      } satisfies FsEntry
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return { root, path: rel, entries }
}

// Reads a single file scoped to `root`, returning a text preview. Large or
// binary files are flagged (text truncated/empty) rather than streamed whole.
// Used by the bridge's authenticated GET /file endpoint.
export function readFileScoped(root: string, relPath: string): FsFile {
  const abs = resolve(root, relPath)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || resolve(root, rel) !== abs) {
    throw new Error(`path escapes root: ${relPath}`)
  }
  const stat = statSync(abs)
  if (stat.isDirectory()) throw new Error(`not a file: ${relPath}`)

  const ext = extname(abs).toLowerCase()
  const tooLarge = stat.size > MAX_PREVIEW_BYTES
  const binary = BINARY_HINTS.has(ext)
  let text = ''
  let truncated = false
  if (!binary && !tooLarge) {
    text = readFileSync(abs, 'utf8')
  } else {
    truncated = true
  }

  return { root, path: rel, size: stat.size, truncated, text }
}

// Writes `text` back to the file at `relPath` inside `root`, using the same
// root-scoping check as `readFileScoped` so a client can never escape its
// workspace. The caller (the authenticated /file endpoint) is the only path
// into this function, so the token gate is the security boundary.
export function writeFileScoped(root: string, relPath: string, text: string): void {
  const abs = resolve(root, relPath)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || resolve(root, rel) !== abs) {
    throw new Error(`path escapes root: ${relPath}`)
  }
  const stat = statSync(abs)
  if (stat.isDirectory()) throw new Error(`not a file: ${relPath}`)
  writeFileSync(abs, text, 'utf8')
}
