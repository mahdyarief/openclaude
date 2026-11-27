import { cpus, freemem, loadavg, totalmem } from 'node:os'

export type ResourceMetrics = {
  /** epoch ms when the sample was taken */
  timestamp: number
  /** process CPU share, 0–100 across all cores */
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
  /** seconds the bridge process has been alive */
  uptimeSeconds: number
  /** seconds since this bridge instance started */
  bridgeUptimeSeconds: number
  /** live agent child processes (one per open session) */
  activeSessions: number
}

export type MetricsSampler = () => ResourceMetrics

const round = (value: number): number => Math.round(value * 10) / 10

/**
 * Builds a sampler that turns cumulative `process.cpuUsage()` counters into a
 * CPU percentage between calls. The first call has no interval to measure, so
 * it falls back to the process-wide average since the process started.
 */
export function createMetricsSampler(options: {
  startedAt: number
  activeSessions: () => number
  now?: () => number
}): MetricsSampler {
  const now = options.now ?? Date.now
  const cpuCount = Math.max(1, cpus().length)
  let previousUsage = process.cpuUsage()
  let previousAt = now()

  return () => {
    const at = now()
    const usage = process.cpuUsage()
    const elapsedMs = Math.max(0, at - previousAt)
    const cpuMicros =
      usage.user - previousUsage.user + (usage.system - previousUsage.system)
    previousUsage = usage
    previousAt = at

    const cpuPercent =
      elapsedMs > 0
        ? Math.min(100, (cpuMicros / (elapsedMs * 1000)) * 100 / cpuCount)
        : 0

    const memory = process.memoryUsage()
    const totalBytes = totalmem()
    const freeBytes = freemem()
    const [load1 = 0, load5 = 0, load15 = 0] = loadavg()

    return {
      timestamp: at,
      cpuPercent: round(cpuPercent),
      cpuCount,
      load1: round(load1),
      load5: round(load5),
      load15: round(load15),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
      systemMemory: {
        totalBytes,
        freeBytes,
        usedPercent: totalBytes > 0 ? round(((totalBytes - freeBytes) / totalBytes) * 100) : 0,
      },
      uptimeSeconds: Math.floor(process.uptime()),
      bridgeUptimeSeconds: Math.floor((at - options.startedAt) / 1000),
      activeSessions: options.activeSessions(),
    }
  }
}
