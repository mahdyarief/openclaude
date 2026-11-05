import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMessage, ToolCall } from '@openclaude-studio/acp'
import { MessageBubble } from './MessageBubble.js'

function agentMessage(toolCallId: string): ConversationMessage {
  return {
    id: 'm1',
    role: 'agent',
    parts: [{ kind: 'tool', toolCallId }],
  }
}

const editCall: ToolCall = {
  toolCallId: 't1',
  title: 'Edit file',
  kind: 'edit',
  status: 'completed',
  locations: [{ path: '/work/a.ts' }],
  rawInput: { file_path: '/work/a.ts' },
  content: [
    { type: 'diff', path: '/work/a.ts', oldText: 'const a = 1', newText: 'const a = 2' },
    { type: 'content', content: { type: 'text', text: 'File updated' } },
  ],
}

const shellCall: ToolCall = {
  toolCallId: 's1',
  title: 'Bash',
  kind: 'execute',
  status: 'completed',
  content: [{ type: 'terminal', terminalId: 's1' }],
}

function render(message: ConversationMessage, toolCalls: Record<string, ToolCall>) {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      toolCalls={toolCalls}
      streaming={false}
      lastAgentMessageId={null}
    />,
  )
}

describe('MessageBubble tool chips', () => {
  test('renders an edit diff before/after with token tints', () => {
    const html = render(agentMessage('t1'), { t1: editCall })

    expect(html).toContain('diff /work/a.ts')
    expect(html).toContain('- const a = 1')
    expect(html).toContain('+ const a = 2')
    expect(html).toContain('bg-red-tint text-red')
    expect(html).toContain('bg-green-tint text-green')
  })

  test('renders a terminal block label', () => {
    const html = render(agentMessage('s1'), { s1: shellCall })
    expect(html).toContain('terminal s1')
  })

  test('uses shadcn collapsible instead of hand-rolled details and literal widths', () => {
    const html = render(agentMessage('t1'), { t1: editCall })

    expect(html).not.toContain('<details')
    expect(html).not.toContain('<summary')
    expect(html).not.toContain('max-w-[480px]')
    expect(html).not.toContain('animation:')
    expect(html).toContain('data-slot="collapsible-trigger"')
  })

  test('keeps the streaming caret on the token utility', () => {
    const withText: ConversationMessage = {
      id: 'm2',
      role: 'agent',
      parts: [{ kind: 'text', text: 'hello' }],
    }
    const html = renderToStaticMarkup(
      <MessageBubble
        message={withText}
        toolCalls={{}}
        streaming
        lastAgentMessageId="m2"
      />,
    )
    expect(html).toContain('stream-caret')
    expect(html).not.toContain('animation:')
  })
})
