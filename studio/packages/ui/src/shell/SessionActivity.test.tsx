import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Plan, SessionConfigOption } from '@openclaude-studio/acp'
import { SessionActivity } from './SessionActivity.js'

/** React escapes quotes in text as entities; compare against readable text. */
function text(html: string): string {
  return html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"')
}

function render(props: Parameters<typeof SessionActivity>[0]): string {
  return text(renderToStaticMarkup(<SessionActivity {...props} />))
}

const plan: Plan = {
  entries: [
    { content: 'Inspect the reducer', priority: 'high', status: 'completed' },
    { content: 'Render the plan', priority: 'medium', status: 'in_progress' },
    { content: 'Verify parity', priority: 'low', status: 'pending' },
  ],
}

describe('SessionActivity', () => {
  test('renders nothing when there is no activity', () => {
    expect(render({})).toBe('')
  })

  test('renders a notice with a dismiss button when a callback is given', () => {
    const html = render({
      notice: { severity: 'info', title: 'Agent resumed', description: 'Context restored.' },
      onDismissNotice: () => {},
    })
    expect(html).toContain('role="status"')
    expect(html).toContain('Agent resumed')
    expect(html).toContain('Context restored.')
    expect(html).toContain('Dismiss')
  })

  test('renders a warning notice without a dismiss button and uses an alert role', () => {
    const html = render({
      notice: { severity: 'warning', title: 'Context nearly full' },
    })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Context nearly full')
    expect(html).not.toContain('Dismiss')
  })

  test('renders every plan entry with its content and status', () => {
    const html = render({ plan })
    expect(html).toContain('Plan')
    expect(html).toContain('Inspect the reducer')
    expect(html).toContain('completed')
    expect(html).toContain('Render the plan')
    expect(html).toContain('in_progress')
    expect(html).toContain('Verify parity')
    expect(html).toContain('pending')
    expect(html).toContain('<ol')
  })

  test('renders compaction rows and error text', () => {
    const html = render({
      compactions: [
        { compactionId: 'c-1', status: 'completed', error: null },
        { compactionId: 'c-2', status: 'error', error: 'compaction failed' },
      ],
    })
    expect(html).toContain('Context compaction:')
    expect(html).toContain('completed')
    expect(html).toContain('compaction failed')
  })

  test('renders flat select options and marks the current value as accent', () => {
    const options: SessionConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'opus',
        options: [
          { value: 'opus', name: 'Opus' },
          { value: 'haiku', name: 'Haiku' },
        ],
      },
    ]
    const html = render({ configOptions: options, onConfigOptionChange: () => {} })
    expect(html).toContain('Session options')
    expect(html).toContain('Model')
    expect(html).toContain('Opus')
    expect(html).toContain('Haiku')
    expect(html).toContain('aria-pressed="true">Opus')
  })

  test('renders grouped select options', () => {
    const options: SessionConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'sonnet',
        options: [
          { group: 'anthropic', name: 'Anthropic', options: [{ value: 'sonnet', name: 'Sonnet' }] },
        ],
      },
    ]
    const html = render({ configOptions: options })
    expect(html).toContain('Sonnet')
    expect(html).toContain('aria-pressed="true">Sonnet')
  })

  test('renders boolean options with an On/Off toggle', () => {
    const options: SessionConfigOption[] = [
      { id: 'thinking', name: 'Thinking', type: 'boolean', currentValue: true },
      { id: 'verbose', name: 'Verbose', type: 'boolean', currentValue: false },
    ]
    const html = render({ configOptions: options, onConfigOptionChange: () => {} })
    expect(html).toContain('Thinking')
    expect(html).toContain('aria-pressed="true">On')
    expect(html).toContain('Verbose')
    expect(html).toContain('aria-pressed="false">Off')
  })

  test('skips select options without values', () => {
    const options: SessionConfigOption[] = [
      { id: 'empty', name: 'Empty', type: 'select', currentValue: '', options: [] },
    ]
    expect(render({ configOptions: options })).not.toContain('Empty')
  })
})
