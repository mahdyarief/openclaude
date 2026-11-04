import type { AgentStatusSnapshot } from '@openclaude-studio/acp'
import { Separator } from '../shadcn/separator.js'
import { Badge } from '../shadcn/badge.js'
import { cn } from '../lib/cn.js'

/** One badge per live statusline field. The strip mirrors what the terminal
 * statusline renders (model, branch, effort, context, background tasks, custom
 * plugin content) so the web composer is never blind to the agent's live state.
 * It sits directly below the prompt bar, mirroring the terminal's bottom row. */
export type SessionStatusBarProps = {
  /** Live statusline snapshot; `null` while no session exists yet. */
  status: AgentStatusSnapshot | null
  className?: string
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}

function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00'
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}

function contextVariant(pct: number): 'default' | 'warning' | 'danger' {
  if (pct >= 85) return 'danger'
  if (pct >= 60) return 'warning'
  return 'default'
}

export function SessionStatusBar({ status, className }: SessionStatusBarProps) {
  if (!status) {
    return (
      <div
        className={cn(
          'flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-canvas px-2 py-1 text-[11px] text-ink-3',
          className,
        )}
      >
        No active session
      </div>
    )
  }

  const branch = status.worktree?.branch ?? status.branch
  const context = status.contextWindow
  const tasks = status.backgroundTasks

  return (
    <div
      className={cn(
        'flex min-h-7 flex-col border-t border-line bg-canvas px-2 py-1 text-[11px] text-ink-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline">{status.model.displayName}</Badge>
        {branch && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <Badge variant="default">{branch}</Badge>
          </>
        )}
        {status.effort && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <Badge variant="default">effort {status.effort}</Badge>
          </>
        )}
        {context && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <Badge variant={contextVariant(context.usedPercent)}>
              ctx {context.usedPercent}%
            </Badge>
          </>
        )}
        <Separator orientation="vertical" className="h-3" />
        <Badge variant="outline">{formatCost(status.session.costUsd)}</Badge>
        <Badge variant="outline">{formatDuration(status.session.durationMs)}</Badge>
        {tasks.total > 0 && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <Badge variant={tasks.running > 0 ? 'warning' : 'default'}>
              running {tasks.running}/{tasks.total}
            </Badge>
          </>
        )}
      </div>
      {status.statusLineText && (
        <div className="truncate text-ink-3" title={status.statusLineText}>
          {status.statusLineText}
        </div>
      )}
    </div>
  )
}