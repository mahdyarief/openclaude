import type { ReactNode } from 'react'
import type {
  AgentQuestion,
  ConnectionStatus,
  ConversationMessage,
  StopReason,
  ToolCall,
} from '@openclaude-studio/acp'
import { LoadingState, QuestionPanel } from '../beautifui/index.js'
import { cn } from '../lib/cn.js'
import { Button } from '../shadcn/button.js'
import { Skeleton } from '../shadcn/skeleton.js'
import { MessageList } from './MessageList.js'

export type ChatPaneProps = {
  messages: ConversationMessage[]
  toolCalls: Record<string, ToolCall>
  streaming: boolean
  /** waiting for the first agent chunk after a prompt was sent */
  awaiting?: boolean
  /** reading the stored transcript back from the bridge on a session/load */
  loadingHistory?: boolean
  status: ConnectionStatus
  stopReason: StopReason | null
  /** pending interactive questions from the agent (`AskUserQuestion`) */
  questions?: AgentQuestion[] | null
  /** answers the user collected from the questions */
  onAnswer?: (answers: Record<string, string>) => void
  /** dismiss the pending questions without answering */
  onDismissQuestions?: () => void
  /** re-handshake from scratch (new WebSocket + session handshake/load) */
  onReload?: () => void
  /** end the live connection; the transcript stays visible */
  onEnd?: () => void
  /** true while a reload is re-establishing the handshake */
  reloading?: boolean
  /** true after the user ended the session */
  ended?: boolean
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

// One line of status text per connection state, so the pane is never ambiguous:
// ready/connecting are normal, idle is "asleep" (reloaded on focus), dead is
// unrecoverable. The composer stays usable in `idle` because the next prompt
// reattaches automatically.
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  ready: 'Connected',
  connecting: 'Connecting to agent…',
  idle: 'Asleep — connection paused to save resources',
  dead: 'Disconnected',
}

const STATUS_TONE: Record<ConnectionStatus, { dot: string; tint: string }> = {
  ready: { dot: 'bg-green', tint: 'bg-green-tint' },
  connecting: { dot: 'animate-pulse bg-orange', tint: 'bg-orange-tint' },
  idle: { dot: 'bg-ink-3', tint: 'bg-inset' },
  dead: { dot: 'bg-red', tint: 'bg-red-tint' },
}

export function ChatPane({
  messages,
  toolCalls,
  streaming,
  awaiting,
  loadingHistory,
  status,
  stopReason,
  questions,
  onAnswer,
  onDismissQuestions,
  onReload,
  onEnd,
  reloading,
  ended,
  children,
}: ChatPaneProps) {
  const stopLabel = stopReason ? (STOP_LABELS[stopReason] ?? stopReason) : null
  const tone = STATUS_TONE[status]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="status"
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-line px-4 py-1.5 text-[12px] text-ink-2',
          tone.tint,
        )}
      >
        <span aria-hidden className={cn('size-1.5 rounded-full', tone.dot)} />
        <span className="truncate">{STATUS_LABELS[status]}</span>
        {status === 'idle' ? (
          <Button
            variant="quiet"
            size="sm"
            onClick={onReload}
            disabled={reloading}
            className="ml-auto h-5 rounded-[var(--radius-control)] px-1.5 text-[11px]"
          >
            {reloading ? 'Waking…' : 'Wake'}
          </Button>
        ) : null}
        {status === 'dead' ? (
          <Button
            variant="quiet"
            size="sm"
            onClick={onReload}
            disabled={reloading}
            className="ml-auto h-5 rounded-[var(--radius-control)] px-1.5 text-[11px]"
          >
            {reloading ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        ) : null}
        {!ended && (status === 'ready' || status === 'idle') ? (
          <Button
            variant="quiet"
            size="sm"
            onClick={onEnd}
            className="ml-2 h-5 rounded-[var(--radius-control)] px-1.5 text-[11px]"
          >
            End session
          </Button>
        ) : null}
        {ended && status === 'idle' ? (
          <span className="ml-2 text-[11px] text-ink-3">Ended</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 relative">
        {loadingHistory ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-5 sm:px-6 sm:py-6">
            <div className="flex items-center gap-2 pb-2">
              <LoadingState variant="Dots" labels={{ label: 'Loading conversation' }} />
              <span className="text-[12px] text-ink-3">Loading conversation…</span>
            </div>
            {[0, 1, 2].map(index => (
              <div key={index} className="flex flex-col gap-2">
                <div className="openclaude-prose">
                  <Skeleton className="h-4 w-[70%]" />
                  <Skeleton className="mt-2 h-4 w-[90%]" />
                  <Skeleton className="mt-2 h-4 w-[55%]" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <MessageList messages={messages} toolCalls={toolCalls} streaming={streaming} />
        )}
        {awaiting ? (
          <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none pb-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2 shadow-[var(--shadow-card)]">
              <LoadingState variant="Dots" labels={{ label: 'OpenClaude is thinking' }} />
              <span className="text-[12px] text-ink-3">OpenClaude is thinking…</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0">
        {stopLabel && !streaming && !awaiting ? (
          <p className="mx-auto w-full max-w-3xl px-3 text-[11.5px] text-ink-3 sm:px-6">
            Stopped: {stopLabel}
          </p>
        ) : null}
        {questions && questions.length > 0 ? (
          <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6">
            <QuestionPanel
              questions={questions}
              onSubmit={answers => onAnswer?.(answers)}
              onCancel={onDismissQuestions}
            />
          </div>
        ) : null}
        <div className={cn('mx-auto w-full max-w-3xl px-3 pb-3 pt-1 sm:px-6')}>{children}</div>
      </div>
    </div>
  )
}
