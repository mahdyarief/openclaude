import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../shadcn/button.js'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../shadcn/resizable.js'
import { Sheet, SheetContent } from '../shadcn/sheet.js'
import { ThemeToggle } from '../shadcn/theme-toggle.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../shadcn/tooltip.js'
import type { PanelImperativeHandle } from 'react-resizable-panels'

/**
 * Scalable 3-region shell, laid out orca-style as a single full-height row so
 * every section reaches the top edge and no horizontal header eats vertical
 * space:
 *   rail     — multi-project + active session picker (left)
 *   main     — tabbed chat (centre, flex-1)
 *   explorer — file tree (right)
 *
 * The two side regions are resizable. Drag a divider to resize; once a region
 * is dragged below its `minSize` it collapses to zero and a header button
 * reopens it. The chosen layout (as percentages) is persisted to localStorage so
 * it survives reloads and window resizes.
 *
 * Responsive: below `MD` the side regions become drawers (sheets) and resize is
 * disabled because the columns are not shown side-by-side.
 */
export type AppShellProps = {
  rail: ReactNode
  tabs?: ReactNode
  chat: ReactNode
  explorer: ReactNode
  overlay?: ReactNode
  /** show the theme switcher */
  showThemeSwitcher?: boolean
}

const LG = 1024
const MD = 768

// Side-region resize limits, in pixels. Shrinking past `minSize` collapses the
// panel; `defaultSize` is the resting width. The explorer starts narrower so the
// centre keeps more room by default.
const RAIL_MIN_PX = 200
const RAIL_DEFAULT_PX = 264
const EXPLORER_MIN_PX = 240
const EXPLORER_DEFAULT_PX = 340

const STORAGE_KEY = 'openclaude-studio:shell-layout'

type PersistedLayout = { rail: number; explorer: number }

function loadLayout(): PersistedLayout | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>
    if (typeof parsed.rail === 'number' && typeof parsed.explorer === 'number') {
      return { rail: parsed.rail, explorer: parsed.explorer }
    }
  } catch {
    // ignore malformed storage
  }
  return null
}

type PanelHandle = PanelImperativeHandle | null

export function AppShell({
  rail,
  tabs,
  chat,
  explorer,
  overlay,
  showThemeSwitcher = false,
}: AppShellProps) {
  const [width, setWidth] = useState<number>(() =>
    typeof window === 'undefined' ? LG : window.innerWidth,
  )
  const isMobile = width < MD

  const initial = loadLayout()
  const railRef = useRef<PanelHandle>(null)
  const explorerRef = useRef<PanelHandle>(null)

  const [railOpen, setRailOpen] = useState(true)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [railSheet, setRailSheet] = useState(false)
  const [explorerSheet, setExplorerSheet] = useState(false)

  // The `.dark` class on <html> drives every token. Keep the toggle in sync.
  const [dark, setDark] = useState(
    () => typeof document === 'undefined' || document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persist = (layout: PersistedLayout) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // ignore quota / unavailable storage
    }
  }

  const railToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle project sidebar"
          className="size-7 text-ink-2 hover:text-ink"
          onClick={() => {
            if (isMobile) setRailSheet(true)
            else if (railOpen) railRef.current?.collapse()
            else railRef.current?.expand()
          }}
        >
          <PanelLeft className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle project sidebar</TooltipContent>
    </Tooltip>
  )

  const explorerToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle file explorer"
          className="size-7 text-ink-2 hover:text-ink"
          onClick={() => {
            if (isMobile) setExplorerSheet(true)
            else if (explorerOpen) explorerRef.current?.collapse()
            else explorerRef.current?.expand()
          }}
        >
          <PanelRight className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle file explorer</TooltipContent>
    </Tooltip>
  )

  if (isMobile) {
    return (
      <div className="relative flex h-full w-full overflow-hidden bg-surface">
        <Sheet open={railSheet} onOpenChange={setRailSheet}>
          <SheetContent side="left" className="w-[85%] max-w-[320px] p-0">
            <div className="h-full">{rail}</div>
          </SheetContent>
        </Sheet>
        <Sheet open={explorerSheet} onOpenChange={setExplorerSheet}>
          <SheetContent side="right" className="w-[85%] max-w-[320px] p-0">
            <div className="h-full">{explorer}</div>
          </SheetContent>
        </Sheet>

        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-1">
            {railToggle}
            {explorerToggle}
          </div>
          {tabs ? <div className="shrink-0">{tabs}</div> : null}
          <div className="min-h-0 flex-1 overflow-hidden">{chat}</div>
        </div>
        {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}
      </div>
    )
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-surface">
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full w-full"
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return
          persist({
            rail: (layout as Record<string, number>)['rail'] ?? RAIL_DEFAULT_PX,
            explorer: (layout as Record<string, number>)['explorer'] ?? EXPLORER_DEFAULT_PX,
          })
        }}
      >
        <ResizablePanel
          id="rail"
          panelRef={railRef}
          defaultSize={initial?.rail ?? RAIL_DEFAULT_PX}
          minSize={RAIL_MIN_PX}
          collapsedSize={0}
          collapsible
          onResize={(_, id) => {
            if (id === 'rail') setRailOpen(!railRef.current?.isCollapsed())
          }}
          className={cn('flex min-h-0 flex-col', railOpen ? 'border-r border-line' : 'overflow-hidden')}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-1">
            {railToggle}
            {showThemeSwitcher ? (
              <ThemeToggle dark={dark} onToggle={() => setDark((v) => !v)} />
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{rail}</div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel id="main" className="flex min-h-0 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-1">
            <div className="flex items-center gap-0.5">
              {!railOpen ? railToggle : null}
            </div>
            <div className="flex items-center gap-0.5">
              {showThemeSwitcher ? (
                <ThemeToggle dark={dark} onToggle={() => setDark((v) => !v)} />
              ) : null}
              {!explorerOpen ? explorerToggle : null}
            </div>
          </div>
          {tabs ? <div className="shrink-0">{tabs}</div> : null}
          <div className="min-h-0 flex-1 overflow-hidden">{chat}</div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          id="explorer"
          panelRef={explorerRef}
          defaultSize={initial?.explorer ?? EXPLORER_DEFAULT_PX}
          minSize={EXPLORER_MIN_PX}
          collapsedSize={0}
          collapsible
          onResize={(_, id) => {
            if (id === 'explorer') setExplorerOpen(!explorerRef.current?.isCollapsed())
          }}
          className={cn(
            'flex min-h-0 flex-col',
            explorerOpen ? 'border-l border-line' : 'overflow-hidden',
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-1">
            {explorerToggle}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{explorer}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}
    </div>
  )
}
