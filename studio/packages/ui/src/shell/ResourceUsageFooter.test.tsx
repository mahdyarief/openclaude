import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResourceUsageFooter, type ResourceMetrics } from './ResourceUsageFooter.js'

const metrics: ResourceMetrics = {
  timestamp: 1,
  cpuPercent: 42.4,
  cpuCount: 8,
  load1: 1.25,
  load5: 1,
  load15: 0.75,
  memory: {
    rssBytes: 256 * 1024 * 1024,
    heapUsedBytes: 100 * 1024 * 1024,
    heapTotalBytes: 150 * 1024 * 1024,
    externalBytes: 1024,
  },
  systemMemory: {
    totalBytes: 16 * 1024 * 1024 * 1024,
    freeBytes: 8 * 1024 * 1024 * 1024,
    usedPercent: 50,
  },
  uptimeSeconds: 3600,
  bridgeUptimeSeconds: 125,
  activeSessions: 3,
}

describe('ResourceUsageFooter', () => {
  test('shows CPU, memory, sessions and uptime when metrics are available', () => {
    const html = renderToStaticMarkup(<ResourceUsageFooter metrics={metrics} />)

    expect(html).toContain('42%')
    expect(html).toContain('50%')
    expect(html).toContain('256 MB')
    expect(html).toContain('1.25')
    expect(html).toContain('2m 5s')
    expect(html).toContain('8 cores')
    expect(html).toContain('SESSIONS')
  })

  test('marks a warning badge when CPU crosses the warning band', () => {
    const html = renderToStaticMarkup(
      <ResourceUsageFooter metrics={{ ...metrics, cpuPercent: 70 }} />,
    )
    expect(html).toContain('border-orange/30')
  })

  test('shows loading state before the first sample arrives', () => {
    const html = renderToStaticMarkup(<ResourceUsageFooter metrics={null} />)
    expect(html).toContain('loading')
  })

  test('shows unavailable state when polling fails', () => {
    const html = renderToStaticMarkup(<ResourceUsageFooter metrics={null} error />)
    expect(html).toContain('unavailable')
  })
})
