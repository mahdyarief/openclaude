import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatPane } from './ChatPane.js'

function render(sessionTitle?: string | null): string {
  return renderToStaticMarkup(
    <ChatPane
      messages={[]}
      toolCalls={{}}
      streaming={false}
      status="ready"
      stopReason={null}
      sessionTitle={sessionTitle}
    />,
  )
}

function renderActions(props: {
  onFork?: () => void
  onDelete?: () => void
  actionError?: string
  status?: 'ready' | 'connecting' | 'idle' | 'dead'
}): string {
  return renderToStaticMarkup(
    <ChatPane
      messages={[]}
      toolCalls={{}}
      streaming={false}
      status={props.status ?? 'ready'}
      stopReason={null}
      onFork={props.onFork}
      onDelete={props.onDelete}
      actionError={props.actionError}
    />,
  )
}

describe('ChatPane session actions', () => {
  test('shows fork and delete once the session is live', () => {
    const html = renderActions({ onFork: () => {}, onDelete: () => {} })
    expect(html).toContain('>Fork<')
    expect(html).toContain('>Delete<')
    expect(html).not.toContain('Delete session')
  })

  test('hides the actions when the pane has no saved session', () => {
    const html = renderActions({})
    expect(html).not.toContain('>Fork<')
    expect(html).not.toContain('>Delete<')
  })

  test('hides the actions while connecting', () => {
    const html = renderActions({ onFork: () => {}, onDelete: () => {}, status: 'connecting' })
    expect(html).not.toContain('>Fork<')
  })

  test('surfaces a fork or delete failure as an alert', () => {
    const html = renderActions({ onFork: () => {}, actionError: 'fork failed' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('fork failed')
  })
})

describe('ChatPane session title', () => {
  test('shows the agent-supplied session title in the status header', () => {
    expect(render('Refactor the reducer')).toContain('Session: Refactor the reducer')
  })

  test('omits the title line when no title has been reported', () => {
    expect(render(null)).not.toContain('Session:')
    expect(render()).not.toContain('Session:')
  })
})
