import type { ReactNode } from 'react'
import type {
  AgentStatusSnapshot,
  PermissionMode,
  SessionSummary,
  ToolCallContent,
  UsageUpdate,
} from '@openclaude-studio/acp'
import { Badge } from '../shadcn/badge.js'
import { Button } from '../shadcn/button.js'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../shadcn/card.js'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../shadcn/dialog.js'
import { ScrollArea } from '../shadcn/scroll-area.js'
import { DiffLines } from './MessageBubble.js'

export type ConfigCommandName = 'config' | 'provider' | 'model' | 'theme'

/** A `diff` content part, as ACP reports it inside a tool call. */
export type DiffPart = Extract<ToolCallContent, { type: 'diff' }>

export type SlashCommandPanelKind =
  | ConfigCommandName
  | 'permissions'
  | 'mcp'
  | 'status'
  | 'diff'
  | 'tasks'
  | 'usage'
  | 'resume'
  | 'sessions'

/** Panels rendered here; the four config commands use `ConfigDialog` instead. */
export type StudioPanelKind = Exclude<SlashCommandPanelKind, ConfigCommandName>

export type SlashCommandPanelData = {
  permissionMode: PermissionMode
  modes: { id: PermissionMode; label: string }[]
  onModeChange: (id: PermissionMode) => void
  status: AgentStatusSnapshot | null
  usage: UsageUpdate | null
  diffs: DiffPart[]
  sessions: SessionSummary[]
  sessionsLoading: boolean
  sessionsError: string | null
  onOpenSession: (id: string) => void
}

/** Panel headings, also used as the dialog's accessible name. */
export const SLASH_COMMAND_TITLES: Record<StudioPanelKind, string> = {
  permissions: 'Permissions',
  mcp: 'MCP servers',
  status: 'Session status',
  diff: 'Diff',
  tasks: 'Background tasks',
  usage: 'Usage',
  resume: 'Resume session',
  sessions: 'Sessions',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="text-right text-[13px] text-ink">{children}</span>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[13px] text-ink-3">{children}</p>
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US')
}

function PermissionsPanel({ data }: { data: SlashCommandPanelData }) {
  const active = data.status?.permissionMode ?? data.permissionMode
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-[13px] text-ink-2">
        How much the agent may act without asking. The choice is stored on the
        bridge, so every connected device agrees.
      </p>
      {data.modes.map(mode => (
        <Button
          key={mode.id}
          variant={mode.id === active ? 'accent' : 'outline'}
          size="sm"
          className="justify-start"
          aria-pressed={mode.id === active}
          onClick={() => data.onModeChange(mode.id)}
        >
          {mode.label}
        </Button>
      ))}
    </div>
  )
}

function StatusPanel({ data }: { data: SlashCommandPanelData }) {
  const status = data.status
  if (!status) return <Empty>The agent has not reported a status snapshot yet.</Empty>
  return (
    <div className="flex flex-col">
      <Row label="Model">{status.model.displayName || status.model.id}</Row>
      <Row label="Branch">{status.branch ?? '—'}</Row>
      {status.worktree ? (
        <Row label="Worktree">
          {status.worktree.name ?? status.worktree.path ?? '—'}
        </Row>
      ) : null}
      <Row label="Permission mode">{status.permissionMode}</Row>
      <Row label="Effort">{status.effort ?? 'default'}</Row>
      <Row label="Context">
        {status.contextWindow
          ? `${status.contextWindow.usedPercent}% of ${formatTokens(status.contextWindow.size)} tokens`
          : '—'}
      </Row>
      <Row label="Session">{status.session.name ?? 'unnamed'}</Row>
      <Row label="Cost">${status.session.costUsd.toFixed(4)}</Row>
      <Row label="Elapsed">{formatDuration(status.session.durationMs)}</Row>
      <Row label="Background tasks">
        {status.backgroundTasks.total === 0
          ? 'none'
          : `${status.backgroundTasks.running} running of ${status.backgroundTasks.total}`}
      </Row>
      {status.statusLineText ? (
        <p className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-ink-3">
          {status.statusLineText}
        </p>
      ) : null}
    </div>
  )
}

