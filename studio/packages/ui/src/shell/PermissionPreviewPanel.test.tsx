import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PermissionPreview } from '@openclaude-studio/acp'
import { PermissionPreviewPanel } from './PermissionPreviewPanel.js'

function render(preview: PermissionPreview): string {
  return renderToStaticMarkup(<PermissionPreviewPanel preview={preview} />)
}

describe('PermissionPreviewPanel', () => {
  test('shows an edit diff with the changed lines', () => {
    const html = render({
      title: 'Edit file',
      summary: '/work/a.ts',
      fields: [{ label: 'File', value: '/work/a.ts' }],
      diff: {
        path: '/work/a.ts',
        oldText: 'const a = 1',
        newText: 'const a = 2',
      },
      plan: null,
    })
    expect(html).toContain('Edit file')
    expect(html).toContain('/work/a.ts')
    expect(html).toContain('bg-red-tint')
    expect(html).toContain('bg-green-tint')
    expect(html).toContain('const a = 1')
    expect(html).toContain('const a = 2')
  })

  test('renders a plan without a diff', () => {
    const html = render({
      title: 'Approve plan',
      summary: null,
      fields: [],
      diff: null,
      plan: '1. Read the file\n2. Patch it',
    })
    expect(html).toContain('Approve plan')
    expect(html).toContain('1. Read the file')
    expect(html).not.toContain('bg-red-tint')
  })

  test('lists dialog-specific fields for a command', () => {
    const html = render({
      title: 'Run command',
      summary: 'pnpm test',
      fields: [{ label: 'Description', value: 'run the suite' }],
      diff: null,
      plan: null,
    })
    expect(html).toContain('Run command')
    expect(html).toContain('pnpm test')
    expect(html).toContain('Description')
    expect(html).toContain('run the suite')
  })
})
