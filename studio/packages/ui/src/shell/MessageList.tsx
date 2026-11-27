import { useEffect, useRef } from 'react'
import type { ConversationMessage, ToolCall } from '@openclaude-studio/acp'
import { MessageBubble } from './MessageBubble.js'
import { ScrollArea } from '../shadcn/scroll-area.js'

export type MessageListProps = {
  messages: ConversationMessage[]
  toolCalls: Record<string, ToolCall>
  streaming: boolean
  /** shown when the transcript is empty */
  emptyTitle?: string
  emptyHint?: string
}

export function MessageList({
  messages,
  toolCalls,
  streaming,
  emptyTitle = 'Start the conversation',
  emptyHint = 'Send a prompt below and the agent will pick it up.',
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming])

  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent') ?? null

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-[15px] font-medium text-ink">{emptyTitle}</p>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-3">{emptyHint}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-5 sm:px-6 sm:py-6">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            toolCalls={toolCalls}
            streaming={streaming}
            lastAgentMessageId={lastAgent ? lastAgent.id : null}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
