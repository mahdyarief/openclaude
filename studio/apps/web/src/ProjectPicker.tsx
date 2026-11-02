import { useCallback, useEffect, useState } from 'react'
import {
  browseDirectory,
  listProjects,
  listRoots,
  type BrowseEntry,
  type BrowseRoot,
  type ProjectSummary,
} from '@openclaude-studio/acp'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  LoadingState,
  ScrollArea,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@openclaude-studio/ui'
import { ChevronRight, Folder, FolderOpen, Home } from 'lucide-react'
import type { BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'
import { folderName } from './project-store.js'
import { readProjectList } from './project-store.js'

export function manualProject(path: string): ActiveProject | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  return { path: trimmed, name: folderName(trimmed) }
}

/** Case-insensitive substring match across the given fields; empty query matches all. */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some(field => field.toLowerCase().includes(needle))
}

type Tab = 'bridge' | 'browse'

export function ProjectPicker({
  config,
  onSelect,
  onDisconnect,
  onClose,
}: {
  config: BridgeConfig
  onSelect: (project: ActiveProject) => void
  onDisconnect: () => void
  /** when provided, renders as a closable modal instead of a full screen */
  onClose?: () => void
}) {
  const [tab, setTab] = useState<Tab>('bridge')

  const body = (
    <Tabs
      value={tab}
      onValueChange={value => setTab(value as Tab)}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <TabsList aria-label="Project source" className="shrink-0 border-b border-line">
        <TabsTrigger value="bridge">On this bridge</TabsTrigger>
        <TabsTrigger value="browse">Browse local</TabsTrigger>
      </TabsList>

      <TabsContent value="bridge" className="flex min-h-0 flex-1 flex-col">
        <BridgeProjects config={config} onSelect={onSelect} />
      </TabsContent>

      <TabsContent value="browse" className="flex min-h-0 flex-1 flex-col">
        <LocalBrowser config={config} onSelect={onSelect} />
      </TabsContent>
    </Tabs>
  )

  if (onClose) {
    return (
      <Dialog open onOpenChange={open => (open ? undefined : onClose())}>
        <DialogContent>
          <DialogHeader className="border-b border-line px-5 pb-3 pt-4">
            <DialogTitle>Add a project</DialogTitle>
            <DialogDescription>
              Pick a workspace from the bridge or browse this device.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col p-5">{body}</div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-ink sm:p-6">
      <section className="flex w-full max-w-2xl flex-col gap-5 rounded-[var(--radius-window)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-ink text-[12px] font-bold text-surface"
            >
              OC
            </span>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight">Choose a project</h1>
              <p className="text-[12.5px] text-ink-3">
                Pick a folder to open its OpenClaude sessions.
              </p>
            </div>
          </div>
          <Button variant="quiet" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        </header>

        {body}
      </section>
    </main>
  )
}

function BridgeProjects({
  config,
  onSelect,
}: {
  config: BridgeConfig
  onSelect: (project: ActiveProject) => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [manual, setManual] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recent] = useState(() =>
    readProjectList(typeof localStorage === 'undefined' ? null : localStorage),
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listProjects(config.url, config.token)
      .then(next => {
        if (!cancelled) {
          setProjects(next)
          setError(null)
        }
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [config.url, config.token])

  const needle = query.trim()
  const visible = projects.filter(project =>
    matchesQuery(needle, folderName(project.path), project.path),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="shrink-0 rounded-[var(--radius-control)] border border-red bg-red-tint px-3 py-2 text-[13px] text-red"
        >
          {error}
        </p>
      ) : null}

      {recent.length > 0 && !needle ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Recent</h2>
          <ul className="flex flex-col gap-1">
            {recent.slice(0, 4).map(project => (
              <li key={project.path}>
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => onSelect(project)}
                  className="w-full justify-between gap-3 bg-canvas px-3 text-left font-normal"
                >
                  <span className="min-w-0 truncate font-mono text-[12.5px] text-ink">{project.path}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">Open</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
            On this bridge
          </h2>
          {!loading && projects.length > 0 ? (
            <span className="font-mono text-[10.5px] tabular-nums text-ink-3">
              {visible.length}/{projects.length}
            </span>
          ) : null}
        </div>
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search projects by name or path"
          aria-label="Search bridge projects"
          autoComplete="off"
          spellCheck={false}
          className="shrink-0"
        />
        {loading ? (
          <div className="px-1 py-2">
            <LoadingState variant="Skeleton" rows={4} labels={{ label: 'Loading projects' }} />
          </div>
        ) : projects.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-4 text-[13px] text-ink-3">
            No projects found on the bridge.
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-4 text-[13px] text-ink-3">
            No project matches “{query.trim()}”.
          </p>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col gap-1 pr-1">
              {visible.map(project => (
                <li key={project.path}>
                  <Button
                    variant="quiet"
                    size="md"
                    onClick={() => onSelect({ path: project.path, name: folderName(project.path) })}
                    className="w-full justify-between gap-3 px-3 text-left font-normal"
                  >
                    <span className="min-w-0 truncate font-mono text-[12.5px]">{project.path}</span>
                    <span className="shrink-0 text-[11.5px] font-normal text-ink-3">
                      {project.sessionCount} session{project.sessionCount === 1 ? '' : 's'}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      <Separator className="shrink-0" />

      <form
        onSubmit={event => {
          event.preventDefault()
          const project = manualProject(manual)
          if (project) onSelect(project)
        }}
        className="flex shrink-0 flex-col gap-2"
      >
        <Label htmlFor="project-path">Or paste a project path</Label>
        <Input
          id="project-path"
          value={manual}
          onChange={event => setManual(event.target.value)}
          placeholder="/absolute/path/to/project"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="default" size="md" disabled={!manual.trim()}>
          Open path
        </Button>
      </form>
    </div>
  )
}

function LocalBrowser({
  config,
  onSelect,
}: {
  config: BridgeConfig
  onSelect: (project: ActiveProject) => void
}) {
  const [roots, setRoots] = useState<BrowseRoot[]>([])
  const [entries, setEntries] = useState<BrowseEntry[]>([])
  const [path, setPath] = useState<string>('')
  const [parent, setParent] = useState<string | null>(null)
  const [home, setHome] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (target?: string) => {
      setLoading(true)
      setError(null)
      try {
        const listing = await browseDirectory(config.url, config.token, target)
        setEntries(listing.entries)
        setPath(listing.path)
        setParent(listing.parent)
        setHome(listing.home)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setLoading(false)
      }
    },
    [config.url, config.token],
  )

  useEffect(() => {
    let cancelled = false
    listRoots(config.url, config.token)
      .then(next => {
        if (!cancelled) setRoots(next)
      })
      .catch(() => {
        /* roots are a convenience; browsing still works without them */
      })
    void load()
    return () => {
      cancelled = true
    }
  }, [config.url, config.token, load])

  const dirs = entries.filter(entry => entry.kind === 'dir')
  const needle = query.trim()
  const visible = dirs.filter(entry => matchesQuery(needle, entry.name))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="shrink-0 rounded-[var(--radius-control)] border border-red bg-red-tint px-3 py-2 text-[13px] text-red"
        >
          {error}
        </p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {roots.length > 0 ? (
          roots.map(root => (
            <Button
              key={root.path}
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                setQuery('')
                void load(root.path)
              }}
              className="gap-1.5"
            >
              <Folder size={14} />
              {root.name}
            </Button>
          ))
        ) : (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              setQuery('')
              void load()
            }}
            className="gap-1.5"
          >
            <Home size={14} />
            Home
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-field px-2.5 py-2">
          {parent !== null ? (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                setQuery('')
                void load(parent ?? undefined)
              }}
              className="shrink-0 gap-1"
            >
              <ChevronRight size={14} className="rotate-180" />
              Up
            </Button>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-2" title={path}>
            {path}
          </span>
        </div>

        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Filter folders in this directory"
          aria-label="Filter folders"
          autoComplete="off"
          spellCheck={false}
        />

        {loading ? (
          <div className="px-1 py-2">
            <LoadingState variant="Skeleton" rows={5} labels={{ label: 'Reading folder' }} />
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-4 text-[13px] text-ink-3">
            {dirs.length === 0
              ? `No subfolders here. Use “Open this folder” to choose ${path}.`
              : `No folder matches “${query.trim()}”.`}
          </p>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col gap-0.5 pr-1">
              {visible.map(entry => (
                <li key={entry.path}>
                  <Button
                    type="button"
                    variant="quiet"
                    size="md"
                    onClick={() => {
                      setQuery('')
                      void load(entry.path)
                    }}
                    className="w-full justify-start gap-2 px-2 text-left font-normal"
                  >
                    <FolderOpen size={15} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <ChevronRight size={14} className="shrink-0 text-ink-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      <Button
        type="button"
        variant="default"
        size="md"
        className="shrink-0"
        onClick={() =>
          onSelect(manualProject(path) ?? { path, name: path.replace(/[^a-zA-Z0-9]/g, '-') })
        }
      >
        Open this folder
      </Button>
    </div>
  )
}