function DiffPanel({ data }: { data: SlashCommandPanelData }) {
  if (data.diffs.length === 0) {
    return <Empty>No file changes have been reported in this session yet.</Empty>
  }
  return (
    <div className="flex flex-col gap-3">
      {data.diffs.map((diff, index) => (
        <div key={`${diff.path}-${index}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <code className="truncate text-[12px] text-ink-2">{diff.path}</code>
            <Badge variant="outline">diff</Badge>
          </div>
          <div className="rounded-[var(--radius-control)] bg-inset px-2 py-1.5">
            <DiffLines diff={diff} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TasksPanel({ data }: { data: SlashCommandPanelData }) {
  const tasks = data.status?.backgroundTasks
  if (!tasks || tasks.total === 0) {
    return <Empty>No background tasks are running.</Empty>
  }
  return (
    <div className="flex flex-col">
      <Row label="Total">{tasks.total}</Row>
      <Row label="Running">{tasks.running}</Row>
      {tasks.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tasks.labels.map((label, index) => (
            <Badge key={`${label}-${index}`} variant={index < tasks.running ? 'accent' : 'outline'}>
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function UsagePanel({ data }: { data: SlashCommandPanelData }) {
  const usage = data.usage
  const status = data.status
  return (
    <div className="flex flex-col">
      <Row label="Tokens in context">
        {usage ? `${formatTokens(usage.used)} / ${formatTokens(usage.size)}` : '—'}
      </Row>
      <Row label="Context used">
        {status?.contextWindow ? `${status.contextWindow.usedPercent}%` : usage && usage.size > 0
          ? `${Math.round((usage.used / usage.size) * 100)}%`
          : '—'}
      </Row>
      <Row label="Session cost">
        {status ? `$${status.session.costUsd.toFixed(4)}` : '—'}
      </Row>
      <Row label="Elapsed">
        {status ? formatDuration(status.session.durationMs) : '—'}
      </Row>
    </div>
  )
}

function SessionsPanel({
  data,
  resumeOnly,
}: {
  data: SlashCommandPanelData
  resumeOnly: boolean
}) {
  if (data.sessionsError) {
    return (
      <p role="alert" className="py-2 text-[13px] text-red">
        {data.sessionsError}
      </p>
    )
  }
  if (data.sessionsLoading) {
    return <Empty>Loading sessions…</Empty>
  }
  if (data.sessions.length === 0) {
    return <Empty>No saved sessions for this workspace.</Empty>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {data.sessions.map(session => (
        <Button
          key={session.id}
          variant="outline"
          size="sm"
          className="h-auto min-h-8 justify-start py-1.5"
          onClick={() => data.onOpenSession(session.id)}
        >
          <span className="flex min-w-0 flex-col items-start text-left">
            <span className="w-full truncate text-[13px]">
              {session.title || session.id}
            </span>
            <span className="text-[11px] font-normal text-ink-3">
              {session.messageCount} messages ·{' '}
              {new Date(session.updatedAt).toLocaleDateString('en-US')}
              {resumeOnly ? ' · resume' : ''}
            </span>
          </span>
        </Button>
      ))}
    </div>
  )
}

/** The panel's content, split out so it can be rendered without the dialog. */
export function SlashCommandPanelBody({
  panel,
  data,
}: {
  panel: StudioPanelKind
  data: SlashCommandPanelData
}) {
  switch (panel) {
    case 'permissions':
      return <PermissionsPanel data={data} />
    case 'mcp':
      return (
        <Empty>
          MCP server status is not available in Studio yet. Manage servers from
          the OpenClaude CLI; this command cannot render the terminal-only MCP
          picker in the browser.
        </Empty>
      )
    case 'status':
      return <StatusPanel data={data} />
    case 'diff':
      return <DiffPanel data={data} />
    case 'tasks':
      return <TasksPanel data={data} />
    case 'usage':
      return <UsagePanel data={data} />
    case 'resume':
    case 'sessions':
      return <SessionsPanel data={data} resumeOnly={panel === 'resume'} />
  }
}

export function SlashCommandPanel({
  open,
  panel,
  data,
  onOpenChange,
}: {
  open: boolean
  panel: StudioPanelKind
  data: SlashCommandPanelData
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label={SLASH_COMMAND_TITLES[panel]}>
        <DialogHeader className="border-b border-line px-4 py-3 pr-10">
          <DialogTitle>{SLASH_COMMAND_TITLES[panel]}</DialogTitle>
          <DialogDescription>
            Studio renders this command locally; the terminal Ink UI cannot run
            over ACP.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Card className="m-4 border-0 shadow-none">
            <CardHeader className="sr-only">
              <CardTitle>{SLASH_COMMAND_TITLES[panel]}</CardTitle>
              <CardDescription>{SLASH_COMMAND_TITLES[panel]} details</CardDescription>
            </CardHeader>
            <CardContent>
              <SlashCommandPanelBody panel={panel} data={data} />
            </CardContent>
          </Card>
        </ScrollArea>
        <DialogFooter className="border-t border-line px-4 py-3">
          <DialogClose asChild>
            <Button size="sm" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Explicit feedback when a typed command cannot be fulfilled. */
export function SlashCommandNotice({
  title,
  description,
  onDismiss,
}: {
  title: string
  description: string
  onDismiss: () => void
}) {
  return (
    <Card className="m-3">
      <CardHeader>
        <CardTitle role="status">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  )
}
