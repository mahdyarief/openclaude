import { describe, expect, test } from 'vitest'
import { resolveAgentEntry } from '../src/resolve-agent.js'

describe('resolveAgentEntry', () => {
  test('resolves the installed openclaude sdk and acp entries', () => {
    const entry = resolveAgentEntry()
    expect(entry.sdk).toMatch(/openclaude[/\\]dist[/\\]sdk\.mjs$/)
    expect(entry.acp).toMatch(/openclaude[/\\]dist[/\\]acp\.mjs$/)
  })
})
