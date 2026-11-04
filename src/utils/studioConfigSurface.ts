/**
 * Studio config surface shared between the agent's `openclaude/config` ACP
 * method and the web `/config` panel.
 *
 * Each entry declares one user-visible setting together with how to read its
 * current value and how to persist a change. Boolean settings render as
 * on/off toggles; enum settings render as a single-choice list. Setting IDs
 * are stable strings; most mirror the underlying config key directly.
 */

import { getGlobalConfig, saveGlobalConfig, MAX_MESSAGES_COMPACTION_THRESHOLDS, normalizeMaxMessagesCompactionThreshold, type GlobalConfig } from './config.js'
import { getSettingsForSource, updateSettingsForSource } from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'
import type { EditableSettingSource } from './settings/constants.js'
import { normalizeCompactTailTurns } from './relevancePruning.js'
import { normalizeReplMaxTurns, REPL_MAX_TURNS_OPTIONS } from './replMaxTurns.js'
import { OUTPUT_STYLE_CONFIG } from '../constants/outputStyles.js'
import { getDefaultPermissionModeOptions } from './permissions/defaultPermissionModeOptions.js'
import { feature } from 'bun:bundle'
import { getAutoModeEnabledState, hasAutoModeOptInAnySource } from './permissions/permissionSetup.js'

/** Settings persisted to the user's settings file, like the terminal panel. */
const SETTINGS_SOURCE = 'userSettings' as const satisfies EditableSettingSource

export type ConfigSettingType = 'boolean' | 'enum'

export type ConfigSetting = {
  id: string
  type: ConfigSettingType
  label: string
  description: string
  /** For enum settings only. */
  options?: string[]
  /** Read the current value. Boolean entries may return undefined (unset). */
  read: () => unknown
  /** Persist a new value. */
  write: (value: unknown) => void
}

function readSettings(id: string): unknown {
  return getSettingsForSource(SETTINGS_SOURCE)?.[id]
}

function writeSettings(id: string, value: unknown): void {
  updateSettingsForSource(SETTINGS_SOURCE, { [id]: value } as SettingsJson)
}

function writePermissionDefaultMode(value: unknown): void {
  updateSettingsForSource(SETTINGS_SOURCE, {
    permissions: { defaultMode: value },
  } as unknown as SettingsJson)
}

function saveGlobal<K extends keyof GlobalConfig>(key: K, value: GlobalConfig[K]): void {
  saveGlobalConfig(current => ({ ...current, [key]: value }))
}

function boolFromSettings(id: string, fallback: boolean) {
  return () => {
    const value = readSettings(id)
    return value === undefined ? fallback : Boolean(value)
  }
}

function writeBoolToSettings(id: string) {
  return (value: unknown) => writeSettings(id, Boolean(value))
}

