import type { ConversationMessage, ToolCall } from '@openclaude-studio/acp'
import ThinkingState from '../beautifui/ThinkingState.js'
import ReactMarkdown from 'react-markdown'
import { cn } from '../lib/cn.js'

export type MessageBubbleProps = {
  message: ConversationMessage
  toolCalls: Record<string, ToolCall>
  /** whether the session is currently streaming */
  streaming: boolean
  /** id of the last agent message, or null; enables the live caret */
  lastAgentMessageId: string | null
}

const ENTRY = { animation: 'fade-up 260ms cubic-bezier(0.23,1,0.32,1) both' } as const

export function MessageBubble({
  message,
  toolCalls,
  streaming,
  lastAgentMessageId,
}: MessageBubbleProps) {
  const isAgent = message.role === 'agent'
  const isLastAgent = isAgent && message.id === lastAgentMessageId
  const showCaret = isLastAgent && streaming

  // User turns are a quiet right-aligned block — no border, no card chrome.
  if (!isAgent) {
    const text = message.parts
      .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
      .map(part => part.text)
      .join('\n')

    return (
      <div data-role="user" className="flex w-full justify-end pl-10 sm:pl-20" style={ENTRY}>
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-window)] bg-field px-3.5 py-2 text-[13px] leading-[1.45] text-ink">
          {text}
        </div>
      </div>
    )
  }

  // Agent turns read as a document section: a small label line, then content.
  return (
    <article data-role="agent" className="flex w-full flex-col gap-2" style={ENTRY}>
      <header className="flex items-center gap-1.5 text-[12px] leading-[1.3]">
        <span className="font-medium text-ink">OpenClaude</span>
        {showCaret ? <span className="text-ink-3">responding…</span> : null}
      </header>

      {message.parts.map((part, index) => {
        if (part.kind === 'text') {
          // Agent answers are Markdown (headings, lists, code fences, links).
          // `.openclaude-prose` styles them from design tokens, matching the
          // document viewer so chat and file previews read the same.
          return (
            <div
              key={index}
              className="openclaude-prose text-[13.5px] leading-[1.55] text-ink"
            >
              <ReactMarkdown>{part.text}</ReactMarkdown>
              {showCaret && index === message.parts.length - 1 ? (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ink"
                  style={{ animation: 'caret-blink 1s steps(2, start) infinite' }}
                />
              ) : null}
            </div>
          )
        }

        if (part.kind === 'thought') {
          const rows = part.text
            .split('\n')
            .filter(Boolean)
            .map(line => ({ primary: line }))
          return <ThinkingState key={index} variant="Steps" rows={rows} />
        }

        const title = (part.toolCallId && toolCalls[part.toolCallId]?.title) ?? part.toolCallId
        return (
          <span
            key={index}
            className={cn(
              'inline-flex w-fit max-w-full items-center gap-1.5 rounded-[var(--radius-chip)]',
              'bg-field px-2 py-1 font-mono text-[11.5px] text-ink-2',
            )}
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-orange" />
            <span className="truncate">{title}</span>
          </span>
        )
      })}
    </article>
  )
}
