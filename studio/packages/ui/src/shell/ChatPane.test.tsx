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

describe('ChatPane session title', () => {
  test('shows the agent-supplied session title in the status header', () => {
    expect(render('Refactor the reducer')).toContain('Session: Refactor the reducer')
  })

  test('omits the title line when no title has been reported', () => {
    expect(render(null)).not.toContain('Session:')
    expect(render()).not.toContain('Session:')
  })
})
