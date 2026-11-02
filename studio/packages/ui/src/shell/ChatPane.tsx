import type { ReactNode } from 'react'
import type {
  ConnectionStatus,
  ConversationMessage,
  StopReason,
  ToolCall,
} from '@openclaude-studio/acp'
import { LoadingState } from '../beautifui/index.js'
import { cn } from '../lib/cn.js'
import { MessageList } from './MessageList.js'

export type ChatPaneProps = {
  messages: ConversationMessage[]
  toolCalls: Record<string, ToolCall>
  streaming: boolean
  /** waiting for the first agent chunk after a prompt was sent */
  awaiting?: boolean
  status: ConnectionStatus
  stopReason: StopReason | null
  /** composer pinned to the bottom */
  children?: ReactNode
}

const STOP_LABELS: Record<StopReason, string> = {
  end_turn: 'Finished',
  max_tokens: 'Hit token limit',
  max_turn_requests: 'Hit turn limit',
  refusal: 'Refused',
  cancelled: 'Cancelled',
}

export function ChatPane({
  messages,
  toolCalls,
  streaming,
  awaiting,
  status,
  stopReason,
  children,
}: ChatPaneProps) {
  const stopLabel = stopReason ? (STOP_LABELS[stopReason] ?? stopReason) : null
  const offline = status !== 'ready'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {offline ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-orange-tint px-4 py-1.5 text-[12px] text-ink-2"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-orange" />
          {status === 'connecting' ? 'Connecting to agent…' : status}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <MessageList messages={messages} toolCalls={toolCalls} streaming={streaming} />
        {awaiting ? (
          <div className="mx-auto w-full max-w-3xl px-3 pb-2 pt-1 sm:px-6">
            <div className="flex items-center gap-2">
              <LoadingState variant="Dots" labels={{ label: 'OpenClaude is thinking' }} />
              <span className="text-[12px] text-ink-3">OpenClaude is thinking…</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0">
        {stopLabel && !streaming ? (
          <p className="mx-auto w-full max-w-3xl px-3 text-[11.5px] text-ink-3 sm:px-6">
            Stopped: {stopLabel}
          </p>
        ) : null}
        <div className={cn('mx-auto w-full max-w-3xl px-3 pb-3 pt-1 sm:px-6')}>{children}</div>
      </div>
    </div>
  )
}
