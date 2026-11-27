import type { AvailableCommand } from '@openclaude-studio/acp'
import type { ConfigSection } from '@openclaude-studio/ui'

/** Commands whose terminal UI the Studio renders as its own config dialog. */
export const CONFIG_COMMANDS = ['config', 'provider', 'model', 'theme'] as const

/** Commands whose terminal UI the Studio renders as a read-only panel. */
export const PANEL_COMMANDS = [
  'permissions',
  'mcp',
  'status',
  'diff',
  'tasks',
  'usage',
  'resume',
  'sessions',
] as const

export type ConfigCommand = (typeof CONFIG_COMMANDS)[number]
export type PanelCommand = (typeof PANEL_COMMANDS)[number]

/** `/config` shows every section; the others jump straight to theirs. */
export function configSectionFor(name: ConfigCommand): ConfigSection {
  return name === 'config' ? 'all' : name
}

export type SlashCommandRoute =
  /** Open `ConfigDialog` on this section. */
  | { kind: 'config'; name: ConfigCommand }
  /** Open the Studio panel for this command. */
  | { kind: 'panel'; name: PanelCommand }
  /** Advertised as `local-jsx` but the Studio implements no panel for it. */
  | { kind: 'unsupported'; name: string }
  /** Not a slash command, or a prompt-type command: send it to the agent. */
  | { kind: 'prompt' }

function isConfigCommand(name: string): name is ConfigCommand {
  return (CONFIG_COMMANDS as readonly string[]).includes(name)
}

function isPanelCommand(name: string): name is PanelCommand {
  return (PANEL_COMMANDS as readonly string[]).includes(name)
}

/**
 * Decide where a composer submission goes. Both the `/` menu pick and a typed
 * `/command` + Enter route through the same decision, so no `local-jsx`
 * command can reach the agent as a prompt that resolves with no output.
 */
export function routeSlashCommand(
  input: string,
  commands: readonly AvailableCommand[],
): SlashCommandRoute {
  const match = /^\/([A-Za-z0-9_-]+)/.exec(input.trim())
  if (!match) return { kind: 'prompt' }
  const name = match[1] as string

  if (isConfigCommand(name)) return { kind: 'config', name }
  if (isPanelCommand(name)) return { kind: 'panel', name }

  // Any other command the agent advertises as terminal UI has no web
  // equivalent here. Say so instead of sending a prompt that produces
  // nothing. Prompt-type commands (and unknown names) fall through to the
  // agent, which owns their behaviour.
  const advertised = commands.find(command => command.name === name)
  if (advertised?.type === 'local-jsx' || advertised?.type === 'local') {
    return { kind: 'unsupported', name }
  }

  return { kind: 'prompt' }
}
