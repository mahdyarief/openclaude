import { useState } from 'react'
import {
  ChevronDown,
  Circle,
  FolderPlus,
  FolderTree,
  History,
  MoreHorizontal,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../shadcn/button.js'
import { Input } from '../shadcn/input.js'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible.js'
import { ScrollArea } from '../shadcn/scroll-area.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../shadcn/dropdown-menu.js'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../shadcn/dialog.js'
import { Skeleton } from '../shadcn/skeleton.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../shadcn/tooltip.js'

export type RailSession = { id: string; title: string; active: boolean }

export type RailWorkspace = {
  path: string
  name: string
  /** every session for this workspace, including ones already open */
  sessions: RailSession[]
  /** session ids currently open in tabs — rendered under "Active" */
  openIds?: string[]
  loading?: boolean
  error?: string | null
}

export type ProjectRailProps = {
  /** the user's pinned workspaces; served from the bridge so every device agrees */
  workspaces: RailWorkspace[]
  /** path of the workspace the center pane is showing */
  activePath?: string
  onAddProject?: () => void
  onSelectWorkspace: (path: string) => void
  /** open an existing session (resume from history) */
  onSelectSession: (workspacePath: string, sessionId: string) => void
  /** start a fresh session in this workspace */
  onNewSession: (workspacePath: string) => void
  onRemove?: (path: string) => void
  onRefresh?: () => void
}

function WorkspaceRows({
  workspace,
  active,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
}: {
  workspace: RailWorkspace
  active: boolean
  onSelectWorkspace: (path: string) => void
  onSelectSession: (workspacePath: string, sessionId: string) => void
  onNewSession: (workspacePath: string) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [search, setSearch] = useState('')
  const openIds = new Set(workspace.openIds ?? [])
  const activeSessions = workspace.sessions.filter(s => openIds.has(s.id))
  const history = workspace.sessions.filter(s => !openIds.has(s.id))
  const filteredHistory = history.filter(s =>
    s.title.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const selectSession = (sessionId: string) => {
    onSelectWorkspace(workspace.path)
    onSelectSession(workspace.path, sessionId)
    setHistoryOpen(false)
  }

  const sessionButton = (session: RailSession, fromHistory = false) => {
    const button = (
      <Button
        type="button"
        variant="quiet"
        size="sm"
        onClick={() => selectSession(session.id)}
        aria-current={session.active ? 'true' : undefined}
        className={cn(
          'w-full justify-start gap-2 px-2 font-normal',
          session.active ? 'bg-hover-2 font-medium text-ink' : 'text-ink-2',
        )}
      >
        {session.active ? (
          <Circle size={7} className="shrink-0 fill-accent text-accent" />
        ) : (
          <span className="size-[7px] shrink-0 rounded-full bg-line-strong" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
      </Button>
    )
    return fromHistory ? <DialogClose asChild>{button}</DialogClose> : button
  }

  return (
    <>
      {workspace.error ? (
        <li className="px-2 py-2">
          <p role="alert" className="text-[12.5px] text-red">
            {workspace.error}
          </p>
        </li>
      ) : workspace.loading ? (
        <li className="px-2 py-2">
          <div className="flex flex-col gap-1.5">
            {[72, 58, 66].map((width, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${width}%` }} />
            ))}
          </div>
        </li>
      ) : (
        <>
          {activeSessions.length > 0 ? (
            <>
              <li className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Active
              </li>
              {activeSessions.map(session => (
                <li key={session.id}>{sessionButton(session)}</li>
              ))}
            </>
          ) : (
            <li className="px-2 py-2 text-[12.5px] text-ink-3">No active sessions</li>
          )}

          {!workspace.loading && history.length > 0 ? (
            <li>
              <Dialog
                open={historyOpen}
                onOpenChange={open => {
                  setHistoryOpen(open)
                  if (!open) setSearch('')
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    className="w-full justify-start gap-2 px-2 font-normal text-ink-2"
                    aria-label={`Open session history for ${workspace.name}`}
                  >
                    <History size={13} className="shrink-0" />
                    History
                    <span className="ml-auto font-mono text-[10.5px] tabular-nums text-ink-3">
                      {history.length}
                    </span>
                  </Button>
                </DialogTrigger>
                {historyOpen ? (
                  <DialogContent className="h-[min(80dvh,620px)] w-[min(92vw,560px)]">
                    <DialogHeader className="border-b border-line px-4 py-3 pr-10">
                      <DialogTitle>Session history</DialogTitle>
                      <DialogDescription className="truncate font-mono" title={workspace.path}>
                        {workspace.name} · {workspace.path}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="shrink-0 border-b border-line p-3">
                      <Input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search sessions"
                        aria-label="Search session history"
                        className="h-8 bg-field text-[13px]"
                      />
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
                      {filteredHistory.length > 0 ? (
                        <ul className="flex flex-col gap-0.5 p-2">
                          {filteredHistory.map(session => (
                            <li key={session.id}>{sessionButton(session, true)}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="p-4 text-[12.5px] text-ink-3">No sessions match your search.</p>
                      )}
                    </ScrollArea>
                  </DialogContent>
                ) : null}
              </Dialog>
            </li>
          ) : null}

          {active ? (
            <li>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => onNewSession(workspace.path)}
                className="w-full justify-start gap-2 px-2 font-normal text-ink-2"
              >
                <Plus size={13} className="shrink-0" />
                New session
              </Button>
            </li>
          ) : null}
        </>
      )}
    </>
  )
}

/**
 * wmux-style workspace rail with orca-like seamless state. Each pinned project is
 * a collapsible row; beneath it the sessions split into "Active" (open in a tab)
 * and "History" (resume any past session). Header actions live in a `⋯` menu so
 * the row never feels like it's floating icons. Matches the AppShell and explorer
 * header heights so the three columns line up on one straight rule.
 */
export function ProjectRail({
  workspaces,
  activePath,
  onAddProject,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
  onRemove,
  onRefresh,
}: ProjectRailProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-2.5">
        <h1 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
          <FolderTree size={13} className="text-ink-3" aria-hidden />
          Workspaces
        </h1>
        <div className="flex items-center gap-0.5">
          {onRefresh ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  onClick={onRefresh}
                  aria-label="Refresh workspaces"
                  className="size-6"
                >
                  <RefreshCw size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="icon"
                onClick={onAddProject}
                aria-label="Add project"
                className="size-6"
              >
                <FolderPlus size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add project</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {workspaces.length === 0 ? (
            <p className="px-2 py-3 text-[12.5px] text-ink-3">
              No workspaces yet. Add a project to get started.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {workspaces.map(workspace => {
                const open = !collapsed[workspace.path]
                const isActive = workspace.path === activePath
                return (
                  <li key={workspace.path}>
                    <Collapsible
                      open={open}
                      onOpenChange={next =>
                        setCollapsed(prev => ({ ...prev, [workspace.path]: !next }))
                      }
                    >
                      <div
                        className={cn(
                          'group flex items-center gap-0.5 rounded-[var(--radius-control)]',
                          isActive && 'bg-hover-2',
                        )}
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            type="button"
                            variant="quiet"
                            size="sm"
                            onClick={() => onSelectWorkspace(workspace.path)}
                            aria-current={isActive ? 'true' : undefined}
                            className="h-auto min-w-0 flex-1 justify-start gap-1.5 px-1.5 py-1.5 font-normal"
                          >
                            <ChevronDown
                              size={12}
                              className={cn(
                                'shrink-0 text-ink-3 transition-transform duration-200',
                                !open && '-rotate-90',
                              )}
                            />
                            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                              <span className="w-full truncate text-left text-[13px] font-medium leading-tight text-ink">
                                {workspace.name}
                              </span>
                              <span
                                className="w-full truncate text-left font-mono text-[10.5px] leading-tight text-ink-3"
                                title={workspace.path}
                              >
                                {workspace.path}
                              </span>
                            </span>
                            {workspace.sessions.length > 0 ? (
                              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-3">
                                {workspace.sessions.length}
                              </span>
                            ) : null}
                          </Button>
                        </CollapsibleTrigger>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="quiet"
                              size="icon"
                              aria-label={`Workspace actions for ${workspace.name}`}
                              className="size-6 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 data-[state=open]:opacity-100"
                            >
                              <MoreHorizontal size={14} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onSelect={() => onNewSession(workspace.path)}
                              className="gap-2"
                            >
                              <Plus size={13} />
                              New session
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => onRemove?.(workspace.path)}
                              className="gap-2 text-red-500 focus:text-red-500"
                            >
                              <X size={13} />
                              Remove workspace
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <CollapsibleContent>
                        <ul className="flex flex-col gap-0.5 py-0.5 pl-5 pr-1">
                          <WorkspaceRows
                            workspace={workspace}
                            active={isActive}
                            onSelectWorkspace={onSelectWorkspace}
                            onSelectSession={onSelectSession}
                            onNewSession={onNewSession}
                          />
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
