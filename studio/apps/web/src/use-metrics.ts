import { useEffect, useRef, useState } from 'react'
import { httpOrigin } from '@openclaude-studio/acp'
import type { ResourceMetrics } from '@openclaude-studio/ui'
import type { BridgeConfig } from './bridge-config.js'

export type { ResourceMetrics }

export type UseMetrics = {
  metrics: ResourceMetrics | null
  error: boolean
}

export const METRICS_POLL_MS = 3000

/**
 * One-shot fetch of the bridge's host resource snapshot. Kept separate from the
 * hook so it can be exercised in a plain node test environment.
 */
export async function fetchMetrics(config: BridgeConfig): Promise<ResourceMetrics> {
  const res = await fetch(
    `${httpOrigin(config.url)}/metrics?token=${encodeURIComponent(config.token)}`,
    { method: 'GET' },
  )
  if (!res.ok) throw new Error(`metrics request failed: ${res.status}`)
  return (await res.json()) as ResourceMetrics
}

/**
 * Polls the bridge `/metrics` endpoint so the status footer can show live host
 * resource usage (CPU, memory, load, uptime, active sessions). Polling backs
 * off to a longer interval after a failure and resumes the steady rate once a
 * request succeeds.
 */
export function useMetrics(config: BridgeConfig | null): UseMetrics {
  const [metrics, setMetrics] = useState<ResourceMetrics | null>(null)
  const [error, setError] = useState(false)
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    if (!config) return
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    const tick = async (): Promise<void> => {
      const current = configRef.current
      if (!current) return
      try {
        const body = await fetchMetrics(current)
        if (cancelled) return
        setMetrics(body)
        setError(false)
        timeoutId = setTimeout(() => void tick(), METRICS_POLL_MS)
      } catch {
        if (cancelled) return
        setError(true)
        timeoutId = setTimeout(() => void tick(), METRICS_POLL_MS * 2)
      }
    }

    void tick()
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [config])

  return { metrics, error }
}
