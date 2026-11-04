import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentStatusSnapshot } from '@openclaude-studio/acp'
import { SessionStatusBar } from './SessionStatusBar.js'

const snapshot: AgentStatusSnapshot = {
  model: { id: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5' },
  branch: 'feat/oc-studio',
  worktree: null,
  permissionMode: 'default',
  contextWindow: { usedPercent: 42, tokens: 84_000, size: 200_000 },
  session: { name: 'Test session', costUsd: 0.25, durationMs: 90_000 },
  backgroundTasks: { total: 0, running: 0, labels: [] },
}

describe('SessionStatusBar', () => {
  test('shows a placeholder when no snapshot exists yet', () => {
    const html = renderToStaticMarkup(<SessionStatusBar status={null} />)
    expect(html).toContain('No active session')
  })

  test('renders model, branch, context, cost and duration badges', () => {
    const html = renderToStaticMarkup(<SessionStatusBar status={snapshot} />)
    expect(html).toContain('Sonnet 4.5')
    expect(html).toContain('feat/oc-studio')
    expect(html).toContain('ctx 42%')
    expect(html).toContain('$0.2500')
    expect(html).toContain('1m')
  })

  test('warns and marks running background tasks', () => {
    const html = renderToStaticMarkup(
      <SessionStatusBar
        status={{
          ...snapshot,
          backgroundTasks: { total: 3, running: 1, labels: ['dev server'] },
        }}
      />,
    )
    expect(html).toContain('running 1/3')
    expect(html).toContain('border-orange/30')
  })

  test('shows a danger badge when context crosses the danger band', () => {
    const html = renderToStaticMarkup(
      <SessionStatusBar
        status={{ ...snapshot, contextWindow: { ...snapshot.contextWindow!, usedPercent: 90 } }}
      />,
    )
    expect(html).toContain('ctx 90%')
    expect(html).toContain('border-red/30')
  })
})
