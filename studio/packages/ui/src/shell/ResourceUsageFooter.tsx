import { Badge } from '../shadcn/badge.js'
import { Separator } from '../shadcn/separator.js'

/** Live host resource snapshot pushed from the bridge `/metrics` endpoint. */
export type ResourceMetrics = {
  timestamp: number
  cpuPercent: number
  cpuCount: number
  load1: number
  load5: number
  load15: number
  memory: {
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
  }
  systemMemory: {
    totalBytes: number
    freeBytes: number
    usedPercent: number
  }
  uptimeSeconds: number
  bridgeUptimeSeconds: number
  activeSessions: number
}

export type ResourceUsageFooterProps = {
  metrics: ResourceMetrics | null
  /** true when the last poll failed (endpoint unreachable) */
  error?: boolean
  className?: string
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

// CPU/MEM thresholds drive the badge tint. Kept local since this is the only
// consumer and the bands mirror the orca status-bar conventions.
function usageVariant(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 85) return 'danger'
  if (pct >= 60) return 'warning'
  return 'success'
}

/**
 * Slim orca-style status footer. Composition of shadcn primitives only — no
 * bespoke controls — showing live host CPU, memory, load average, active
 * sessions, and bridge uptime. Sits under the resizable shell so it never
 * competes with the side panels for vertical space.
 */
export function ResourceUsageFooter({ metrics, error, className }: ResourceUsageFooterProps) {
  if (error || !metrics) {
    return (
      <footer
        className={[
          'flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-canvas px-2 py-1 text-[11px] text-ink-2',
          className,
        ].join(' ')}
      >
        <Badge variant="outline">resource usage</Badge>
        <Badge variant={error ? 'danger' : 'default'}>
          {error ? 'unavailable' : 'loading…'}
        </Badge>
      </footer>
    )
  }

  const cpu = metrics.cpuPercent
  const mem = metrics.systemMemory.usedPercent

  return (
    <footer
      className={[
        'flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-canvas px-2 py-1 text-[11px] text-ink-2',
        className,
      ].join(' ')}
    >
      <Badge variant="outline">openclaude</Badge>

      <Separator orientation="vertical" className="hidden h-4 md:block" />

      <span className="flex items-center gap-1">
        CPU
        <Badge variant={usageVariant(cpu)}>{cpu.toFixed(0)}%</Badge>
      </span>

      <span className="flex items-center gap-1">
        MEM
        <Badge variant={usageVariant(mem)}>
          {mem.toFixed(0)}% · {formatBytes(metrics.memory.rssBytes)}
        </Badge>
      </span>

      <span className="hidden items-center gap-1 sm:flex">
        LOAD
        <Badge variant="default">{metrics.load1.toFixed(2)}</Badge>
      </span>

      <Separator orientation="vertical" className="hidden h-4 md:block" />

      <span className="hidden items-center gap-1 md:flex">
        SESSIONS
        <Badge variant="accent">{metrics.activeSessions}</Badge>
      </span>

      <span className="hidden items-center gap-1 md:flex">
        UP
        <Badge variant="default">{formatDuration(metrics.bridgeUptimeSeconds)}</Badge>
      </span>

      <span className="ml-auto hidden items-center gap-1 text-ink-3 sm:flex">
        {metrics.cpuCount} cores · {formatBytes(metrics.systemMemory.totalBytes)} total
      </span>
    </footer>
  )
}
