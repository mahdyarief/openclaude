import { useCallback, useEffect, useState } from 'react'
import { listProjectSessions, httpOrigin, type SessionSummary } from '@openclaude-studio/acp'

export function groupSessions(
  sessions: SessionSummary[],
  activeId: string | null,
): Array<{ id: string; title: string; active: boolean }> {
  return sessions.map(session => ({
    id: session.id,
    title: session.title,
    active: session.id === activeId,
  }))
}

export function useProjectSessions(
  url: string,
  token: string,
  cwd: string,
): { sessions: SessionSummary[]; loading: boolean; error: string | null; refresh: () => void } {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listProjectSessions(httpOrigin(url), token, cwd))
    } catch (cause) {
      // Swallow the error so a flaky session listing can't crash the app.
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [url, token, cwd])

  useEffect(() => {
    void load()
  }, [load])

  return { sessions, loading, error, refresh: () => void load() }
}
