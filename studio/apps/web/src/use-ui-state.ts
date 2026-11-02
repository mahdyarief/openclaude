import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchUiState,
  saveUiState,
  type UiState,
} from '@openclaude-studio/acp'
import type { BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'
import {
  clearActiveProject,
  folderName,
  readActiveProject,
  readProjectList,
  rememberProject,
  forgetProject,
  saveActiveProject,
} from './project-store.js'

export type UiStateController = {
  /** true while the initial server state is still loading */
  loading: boolean
  /** the pinned workspaces, server-backed, seeded from localStorage on first run */
  projects: ActiveProject[]
  /** the workspace the center pane is showing */
  active: ActiveProject | null
  /** open session ids, persisted so every device resumes the same tabs */
  openSessions: string[]
  addProject: (project: ActiveProject) => void
  removeProject: (path: string) => void
  switchProject: (project: ActiveProject) => void
  setOpenSessions: (ids: string[]) => void
  refresh: () => void
}

/**
 * Server-backed rail state. The bridge stores one UiState file per instance, so
 * every device that connects to the same bridge sees the same workspaces,
 * active workspace, and open sessions (seamless like orca). localStorage is
 * kept only as a first-run seed and an offline fallback.
 */
export function useUiState(config: BridgeConfig | null): UiStateController {
  const [projects, setProjects] = useState<ActiveProject[]>(() =>
    readProjectList(typeof localStorage === 'undefined' ? null : localStorage),
  )
  const [active, setActive] = useState<ActiveProject | null>(() =>
    readActiveProject(typeof localStorage === 'undefined' ? null : localStorage),
  )
  const [openSessions, setOpenSessions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const openSessionsRef = useRef(openSessions)
  openSessionsRef.current = openSessions

  const persist = useCallback(
    (nextProjects: ActiveProject[], nextActive: ActiveProject | null, nextOpen: string[]) => {
      if (!config) return
      void saveUiState(config.url, config.token, {
        workspaces: nextProjects.map(p => ({ path: p.path, name: p.name })),
        activePath: nextActive?.path ?? null,
        sessions: nextOpen.map(id => ({ id, title: id })),
      }).catch(() => {
        /* offline: keep the in-memory state; the next save retries */
      })
    },
    [config],
  )

  // Load the server state once when the bridge connects.
  useEffect(() => {
    if (!config || loadedRef.current) return
    let cancelled = false
    loadedRef.current = true
    fetchUiState(config.url, config.token)
      .then(server => {
        if (cancelled) return
        const serverProjects: ActiveProject[] = (server.workspaces ?? []).map(w => ({
          path: w.path,
          name: w.name || folderName(w.path),
        }))
        // Prefer the server as source of truth; fall back to the local seed when
        // the server has never been written (first run on a fresh bridge).
        const nextProjects = serverProjects.length > 0 ? serverProjects : projects
        const nextActivePath = server.activePath ?? activeRef.current?.path ?? null
        const nextActive =
          nextProjects.find(p => p.path === nextActivePath) ??
          nextProjects[0] ??
          null
        setProjects(nextProjects)
        setActive(nextActive)
        setOpenSessions((server.sessions ?? []).map(s => s.id))
        if (nextActive) saveActiveProject(localStorage, nextActive)
      })
      .catch(() => {
        /* bridge unreachable: keep the local seed */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Load only once per bridge connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const addProject = useCallback(
    (project: ActiveProject) => {
      const next = rememberProject(localStorage, project)
      setProjects(next)
      setActive(project)
      saveActiveProject(localStorage, project)
      persist(next, project, openSessionsRef.current)
    },
    [persist],
  )

  const removeProject = useCallback(
    (path: string) => {
      const remaining = forgetProject(localStorage, path)
      setProjects(remaining)
      const nextActive =
        activeRef.current?.path !== path
          ? activeRef.current
          : (remaining[0] ?? null)
      setActive(nextActive)
      if (nextActive) saveActiveProject(localStorage, nextActive)
      else clearActiveProject(localStorage)
      persist(remaining, nextActive, openSessionsRef.current)
    },
    [persist],
  )

  const switchProject = useCallback(
    (project: ActiveProject) => {
      setActive(project)
      saveActiveProject(localStorage, project)
      persist(projectsRef.current, project, openSessionsRef.current)
    },
    [persist],
  )

  const setOpenSessionsCb = useCallback(
    (ids: string[]) => {
      setOpenSessions(ids)
      persist(projectsRef.current, activeRef.current, ids)
    },
    [persist],
  )

  const refresh = useCallback(() => {
    if (!config) return
    void fetchUiState(config.url, config.token)
      .then(server => {
        const serverProjects: ActiveProject[] = (server.workspaces ?? []).map(w => ({
          path: w.path,
          name: w.name || folderName(w.path),
        }))
        if (serverProjects.length > 0) setProjects(serverProjects)
        if (server.activePath) {
          const found = serverProjects.find(p => p.path === server.activePath)
          if (found) setActive(found)
        }
        setOpenSessions((server.sessions ?? []).map(s => s.id))
      })
      .catch(() => {
        /* silent refresh failure */
      })
  }, [config])

  return {
    loading,
    projects,
    active,
    openSessions,
    addProject,
    removeProject,
    switchProject,
    setOpenSessions: setOpenSessionsCb,
    refresh,
  }
}