export function buildConfigSettings(): ConfigSetting[] {
  const global = getGlobalConfig()
  const showAutoInDefaultModePicker =
    feature('TRANSCRIPT_CLASSIFIER') &&
    (hasAutoModeOptInAnySource() || getAutoModeEnabledState() === 'enabled')

  return [
    // ---------- Boolean ----------
    {
      id: 'autoCompactEnabled',
      type: 'boolean',
      label: 'Auto-compact',
      description: 'Automatically summarize the conversation when the context window fills.',
      read: () => global.autoCompactEnabled ?? true,
      write: value => saveGlobal('autoCompactEnabled', Boolean(value)),
    },
    {
      id: 'toolHistoryCompressionEnabled',
      type: 'boolean',
      label: 'Tool history compression',
      description: 'Truncate old tool outputs in long sessions to save context.',
      read: () => global.toolHistoryCompressionEnabled ?? true,
      write: value => saveGlobal('toolHistoryCompressionEnabled', Boolean(value)),
    },
    {
      id: 'agentHallEnabled',
      type: 'boolean',
      label: 'Agent Hall',
      description: 'Multi-session agent coordination for parallel work.',
      read: () => global.agentHallEnabled ?? true,
      write: value => saveGlobal('agentHallEnabled', Boolean(value)),
    },
    {
      id: 'contextCollapseEnabled',
      type: 'boolean',
      label: 'Context collapse',
      description: 'Lossy folding of older context to save tokens; may drop detail.',
      read: () => global.contextCollapseEnabled ?? false,
      write: value => saveGlobal('contextCollapseEnabled', Boolean(value)),
    },
    {
      id: 'verificationAgent',
      type: 'boolean',
      label: 'Verification agent',
      description: 'Double-check completed work with tests before reporting done.',
      read: boolFromSettings('verificationAgent', true),
      write: writeBoolToSettings('verificationAgent'),
    },
    {
      id: 'alwaysThinkingEnabled',
      type: 'boolean',
      label: 'Thinking mode',
      description: 'Extended reasoning; may improve quality but adds latency.',
      read: boolFromSettings('alwaysThinkingEnabled', false),
      write: writeBoolToSettings('alwaysThinkingEnabled'),
    },
    {
      id: 'fastMode',
      type: 'boolean',
      label: 'Fast mode',
      description: 'Faster output on the same model (supported models only).',
      read: boolFromSettings('fastMode', false),
      write: writeBoolToSettings('fastMode'),
    },
    {
      id: 'promptSuggestionEnabled',
      type: 'boolean',
      label: 'Prompt suggestions',
      description: 'Suggest follow-up prompts after a response.',
      read: boolFromSettings('promptSuggestionEnabled', true),
      write: writeBoolToSettings('promptSuggestionEnabled'),
    },
    {
      id: 'skillSearch',
      type: 'boolean',
      label: 'Skill search',
      description: 'Search available skills during the conversation.',
      read: boolFromSettings('skillSearch', false),
      write: writeBoolToSettings('skillSearch'),
    },
    {
      id: 'autoMemoryEnabled',
      type: 'boolean',
      label: 'Auto memory',
      description: 'Automatically read and write memory across sessions.',
      read: boolFromSettings('autoMemoryEnabled', true),
      write: writeBoolToSettings('autoMemoryEnabled'),
    },
    {
      id: 'useAutoModeDuringPlan',
      type: 'boolean',
      label: 'Use auto mode during plan',
      description: 'Use auto permission mode while planning.',
      read: boolFromSettings('useAutoModeDuringPlan', false),
      write: writeBoolToSettings('useAutoModeDuringPlan'),
    },
    {
      id: 'respectGitignore',
      type: 'boolean',
      label: 'Respect gitignore',
      description: 'Ignore files matching .gitignore patterns.',
      read: () => global.respectGitignore ?? true,
      write: value => saveGlobal('respectGitignore', Boolean(value)),
    },
    {
      id: 'taskCompleteNotifEnabled',
      type: 'boolean',
      label: 'Push when idle',
      description: 'Notify when a task finishes and the session goes idle.',
      read: () => global.taskCompleteNotifEnabled ?? true,
      write: value => saveGlobal('taskCompleteNotifEnabled', Boolean(value)),
    },
    {
      id: 'inputNeededNotifEnabled',
      type: 'boolean',
      label: 'Push when input needed',
      description: 'Notify when the agent needs your input to continue.',
      read: () => global.inputNeededNotifEnabled ?? true,
      write: value => saveGlobal('inputNeededNotifEnabled', Boolean(value)),
    },
    {
      id: 'agentPushNotifEnabled',
      type: 'boolean',
      label: 'Push when agent decides',
      description: 'Let the agent decide when to send a notification.',
      read: () => global.agentPushNotifEnabled ?? true,
      write: value => saveGlobal('agentPushNotifEnabled', Boolean(value)),
    },
    {
      id: 'showTurnDuration',
      type: 'boolean',
      label: 'Show turn duration',
      description: 'Display how long each response turn took.',
      read: () => global.showTurnDuration ?? true,
      write: value => saveGlobal('showTurnDuration', Boolean(value)),
    },
    {
      id: 'terminalProgressBarEnabled',
      type: 'boolean',
      label: 'Terminal progress bar',
      description: 'Report progress via the terminal progress bar (where supported).',
      read: () => global.terminalProgressBarEnabled ?? true,
      write: value => saveGlobal('terminalProgressBarEnabled', Boolean(value)),
    },
    {
      id: 'fileCheckpointingEnabled',
      type: 'boolean',
      label: 'File checkpointing',
      description: 'Track file edits so turns can be rewound.',
      read: () => global.fileCheckpointingEnabled ?? true,
      write: value => saveGlobal('fileCheckpointingEnabled', Boolean(value)),
    },
    {
      id: 'copyOnSelect',
      type: 'boolean',
      label: 'Copy on select',
      description: 'Copy selected text to the clipboard automatically.',
      read: () => global.copyOnSelect ?? false,
      write: value => saveGlobal('copyOnSelect', Boolean(value)),
    },
    {
      id: 'copyFullResponse',
      type: 'boolean',
      label: 'Always copy full response',
      description: 'Always copy the full response, skipping the /copy picker.',
      read: () => global.copyFullResponse ?? false,
      write: value => saveGlobal('copyFullResponse', Boolean(value)),
    },
    {
      id: 'autoConnectIde',
      type: 'boolean',
      label: 'Auto-connect to IDE',
      description: 'Automatically connect to a running IDE when started outside one.',
      read: () => global.autoConnectIde ?? false,
      write: value => saveGlobal('autoConnectIde', Boolean(value)),
    },
    {
      id: 'autoInstallIdeExtension',
      type: 'boolean',
      label: 'Auto-install IDE extension',
      description: 'Install the extension into detected IDEs automatically.',
      read: () => global.autoInstallIdeExtension ?? true,
      write: value => saveGlobal('autoInstallIdeExtension', Boolean(value)),
    },
    {
      id: 'claudeInChromeDefaultEnabled',
      type: 'boolean',
      label: 'Browser integration by default',
      description: 'Enable the Chrome browser integration for new sessions by default.',
      read: () => global.claudeInChromeDefaultEnabled ?? true,
      write: value => saveGlobal('claudeInChromeDefaultEnabled', Boolean(value)),
    },
    {
      id: 'remoteControlAtStartup',
      type: 'boolean',
      label: 'Remote control for all sessions',
      description: 'Start every session with remote control enabled.',
      read: () => global.remoteControlAtStartup ?? true,
      write: value => saveGlobal('remoteControlAtStartup', Boolean(value)),
    },
    {
      id: 'prStatusFooterEnabled',
      type: 'boolean',
      label: 'Show PR status footer',
      description: 'Show pull-request status in the footer after pushing a branch.',
      read: () => global.prStatusFooterEnabled ?? true,
      write: value => saveGlobal('prStatusFooterEnabled', Boolean(value)),
    },
    {
      id: 'flickerFreeMode',
      type: 'boolean',
      label: 'Flicker-free mode',
      description: 'Alt-screen rendering to reduce terminal flicker.',
      read: () => global.flickerFreeMode ?? false,
      write: value => saveGlobal('flickerFreeMode', Boolean(value)),
    },

    // ---------- Enum ----------
    {
      id: 'showCacheStats',
      type: 'enum',
      label: 'Cache stats display',
      description: 'Show prompt-cache hit rates in the UI.',
      options: ['off', 'compact', 'full'],
      read: () => global.showCacheStats ?? 'off',
      write: value => saveGlobal('showCacheStats', value as GlobalConfig['showCacheStats']),
    },
    {
      id: 'editorMode',
      type: 'enum',
      label: 'Editor mode',
      description: 'Keybindings style for the input editor.',
      options: ['normal', 'emacs', 'vim'],
      read: () => global.editorMode ?? 'emacs',
      write: value => saveGlobal('editorMode', value as GlobalConfig['editorMode']),
    },
    {
      id: 'maxMessagesCompactionThreshold',
      type: 'enum',
      label: 'Message-count compaction trigger',
      description: 'Message count that triggers auto-compaction.',
      options: MAX_MESSAGES_COMPACTION_THRESHOLDS.map(String),
      read: () => String(normalizeMaxMessagesCompactionThreshold(global.maxMessagesCompactionThreshold)),
      write: value =>
        saveGlobal('maxMessagesCompactionThreshold', normalizeMaxMessagesCompactionThreshold(value)),
    },
    {
      id: 'compactTailTurns',
      type: 'enum',
      label: 'Compaction: recent messages kept',
      description: 'Recent turns kept verbatim after auto-compaction.',
      options: ['1', '2', '3', '5', '8'],
      read: () => String(normalizeCompactTailTurns(global.compactTailTurns)),
      write: value => saveGlobal('compactTailTurns', normalizeCompactTailTurns(value)),
    },
    {
      id: 'replMaxTurns',
      type: 'enum',
      label: 'Max turns per prompt',
      description: 'Cap on agent turns per user prompt in interactive sessions.',
      options: REPL_MAX_TURNS_OPTIONS.map(String),
      read: () => String(normalizeReplMaxTurns(global.replMaxTurns)),
      write: value => saveGlobal('replMaxTurns', normalizeReplMaxTurns(value)),
    },
    {
      id: 'diffTool',
      type: 'enum',
      label: 'Diff tool',
      description: 'Tool used for displaying diffs.',
      options: ['auto', 'terminal', 'vscode'],
      read: () => global.diffTool ?? 'auto',
      write: value => saveGlobal('diffTool', value as GlobalConfig['diffTool']),
    },
    {
      id: 'teammateMode',
      type: 'enum',
      label: 'Teammate mode',
      description: 'How teammate agents are spawned.',
      options: ['auto', 'tmux', 'in-process'],
      read: () => global.teammateMode ?? 'auto',
      write: value => saveGlobal('teammateMode', value as GlobalConfig['teammateMode']),
    },
    {
      id: 'apiRetry',
      type: 'enum',
      label: 'API retry attempts',
      description: 'Retries for a failed API request before giving up.',
      options: ['default', '3', '5', '10', 'unlimited'],
      read: () => {
        const retries = readSettings('apiRetry') as { maxRetries?: number | 'unlimited' } | undefined
        const value = retries?.maxRetries
        return value === undefined ? 'default' : String(value)
      },
      write: value => {
        const maxRetries =
          value === 'default' ? undefined : value === 'unlimited' ? 'unlimited' : Number(value)
        writeSettings('apiRetry', { maxRetries })
      },
    },
    {
      id: 'cleanupPeriodDays',
      type: 'enum',
      label: 'Transcript retention',
      description: 'Days to keep past session transcripts (0 keeps only the current day).',
      options: ['0', '7', '30', '90', '365'],
      read: () => {
        const value = readSettings('cleanupPeriodDays')
        return value === undefined ? '30' : String(value)
      },
      write: value => writeSettings('cleanupPeriodDays', Number(value)),
    },
    {
      id: 'defaultView',
      type: 'enum',
      label: 'Default view',
      description: 'What the session shows by default on open.',
      options: ['default', 'transcript', 'chat'],
      read: () => {
        const value = readSettings('defaultView')
        return value === undefined ? 'default' : String(value)
      },
      write: value => writeSettings('defaultView', String(value)),
    },
    {
      id: 'outputStyle',
      type: 'enum',
      label: 'Output style',
      description: 'Persona that shapes how responses are written.',
      options: Object.keys(OUTPUT_STYLE_CONFIG),
      read: () => {
        const value = readSettings('outputStyle')
        return value === undefined ? 'default' : String(value)
      },
      write: value => writeSettings('outputStyle', String(value)),
    },
    {
      id: 'defaultPermissionMode',
      type: 'enum',
      label: 'Default permission mode',
      description: 'Permission mode applied to new sessions.',
      options: getDefaultPermissionModeOptions(Boolean(showAutoInDefaultModePicker)),
      read: () => {
        const permissions = getSettingsForSource(SETTINGS_SOURCE)?.permissions as
          | { defaultMode?: string }
          | undefined
        return permissions?.defaultMode ?? 'default'
      },
      write: value => writePermissionDefaultMode(value),
    },
  ]
}
