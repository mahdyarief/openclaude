import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PERMISSION_MODE_LABELS, PERMISSION_MODES } from '@openclaude-studio/acp'
import {
  SlashCommandNotice,
  SlashCommandPanelBody,
  type SlashCommandPanelData,
  type StudioPanelKind,
} from './SlashCommandPanel.js'

const data: SlashCommandPanelData = {
  permissionMode: 'acceptEdits',
  modes: PERMISSION_MODES.map(id => ({ id, label: PERMISSION_MODE_LABELS[id] })),
  onModeChange: () => {},
  status: {
    model: { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
    branch: 'feat/oc-studio',
    worktree: { name: 'studio-wt', path: '/tmp/wt', branch: 'feat/oc-studio' },
    permissionMode: 'acceptEdits',
    effort: 'high',
    statusLineText: null,
    contextWindow: { usedPercent: 42, tokens: 84_000, size: 200_000 },
    session: { name: 'parity work', costUsd: 0.1234, durationMs: 125_000 },
    backgroundTasks: { total: 3, running: 1, labels: ['build', 'lint', 'test'] },
  },
  usage: { used: 84_000, size: 200_000 },
  diffs: [{ type: 'diff', path: 'src/commands.ts', oldText: 'old line', newText: 'new line' }],
  sessions: [
    { id: 'session-a', title: 'Slash command parity', updatedAt: Date.UTC(2026, 10, 9), messageCount: 12 },
    { id: 'session-b', title: '', updatedAt: Date.UTC(2026, 10, 8), messageCount: 3 },
  ],
  sessionsLoading: false,
  sessionsError: null,
  onOpenSession: () => {},
}

/** React escapes quotes in text as entities; compare against readable text. */
function text(html: string): string {
  return html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"')
}

function render(panel: StudioPanelKind, overrides: Partial<SlashCommandPanelData> = {}) {
  return text(
    renderToStaticMarkup(
      <SlashCommandPanelBody panel={panel} data={{ ...data, ...overrides }} />,
    ),
  )
}

describe('SlashCommandPanelBody', () => {
  test('/permissions lists every mode and marks the active one', () => {
    const html = render('permissions')
    for (const label of Object.values(PERMISSION_MODE_LABELS)) {
      expect(html).toContain(label)
    }
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"')
  })

  test('/permissions prefers the agent snapshot over the local mode prop', () => {
    const html = render('permissions', {
      permissionMode: 'default',
      status: { ...data.status!, permissionMode: 'plan' },
    })
    expect(html).toContain('aria-pressed="true">Plan mode')
    expect(html).toContain('aria-pressed="false">Default')
  })

  test('/permissions falls back to the local mode before a snapshot arrives', () => {
    const html = render('permissions', { permissionMode: 'fullAccess', status: null })
    expect(html).toContain('aria-pressed="true">Full access')
  })

  test('/status shows the live statusline snapshot', () => {
    const html = render('status')
    expect(html).toContain('Opus 4.8')
    expect(html).toContain('feat/oc-studio')
    expect(html).toContain('studio-wt')
    expect(html).toContain('42% of 200,000 tokens')
    expect(html).toContain('parity work')
    expect(html).toContain('$0.1234')
    expect(html).toContain('2m 5s')
    expect(html).toContain('1 running of 3')
  })

  test('/status explains when no snapshot has arrived', () => {
    const html = render('status', { status: null })
    expect(html).toContain('has not reported a status snapshot yet')
  })

  test('/diff renders every reported diff with its path', () => {
    const html = render('diff')
    expect(html).toContain('src/commands.ts')
    expect(html).toContain('new line')
    expect(html).toContain('old line')
  })

  test('/diff explains when nothing changed yet', () => {
    const html = render('diff', { diffs: [] })
    expect(html).toContain('No file changes')
  })

  test('/tasks lists background task labels', () => {
    const html = render('tasks')
    expect(html).toContain('build')
    expect(html).toContain('lint')
    expect(html).toContain('test')
    expect(html).toContain('Running')
  })

  test('/tasks explains when no task is running', () => {
    const html = render('tasks', {
      status: { ...data.status!, backgroundTasks: { total: 0, running: 0, labels: [] } },
    })
    expect(html).toContain('No background tasks are running')
  })

  test('/usage reports tokens, context share, cost and elapsed', () => {
    const html = render('usage')
    expect(html).toContain('84,000 / 200,000')
    expect(html).toContain('42%')
    expect(html).toContain('$0.1234')
    expect(html).toContain('2m 5s')
  })

  test('/sessions lists saved sessions and falls back to the id', () => {
    const html = render('sessions')
    expect(html).toContain('Slash command parity')
    expect(html).toContain('session-b')
    expect(html).toContain('12 messages')
  })

  test('/resume labels each entry as resumable', () => {
    const html = render('resume')
    expect(html).toContain('Slash command parity')
    expect(html).toContain('resume')
  })

  test('session panels surface loading, error and empty states', () => {
    expect(render('sessions', { sessionsLoading: true })).toContain('Loading sessions')
    expect(render('sessions', { sessionsError: 'bridge offline' })).toContain('bridge offline')
    expect(render('sessions', { sessions: [] })).toContain('No saved sessions')
  })

  test('/mcp says the server list is not available instead of faking one', () => {
    const html = render('mcp')
    expect(html).toContain('not available in Studio yet')
  })
})

describe('SlashCommandNotice', () => {
  test('shows the command name, the reason and a dismiss control', () => {
    const html = renderToStaticMarkup(
      <SlashCommandNotice
        title="/agents is not available in Studio"
        description="This command renders an interactive terminal UI. Your message was not sent."
        onDismiss={() => {}}
      />,
    )
    expect(html).toContain('/agents is not available in Studio')
    expect(html).toContain('Your message was not sent.')
    expect(html).toContain('Dismiss')
    expect(html).toContain('role="status"')
  })
})
