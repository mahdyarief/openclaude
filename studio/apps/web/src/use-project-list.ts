import { useCallback, useEffect, useState } from 'react'
import {
  listProjects,
  type ProjectSummary,
} from '@openclaude-studio/acp'
import type { BridgeConfig } from './bridge-config.js'
import {
  forgetProject,
  rememberProject,
  readProjectList,
  type ActiveProject,
} from './project-store.js'

export type ProjectListState = {
  /** projects discovered on the bridge */
  discovered: ProjectSummary[]
  /** projects the user has opened before (most-recent first) */
  recent: ActiveProject[]
  loading: boolean
  error: string | null
  refresh: () => void
  /** persist a project as the active + recently used one */
  remember: (project: ActiveProject) => void
  forget: (path: string) => void
}

/**
 * Bridges two ideas: the set of projects the bridge actually serves, and the
 * projects the user has opened recently. Recent projects are the projects the
 * user can jump straight back into; discovered projects are everything the
 * bridge sees this session.
 */
export function useProjectList(config: BridgeConfig): ProjectListState {
  const [discovered, setDiscovered] = useState<ProjectSummary[]>([])
  const [recent, setRecent] = useState<ActiveProject[]>(() =>
    readProjectList(typeof localStorage === 'undefined' ? null : localStorage),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    listProjects(config.url, config.token)
      .then(next => setDiscovered(next))
      .catch(cause =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setLoading(false))
  }, [config.url, config.token])

  const remember = useCallback((project: ActiveProject) => {
    if (typeof localStorage !== 'undefined') {
      setRecent(rememberProject(localStorage, project))
    } else {
      setRecent(prev => [project, ...prev.filter(p => p.path !== project.path)])
    }
  }, [])

  const forget = useCallback((path: string) => {
    if (typeof localStorage !== 'undefined') {
      setRecent(forgetProject(localStorage, path))
    } else {
      setRecent(prev => prev.filter(p => p.path !== path))
    }
  }, [])

  // Fetch the bridge's project index once on mount so the rail can show
  // every project that has OpenClaude sessions on disk.
  useEffect(() => {
    refresh()
  }, [refresh])

  return { discovered, recent, loading, error, refresh, remember, forget }
}
