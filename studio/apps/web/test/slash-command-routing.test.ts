import { describe, expect, test } from 'vitest'
import type { AvailableCommand } from '@openclaude-studio/acp'
import { SLASH_COMMAND_TITLES } from '@openclaude-studio/ui'
import {
  configSectionFor,
  PANEL_COMMANDS,
  routeSlashCommand,
} from '../src/slash-command-routing.js'

function command(name: string, type?: string): AvailableCommand {
  return type
    ? { name, description: name, type }
    : { name, description: name }
}

describe('routeSlashCommand', () => {
  test.each(['config', 'provider', 'model', 'theme'])(
    '/%s opens the config dialog',
    name => {
      expect(routeSlashCommand(`/${name}`, [])).toEqual({ kind: 'config', name })
    },
  )

  test.each(['permissions', 'mcp', 'status', 'diff', 'tasks', 'usage', 'resume', 'sessions'])(
    '/%s opens its panel',
    name => {
      expect(routeSlashCommand(`/${name}`, [])).toEqual({ kind: 'panel', name })
    },
  )

  test('every routed panel has its own heading in the UI', () => {
    for (const name of PANEL_COMMANDS) {
      const route = routeSlashCommand(`/${name} extra`, [])
      expect(route).toEqual({ kind: 'panel', name })
      expect(SLASH_COMMAND_TITLES[name]).toBeTruthy()
    }
    expect(new Set(Object.values(SLASH_COMMAND_TITLES)).size).toBe(PANEL_COMMANDS.length)
  })

  test('ignores trailing arguments when routing', () => {
    expect(routeSlashCommand('/status --verbose', [])).toEqual({
      kind: 'panel',
      name: 'status',
    })
  })

  test('trims surrounding whitespace', () => {
    expect(routeSlashCommand('  /diff  ', [])).toEqual({ kind: 'panel', name: 'diff' })
  })

  test('unmapped local-jsx commands are reported as unsupported', () => {
    expect(routeSlashCommand('/agents', [command('agents', 'local-jsx')])).toEqual({
      kind: 'unsupported',
      name: 'agents',
    })
  })

  test('unmapped local commands are reported too, not sent as prompts', () => {
    expect(routeSlashCommand('/cost', [command('cost', 'local')])).toEqual({
      kind: 'unsupported',
      name: 'cost',
    })
  })

  test('prompt-type commands are sent to the agent', () => {
    expect(routeSlashCommand('/review', [command('review', 'prompt')])).toEqual({
      kind: 'prompt',
    })
  })

  test('unknown commands fall through to the agent', () => {
    expect(routeSlashCommand('/not-a-real-command', [])).toEqual({ kind: 'prompt' })
  })

  test('plain text and empty input are prompts', () => {
    expect(routeSlashCommand('fix the build', [])).toEqual({ kind: 'prompt' })
    expect(routeSlashCommand('   ', [])).toEqual({ kind: 'prompt' })
  })

  test('a mapped command stays mapped even when advertised as local-jsx', () => {
    expect(routeSlashCommand('/sessions', [command('sessions', 'local-jsx')])).toEqual({
      kind: 'panel',
      name: 'sessions',
    })
  })
})

describe('configSectionFor', () => {
  test('/config opens every section', () => {
    expect(configSectionFor('config')).toBe('all')
  })

  test.each(['model', 'theme', 'provider'] as const)('/%s opens its own section', name => {
    expect(configSectionFor(name)).toBe(name)
  })
})
