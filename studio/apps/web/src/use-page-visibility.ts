import { useEffect, useState } from 'react'

/**
 * Tracks whether the browser tab is visible. A backgrounded tab may soft-idle
 * its finished agent sessions, but a hidden tab whose agent is still streaming
 * keeps its socket: the agent must be allowed to finish its turn.
 */
export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  )
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}
