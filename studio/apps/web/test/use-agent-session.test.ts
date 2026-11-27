import { describe, expect, test } from 'vitest'
import { sessionMode, mayEnterIdle } from '../src/use-agent-session.js'
import { buildPermissionOutcome } from '../src/permissions-outcome.js'
import { fileToContentBlock } from '../src/Workbench.js'
import { promptParts } from '@openclaude-studio/acp'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { PromptBar } from '@openclaude-studio/ui'

class FakeFile {
  constructor(
    readonly name: string,
    readonly type: string,
    private readonly contents: Uint8Array,
  ) {}
  get size() { return this.contents.length }
  async arrayBuffer() { return this.contents.buffer.slice(0) }
}

describe('attachment ContentBlocks', () => {
  test('images use base64 ACP image blocks', async () => {
    const file = new FakeFile('shot.png', 'image/png', new Uint8Array([1, 2, 3])) as unknown as File
    expect(await fileToContentBlock(file)).toEqual({
      type: 'image', data: 'AQID', mimeType: 'image/png',
    })
  })

  test('text files use embedded ACP resource blocks', async () => {
    const file = new FakeFile('notes.txt', 'text/plain', new TextEncoder().encode('hello')) as unknown as File
    const block = await fileToContentBlock(file)
    expect(block.type).toBe('resource')
    expect(promptParts([block])).toEqual([{ kind: 'content', block }])
  })

  test('PromptBar enables and labels its attachment control', () => {
    const html = renderToStaticMarkup(
      React.createElement(PromptBar, {
        value: '',
        onChange: () => {},
        onSend: () => {},
        onCancel: () => {},
        onAttach: () => {},
        labels: { placeholder: 'Ask', attach: '2 attached' },
      }),
    )
    expect(html).toContain('aria-label="2 attached"')
    expect(html).not.toMatch(/<button[^>]*aria-label="2 attached"[^>]* disabled=""/)
  })
})

describe('sessionMode', () => {
  test('loads when a session id is present', () => {
    expect(sessionMode('abc')).toEqual({ kind: 'load', sessionId: 'abc' })
  })
  test('defers creation when no session id is present', () => {
    expect(sessionMode(undefined)).toEqual({ kind: 'new' })
  })
})

describe('mayEnterIdle', () => {
  const idleReady = {
    status: 'ready' as const,
    streaming: false,
    awaiting: false,
    permissionPending: false,
    active: false,
  }

  test('allows a backgrounded, finished session to sleep', () => {
    expect(mayEnterIdle(idleReady)).toBe(true)
  })

  test('never sleeps the visible tab', () => {
    expect(mayEnterIdle({ ...idleReady, active: true })).toBe(false)
  })

  test('keeps a streaming turn alive even when the tab is hidden', () => {
    expect(mayEnterIdle({ ...idleReady, streaming: true })).toBe(false)
  })

  test('keeps the socket while the first chunk is still pending', () => {
    expect(mayEnterIdle({ ...idleReady, awaiting: true })).toBe(false)
  })

  test('keeps the socket while a permission is unanswered', () => {
    expect(mayEnterIdle({ ...idleReady, permissionPending: true })).toBe(false)
  })

  test('does not sleep while connecting or already dead', () => {
    expect(mayEnterIdle({ ...idleReady, status: 'connecting' })).toBe(false)
    expect(mayEnterIdle({ ...idleReady, status: 'dead' })).toBe(false)
    expect(mayEnterIdle({ ...idleReady, status: 'idle' })).toBe(false)
  })
})

describe('buildPermissionOutcome answer transport', () => {
  test('builds the selected outcome with the answers on _meta', () => {
    expect(buildPermissionOutcome('allow', { 'Pick one?': 'Yes' })).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow', _meta: { answers: { 'Pick one?': 'Yes' } } },
    })
  })

  test('builds a bare selected outcome without answers', () => {
    expect(buildPermissionOutcome('allow')).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })
  })

  test('builds a cancelled outcome for a null option', () => {
    expect(buildPermissionOutcome(null)).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})
