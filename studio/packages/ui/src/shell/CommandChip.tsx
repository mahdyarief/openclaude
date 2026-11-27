import { Badge } from '../shadcn/badge.js'
import { cn } from '../lib/cn.js'

/**
 * Inline slash-command token rendered inside AI chat prose. When the agent
 * names a command (e.g. `/commit`, `/review:fast`) it reads as a pill instead
 * of raw monospace text, mirroring how the terminal shows `/command-name`.
 */
export type CommandChipProps = {
  name: string
  className?: string
}

// Slash commands: a leading `/`, then a name made of word chars and `:`/`-`
// (so scoped forms like `plugin:example` and `review:fast` match).
const COMMAND_RE = /^\/[A-Za-z][\w:-]*$/

export function isCommandText(text: string): boolean {
  return COMMAND_RE.test(text.trim())
}

/**
 * The CLI stores a slash invocation in the transcript as
 * `<command-name>/model</command-name><command-message>…</command-message>
 * <command-args>cbc</command-args>`. Parse it so the chat shows the command
 * name as a chip instead of leaking the raw XML into the bubble.
 */
export function parseCommandInvocation(
  text: string,
): { name: string; args: string } | null {
  const match =
    /^\s*<command-name>\s*([^<]+?)\s*<\/command-name>(?:\s*<command-message>[^<]*<\/command-message>)?(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/.exec(
      text,
    )
  if (!match) return null
  return { name: match[1] ?? '', args: (match[2] ?? '').trim() }
}

export function CommandChip({ name, className }: CommandChipProps) {
  const label = name.startsWith('/') ? name : `/${name}`
  return (
    <Badge
      variant="accent"
      data-slot="command-chip"
      className={cn('font-mono text-[0.85em] font-medium align-baseline', className)}
    >
      {label}
    </Badge>
  )
}
