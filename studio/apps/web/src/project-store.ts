export type ActiveProject = { path: string; name: string }

/** Last segment of a path, for either POSIX or Windows separators. */
export function folderName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return path.trim()
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

const STORAGE_KEY = 'openclaude.project'
const LIST_KEY = 'openclaude.projects'

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
      const project = parsed as ActiveProject
      // Older builds stored a slugified name; the rail reads folder names now.
      return { ...project, name: folderName(project.path) }
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

function isProject(value: unknown): value is ActiveProject {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ActiveProject).path === 'string' &&
    typeof (value as ActiveProject).name === 'string'
  )
}

/**
 * The recently-used project list. The active project is a separate key so a
 * user can switch between projects without losing the rest of their workspace.
 */
export function readProjectList(storage: Storage | null): ActiveProject[] {
  if (!storage) return []
  const raw = storage.getItem(LIST_KEY)
  if (!raw) {
    // Seed the list from a legacy single-project key so an upgrade does not
    // silently empty the sidebar.
    const active = readActiveProject(storage)
    return active ? [active] : []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isProject).map(p => ({ ...p, name: folderName(p.path) }))
  } catch {
    return []
  }
}

export function saveProjectList(storage: Storage, projects: ActiveProject[]): void {
  storage.setItem(LIST_KEY, JSON.stringify(projects))
}

/** Remember a project at the top of the list, de-duplicated by path. */
export function rememberProject(storage: Storage, project: ActiveProject): ActiveProject[] {
  const next = [project, ...readProjectList(storage).filter(p => p.path !== project.path)]
  saveProjectList(storage, next)
  return next
}

export function forgetProject(storage: Storage, path: string): ActiveProject[] {
  const next = readProjectList(storage).filter(p => p.path !== path)
  saveProjectList(storage, next)
  return next
}
