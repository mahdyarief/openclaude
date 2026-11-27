import { describe, expect, it } from 'vitest'
import { createMetricsSampler } from '../src/metrics.js'

describe('metrics sampler', () => {
  it('reports a bounded CPU percentage and host memory fields', () => {
    let now = 1_000
    const sample = createMetricsSampler({
      startedAt: 1_000,
      activeSessions: () => 3,
      now: () => now,
    })

    now = 2_000
    const metrics = sample()

    expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(metrics.cpuPercent).toBeLessThanOrEqual(100)
    expect(metrics.cpuCount).toBeGreaterThanOrEqual(1)
    expect(metrics.activeSessions).toBe(3)
    expect(metrics.bridgeUptimeSeconds).toBe(1)
    expect(metrics.systemMemory.totalBytes).toBeGreaterThan(0)
    expect(metrics.systemMemory.usedPercent).toBeGreaterThanOrEqual(0)
    expect(metrics.systemMemory.usedPercent).toBeLessThanOrEqual(100)
    expect(metrics.memory.rssBytes).toBeGreaterThan(0)
    expect(metrics.memory.heapTotalBytes).toBeGreaterThan(0)
  })

  it('returns zero CPU when no time has elapsed between samples', () => {
    const sample = createMetricsSampler({
      startedAt: 0,
      activeSessions: () => 0,
      now: () => 5_000,
    })

    expect(sample().cpuPercent).toBe(0)
  })

  it('tracks active sessions from the supplied counter', () => {
    let live = 0
    const sample = createMetricsSampler({
      startedAt: 0,
      activeSessions: () => live,
      now: () => 1_000,
    })

    expect(sample().activeSessions).toBe(0)
    live = 2
    expect(sample().activeSessions).toBe(2)
  })
})
