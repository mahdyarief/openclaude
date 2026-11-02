import { useEffect, useState, type ReactNode } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { Button } from '../shadcn/button.js'
import { Sheet, SheetContent } from '../shadcn/sheet.js'
import { ThemeToggle } from '../shadcn/theme-toggle.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../shadcn/tooltip.js'

/**
 * Scalable 3-region shell, laid out orca-style as a single full-height flex row
 * so every section reaches the top edge and no horizontal header eats vertical
 * space:
 *   rail     — multi-project + active session picker (left, shrink-0)
 *   main     — tabbed chat (centre, flex-1)
 *   explorer — file tree (right, shrink-0)
 *
 * Each column carries its own h-12 header strip; the centre header owns the
 * region toggles and theme switch so a collapsed rail/explorer can always be
 * reopened. Responsive collapse:
 *   desktop (≥1024px) — three columns side-by-side
 *   tablet  (≥768px)  — three columns side-by-side (narrower)
 *   mobile  (<768px)  — single pane; rail and explorer both become sheets
 *
 * The shell owns nothing about the data — callers pass the rail / chat /
 * explorer content. The shell owns: which regions are open, the theme toggle,
 * and the mobile drawers.
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
  const isDesktop = width >= LG
  const isTablet = width >= MD && width < LG
  // Both sidebars are real, collapsible columns on desktop and tablet; they
  // only become sheets on mobile, where there is no room for three columns.
  const railIsPinned = isDesktop || isTablet
  const explorerIsPinned = isDesktop || isTablet

  const [railOpen, setRailOpen] = useState(true)
  const [explorerOpen, setExplorerOpen] = useState(true)

  // Track viewport width without re-rendering the tree on scroll.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Snap the drawers to the sensible default whenever we cross a breakpoint.
  // Pinned rails/explorers are NOT snapped — their toggle state stays intact.
  useEffect(() => {
    if (!railIsPinned) {
      setRailOpen(false)
    }
    if (!explorerIsPinned) {
      setExplorerOpen(false)
    }
  }, [railIsPinned, explorerIsPinned])

  // The `.dark` class on <html> drives every token. Keep the toggle in sync
  // with the document on mount.
  const [dark, setDark] = useState(
    () => typeof document === 'undefined' || document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Opening a sheet closes the other one so the chat is never sandwiched.
  const toggleRail = () => {
    setRailOpen(open => !open)
    if (!railIsPinned) setExplorerOpen(false)
  }
  const toggleExplorer = () => {
    setExplorerOpen(open => !open)
    if (!explorerIsPinned) setRailOpen(false)
  }

  // A pinned region is shown only when its toggle is on; a non-pinned region
  // lives in a sheet (controlled below), never as a column.
  const railVisible = railIsPinned && railOpen
  const explorerVisible = explorerIsPinned && explorerOpen

  // Tablet and desktop share the same visibility rules; only the column widths
  // differ. Both sidebars can be collapsed independently at either size.
  const railWidth = railVisible
    ? 'md:w-[220px] lg:w-[260px]'
    : 'md:w-0 lg:w-0'
  const explorerWidth = explorerVisible
    ? 'md:w-[260px] lg:w-[300px]'
    : 'md:w-0 lg:w-0'

  return (
    <div className="flex h-screen min-h-0 w-full overflow-hidden bg-canvas text-ink">
      {/* LEFT — multi-project + active session picker. ProjectRail supplies its
       * own header, so the column reaches the top edge without a second strip. */}
      <aside
        data-region="rail"
        className={cn(
          'hidden min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-200 md:flex',
          railWidth,
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden">{rail}</div>
      </aside>

      {/* CENTER — tabbed chat (header owns the brand, region toggles + theme) */}
      <main data-region="chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="icon"
                aria-label="Toggle projects"
                aria-pressed={railOpen}
                onClick={toggleRail}
              >
                <PanelLeft size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Projects</TooltipContent>
          </Tooltip>

          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13.5px] font-semibold tracking-tight text-ink">
              OpenClaude
            </span>
            <span className="hidden text-[11.5px] font-medium tracking-wide text-ink-3 sm:inline">
              Studio
            </span>
          </span>

          <span className="ml-auto" aria-hidden />

          {showThemeSwitcher ? (
            <ThemeToggle dark={dark} onToggle={() => setDark(v => !v)} />
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="icon"
                aria-label="Toggle file explorer"
                aria-pressed={explorerOpen}
                onClick={toggleExplorer}
              >
                <PanelRight size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>File explorer</TooltipContent>
          </Tooltip>
        </header>

        {tabs}
        {overlay ? <div className="px-4 pt-4">{overlay}</div> : null}
        <div className="min-h-0 min-w-0 flex-1">{chat}</div>
      </main>

      {/* RIGHT — file explorer. FileExplorer supplies its own header. */}
      <aside
        data-region="explorer"
        className={cn(
          'hidden min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-line bg-surface transition-[width] duration-200 md:flex',
          explorerWidth,
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden">{explorer}</div>
      </aside>

      {/* Mobile rail sheet */}
      {!railIsPinned ? (
        <Sheet open={railOpen} onOpenChange={setRailOpen}>
          <SheetContent side="left" showClose={false} className="p-0">
            {rail}
          </SheetContent>
        </Sheet>
      ) : null}

      {/* Mobile explorer sheet */}
      {!explorerIsPinned ? (
        <Sheet open={explorerOpen} onOpenChange={setExplorerOpen}>
          <SheetContent side="right" showClose={false} className="p-0">
            {explorer}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}
