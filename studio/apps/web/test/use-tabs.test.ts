import { describe, expect, test } from 'vitest'
import { reduceTabs, type Tab } from '../src/use-tabs.js'

const session = (id: string, title = id): Tab => ({
  tabId: id,
  kind: 'session',
  sessionId: id,
  title,
  cwd: '/p',
})

const doc = (path: string, cwd = '/p'): Tab => ({
  tabId: `doc:${cwd}:${path}`,
  kind: 'document',
  path,
  title: path.split('/').pop() ?? path,
  cwd,
})

describe('reduceTabs sessions', () => {
  test('opens a tab and activates it', () => {
    const state = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: session('a', 'A') })
    expect(state).toEqual({ tabs: [session('a', 'A')], activeId: 'a' })
  })

  test('opening the same tab twice does not duplicate it', () => {
    const first = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: session('a') })
    const second = reduceTabs(first, { type: 'open', tab: session('a') })
    expect(second.tabs).toHaveLength(1)
  })

  test('closing the active tab activates the neighbour', () => {
    const state = reduceTabs(
      { tabs: [session('a'), session('b')], activeId: 'b' },
      { type: 'close', tabId: 'b' },
    )
    expect(state.activeId).toBe('a')
  })

  test('closing the last tab leaves no active tab', () => {
    const state = reduceTabs({ tabs: [session('a')], activeId: 'a' }, { type: 'close', tabId: 'a' })
    expect(state).toEqual({ tabs: [], activeId: null })
  })
})

describe('reduceTabs documents', () => {
  test('opens a document tab and activates it', () => {
    const state = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: doc('src/app.ts') })
    expect(state.tabs).toHaveLength(1)
    expect(state.activeId).toBe('doc:/p:src/app.ts')
  })

  test('the same file in the same workspace does not duplicate', () => {
    const first = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: doc('README.md') })
    const second = reduceTabs(first, { type: 'open', tab: doc('README.md') })
    expect(second.tabs).toHaveLength(1)
  })

  test('the same relative path in another workspace opens a second tab', () => {
    const first = reduceTabs({ tabs: [], activeId: null }, { type: 'open', tab: doc('README.md', '/p') })
    const second = reduceTabs(first, { type: 'open', tab: doc('README.md', '/q') })
    expect(second.tabs).toHaveLength(2)
  })

  test('a document and a session can share the same tab id namespace without colliding', () => {
    const state = reduceTabs(
      { tabs: [session('a')], activeId: 'a' },
      { type: 'open', tab: doc('a') },
    )
    expect(state.tabs).toHaveLength(2)
  })
})

describe('reduceTabs rename', () => {
  test('renames a temp tab in place, keeping its index and tabId', () => {
    const temp: Tab = {
      tabId: 'new-1',
      kind: 'session',
      sessionId: 'new-1',
      title: 'New session',
      cwd: '/p',
    }
    const state = reduceTabs(
      { tabs: [session('x'), temp, session('z')], activeId: 'new-1' },
      { type: 'rename', tabId: 'new-1', sessionId: 'real', title: 'Real session' },
    )
    expect(state.tabs.map(t => t.tabId)).toEqual(['x', 'new-1', 'z'])
    expect(state.tabs[1]).toEqual({
      tabId: 'new-1',
      kind: 'session',
      sessionId: 'real',
      title: 'Real session',
      cwd: '/p',
    })
    expect(state.activeId).toBe('new-1')
  })

  test('renaming a non-active tab leaves activeId alone', () => {
    const temp: Tab = {
      tabId: 'new-1',
      kind: 'session',
      sessionId: 'new-1',
      title: 'New session',
      cwd: '/p',
    }
    const state = reduceTabs(
      { tabs: [session('a'), temp], activeId: 'a' },
      { type: 'rename', tabId: 'new-1', sessionId: 'real', title: 'Real' },
    )
    expect(state.activeId).toBe('a')
  })

  test('renaming into an already-open session drops the temp tab', () => {
    const temp: Tab = {
      tabId: 'new-1',
      kind: 'session',
      sessionId: 'new-1',
      title: 'New session',
      cwd: '/p',
    }
    const state = reduceTabs(
      { tabs: [session('real'), temp], activeId: 'new-1' },
      { type: 'rename', tabId: 'new-1', sessionId: 'real', title: 'Real' },
    )
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]?.tabId).toBe('real')
    expect(state.activeId).toBe('real')
  })
})
