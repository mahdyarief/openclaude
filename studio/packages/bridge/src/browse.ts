import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'

export type BrowseEntry = {
  name: string
  path: string
  kind: 'file' | 'dir'
}

export type BrowseListing = {
  path: string
  parent: string | null
  home: string
  entries: BrowseEntry[]
}

export type BrowseRoot = { name: string; path: string }

const WIN_DRIVE = /^[a-zA-Z]:[\\/]/

// Drives on Windows, plus the usual POSIX starting points. This is what the
// picker shows when it first opens: a short list of places to start browsing
// instead of asking the user to type a path blind.
export function listRoots(): BrowseRoot[] {
  const home = homedir()
  if (process.platform !== 'win32') {
    return [
      { name: 'Home', path: home },
      { name: 'Filesystem', path: sep },
    ]
  }

  const roots: BrowseRoot[] = [{ name: 'Home', path: home }]
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:${sep}`
    try {
      if (statSync(drive).isDirectory()) roots.push({ name: drive, path: drive })
    } catch {
      // drive letter not mounted
    }
  }
  return roots
}

// Lists any absolute directory the bridge process can read. Unlike the
// scoped /fs route (which is rooted at the project cwd for the file tree),
// this one is meant for picking a project, so it must walk the whole device.
// It is still token-authenticated, and it never reads file contents.
export function browseDirectory(target: string | undefined): BrowseListing {
  const requested = target && target.trim() ? target.trim() : homedir()
  if (!isAbsolute(requested)) {
    throw new Error(`not an absolute path: ${requested}`)
  }
  if (process.platform === 'win32' && !WIN_DRIVE.test(requested)) {
    throw new Error(`not a drive path: ${requested}`)
  }

  const abs = resolve(requested)
  if (!statSync(abs).isDirectory()) {
    throw new Error(`not a directory: ${abs}`)
  }

  const entries = readdirSync(abs, { withFileTypes: true })
    .map(entry => {
      const entryAbs = join(abs, entry.name)
      return {
        name: entry.name,
        path: entryAbs,
        kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),
      } satisfies BrowseEntry
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  const rootPath = parse(abs).root
  return {
    path: abs,
    parent: abs === rootPath ? null : dirname(abs),
    home: homedir(),
    entries,
  }
}
