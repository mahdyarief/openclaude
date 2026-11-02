import { useCallback, useEffect, useState } from 'react'
import { httpOrigin, listProjectSessions, type SessionSummary } from '@openclaude-studio/acp'
import type { ActiveProject } from './project-store.js'

export type WorkspaceSessions = {
  sessions: SessionSummary[]
  loading: boolean
  error: string | null
}

export type WorkspaceSessionMap = Record<string, WorkspaceSessions>

const EMPTY: WorkspaceSessions = { sessions: [], loading: true, error: null }

/**
 * Loads sessions for every project the user has pinned to the rail, so each
 * workspace shows its own sessions without switching to it first. Keyed by
 * project path; a project absent from the map is still loading.
 */
export function useWorkspaceSessions(
  url: string,
  token: string,
  projects: ActiveProject[],
): { byPath: WorkspaceSessionMap; refresh: (path?: string) => void } {
  const [byPath, setByPath] = useState<WorkspaceSessionMap>({})
  const [nonce, setNonce] = useState(0)

  const paths = projects.map(project => project.path).join('\n')

  useEffect(() => {
    let cancelled = false
    const list = projects.map(project => project.path)

    setByPath(prev => {
      const next: WorkspaceSessionMap = {}
      for (const path of list) next[path] = prev[path] ?? EMPTY
      return next
    })

    for (const path of list) {
      listProjectSessions(httpOrigin(url), token, path)
        .then(sessions => {
          if (cancelled) return
          setByPath(prev => ({ ...prev, [path]: { sessions, loading: false, error: null } }))
        })
        .catch(cause => {
          if (cancelled) return
          const error = cause instanceof Error ? cause.message : String(cause)
          setByPath(prev => ({ ...prev, [path]: { sessions: [], loading: false, error } }))
        })
    }

    return () => {
      cancelled = true
    }
    // `paths` stands in for the project array; the array identity changes every
    // render, the joined path list only changes when a project is added/removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token, paths, nonce])

  const refresh = useCallback((path?: string) => {
    if (path) {
      setByPath(prev => ({ ...prev, [path]: { ...(prev[path] ?? EMPTY), loading: true, error: null } }))
    } else {
      setByPath(prev => {
        const next: WorkspaceSessionMap = {}
        for (const key of Object.keys(prev)) next[key] = { ...prev[key]!, loading: true, error: null }
        return next
      })
    }
    setNonce(value => value + 1)
  }, [])

  return { byPath, refresh }
}
