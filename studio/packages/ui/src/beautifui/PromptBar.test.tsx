import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptBar, { type PromptBarProps } from './PromptBar.js'

function render(props: Partial<PromptBarProps> = {}): string {
  return renderToStaticMarkup(
    <PromptBar
      value=""
      onChange={() => {}}
      onSend={() => {}}
      {...props}
    />,
  )
}

describe('PromptBar mentions', () => {
  const mentions = [
    { path: 'src/a.ts' },
    { path: 'src/nested/b.ts' },
    { path: 'README.md' },
  ]

  test('opens the file menu on a trailing @ token and filters by path', () => {
    const html = render({ value: 'look at @src/a', mentions })

    expect(html).toContain('aria-label="Files"')
    expect(html).toContain('src/a.ts')
    expect(html).not.toContain('README.md')
  })

  test('keeps the menu closed when no mention is being typed', () => {
    const html = render({ value: 'look at src/a', mentions })

    expect(html).not.toContain('aria-label="Files"')
  })

  test('offers no file menu without mention options', () => {
    const html = render({ value: 'look at @' })

    expect(html).not.toContain('aria-label="Files"')
  })

  test('yields to the slash menu when both could match', () => {
    const html = render({
      value: '/he',
      mentions,
      commands: [{ name: 'help', description: 'Show help' }],
    })

    expect(html).toContain('aria-label="Slash commands"')
    expect(html).not.toContain('aria-label="Files"')
  })
})
