import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type {
  ConversationMessage,
  ToolCall,
  ToolCallContent,
} from '@openclaude-studio/acp'
import ThinkingState from '../beautifui/ThinkingState.js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/cn.js'
import { Badge } from '../shadcn/badge.js'
import { Button } from '../shadcn/button.js'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible.js'
import { CommandChip, isCommandText, parseCommandInvocation } from './CommandChip.js'

export type MessageBubbleProps = {
  message: ConversationMessage
  toolCalls: Record<string, ToolCall>
  /** whether the session is currently streaming */
  streaming: boolean
  /** id of the last agent message, or null; enables the live caret */
  lastAgentMessageId: string | null
}

type DiffBlock = Extract<ToolCallContent, { type: 'diff' }>
type TerminalBlock = Extract<ToolCallContent, { type: 'terminal' }>

function ToolDetail({
  label,
  defaultOpen = false,
  children,
}: {
  label: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="group h-auto w-full justify-start gap-1 px-0 py-0 text-left font-sans text-[10.5px] font-normal text-ink-3 hover:text-ink"
        >
          <ChevronDown
            size={11}
            aria-hidden
            className="shrink-0 transition-transform duration-200 group-data-[state=closed]:-rotate-90"
          />
          <span className="truncate">{label}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="w-full">
        <div className="mt-1 w-full overflow-x-auto rounded-[var(--radius-control)] bg-inset px-2 py-1 text-[11px] leading-[1.4] text-ink-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DiffLines({ diff }: { diff: DiffBlock }) {
  const removed = diff.oldText == null ? [] : diff.oldText.split('\n')
  const added = diff.newText.split('\n')
  return (
    <pre className="flex flex-col gap-0.5 whitespace-pre-wrap break-words font-mono">
      {removed.map((line, i) => (
        <span key={`del-${i}`} className="block bg-red-tint text-red">
          - {line}
        </span>
      ))}
      {added.map((line, i) => (
        <span key={`add-${i}`} className="block bg-green-tint text-green">
          + {line}
        </span>
      ))}
    </pre>
  )
}

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

    // Slash invocations are stored as `<command-name>` XML by the CLI. Render
    // them as a chip plus the arguments instead of raw markup.
    const invocation = parseCommandInvocation(text)

    return (
      <div data-role="user" className="flex w-full animate-fade-up justify-end pl-10 sm:pl-20">
        <div className="min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius-window)] bg-field px-3.5 py-2 text-[13px] leading-[1.45] text-ink [overflow-wrap:anywhere]">
          {invocation ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <CommandChip name={invocation.name} />
              {invocation.args ? <span>{invocation.args}</span> : null}
            </span>
          ) : (
            text
          )}
        </div>
      </div>
    )
  }

  // Agent turns read as a document section: a small label line, then content.
  return (
    <article data-role="agent" className="flex min-w-0 w-full animate-fade-up flex-col gap-2">
      <header className="flex items-center gap-1.5 text-[12px] leading-[1.3]">
        <span className="font-medium text-ink">OpenClaude</span>
        {showCaret ? <span className="text-ink-3">responding…</span> : null}
      </header>

      {(() => {
        // Consecutive tool calls read as one horizontal run of chips: they sit
        // side by side while they fit and only wrap to the next line when the
        // row runs out of width. Any text/thought part closes the run.
        const rendered: ReactNode[] = []
        let chipRun: ReactNode[] = []

        const flushChips = () => {
          if (chipRun.length === 0) return
          rendered.push(
            <div key={`chips-${rendered.length}`} className="flex flex-wrap items-center gap-1.5">
              {chipRun}
            </div>,
          )
          chipRun = []
        }

        message.parts.forEach((part, index) => {
          if (part.kind === 'text') {
            flushChips()
            // Agent answers are Markdown (headings, lists, code fences, links).
            // `.openclaude-prose` styles them from design tokens, matching the
            // document viewer so chat and file previews read the same.
            rendered.push(
              <div
                key={index}
                className="openclaude-prose min-w-0 break-words text-[13.5px] leading-[1.55] text-ink"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // The agent often names a command as inline code, e.g.
                    // `` `/commit` ``. Render that token as a chip so it reads
                    // like the terminal rather than a stray code span.
                    code({ children, className, ...props }) {
                      const text = String(children)
                      if (!className && isCommandText(text)) {
                        return <CommandChip name={text.trim()} />
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
                    },
                  }}
                >
                  {part.text}
                </ReactMarkdown>
                {showCaret && index === message.parts.length - 1 ? (
                  <span aria-hidden className="stream-caret" />
                ) : null}
              </div>,
            )
            return
          }

          if (part.kind === 'thought') {
            flushChips()
            const rows = part.text
              .split('\n')
              .filter(Boolean)
              .map(line => ({ primary: line }))
            rendered.push(<ThinkingState key={index} variant="Steps" rows={rows} />)
            return
          }

          const tc = part.toolCallId ? toolCalls[part.toolCallId] : undefined
          const title = tc?.title ?? part.toolCallId
          const status = tc?.status ?? (part.toolCallId ? 'pending' : undefined)
          const argsJson =
            tc?.rawInput && Object.keys(tc.rawInput as object).length > 0
              ? JSON.stringify(tc.rawInput, null, 2)
              : null
          const resultLines =
            tc?.content
              ?.map((c) => {
                if (c.type !== 'content' || !c.content || c.content.type !== 'text') return null
                return c.content.text as string
              })
              .filter((v): v is string => !!v) ?? []
          const diffBlocks: DiffBlock[] = (tc?.content ?? []).filter(
            (c): c is DiffBlock => c.type === 'diff',
          )
          const terminalBlocks: TerminalBlock[] = (tc?.content ?? []).filter(
            (c): c is TerminalBlock => c.type === 'terminal',
          )

          chipRun.push(
            <span
              key={index}
              className={cn(
                'inline-flex w-fit max-w-full flex-col gap-1.5 items-start rounded-[var(--radius-chip)]',
                'bg-field px-2 py-1 font-mono text-[11.5px] text-ink-2',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-orange" />
                <span className="truncate">{title}</span>
                {status ? (
                  <Badge variant={status === 'failed' ? 'danger' : status === 'completed' ? 'success' : status === 'in_progress' ? 'warning' : 'default'}>
                    {status.replace('_', ' ')}
                  </Badge>
                ) : null}
              </span>
              {diffBlocks.map((diff, i) => (
                <ToolDetail key={`diff-${i}`} label={`diff ${diff.path}`} defaultOpen>
                  <DiffLines diff={diff} />
                </ToolDetail>
              ))}
              {terminalBlocks.map((terminal, i) => (
                <ToolDetail key={`terminal-${i}`} label={`terminal ${terminal.terminalId}`}>
                  <span>terminal {terminal.terminalId}</span>
                </ToolDetail>
              ))}
              {argsJson ? (
                <ToolDetail label="args">
                  <pre className="whitespace-pre-wrap">{argsJson}</pre>
                </ToolDetail>
              ) : null}
              {resultLines.length > 0 ? (
                <ToolDetail label="result">
                  <pre className="whitespace-pre-wrap">{resultLines.join('\n')}</pre>
                </ToolDetail>
              ) : null}
            </span>,
          )
        })

        flushChips()
        return rendered
      })()}
    </article>
  )
}
