import { useCallback, useState } from 'react'

export type TabKind = 'session' | 'document'

export type Tab = {
  /** Stable identity for the mounted pane. Never changes for the life of a tab. */
  tabId: string
  /** tab discriminator — sessions open the agent chat, documents open a viewer */
  kind: TabKind
  /** Current session id (for 'session' tabs), or a temporary `new-…` id. */
  sessionId?: string
  /** workspace-relative path (for 'document' tabs) */
  path?: string
  title: string
  /** project the tab belongs to; a tab from workspace A must not run in B */
  cwd: string
}

export type TabsState = { tabs: Tab[]; activeId: string | null }

export type TabsAction =
  | { type: 'open'; tab: Tab }
  | { type: 'close'; tabId: string }
  | { type: 'activate'; tabId: string }
  | { type: 'rename'; tabId: string; sessionId: string; title: string }

// Sessions dedupe by sessionId; documents dedupe by (cwd, path). A temp session
// id (`new-…`) is allowed to coexist until the first prompt assigns a real id.
function isSameOpen(target: Tab, candidate: Tab): boolean {
  if (target.kind !== candidate.kind) return false
  if (target.kind === 'session') {
    if (!target.sessionId || target.sessionId.startsWith('new-')) return false
    return target.sessionId === candidate.sessionId
  }
  return target.cwd === candidate.cwd && target.path === candidate.path
}

export function reduceTabs(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      const exists = state.tabs.some(tab => isSameOpen(action.tab, tab))
      return { tabs: exists ? state.tabs : [...state.tabs, action.tab], activeId: action.tab.tabId }
    }
    case 'activate':
      return state.tabs.some(tab => tab.tabId === action.tabId)
        ? { ...state, activeId: action.tabId }
        : state
    case 'close': {
      const index = state.tabs.findIndex(tab => tab.tabId === action.tabId)
      if (index === -1) return state
      const tabs = state.tabs.filter(tab => tab.tabId !== action.tabId)
      const activeId =
        state.activeId === action.tabId
          ? (tabs[Math.min(index, tabs.length - 1)]?.tabId ?? null)
          : state.activeId
      return { tabs, activeId }
    }
    case 'rename': {
      const target = state.tabs.find(tab => tab.tabId === action.tabId)
      if (!target) return state
      // Another tab may already show this session; drop the temp one instead of
      // showing the same session twice, and keep the survivor active if needed.
      const duplicate = state.tabs.find(
        tab => tab.tabId !== action.tabId && tab.sessionId === action.sessionId,
      )
      if (duplicate) {
        const tabs = state.tabs.filter(tab => tab.tabId !== action.tabId)
        return {
          tabs,
          activeId: state.activeId === target.tabId ? duplicate.tabId : state.activeId,
        }
      }
      return {
        tabs: state.tabs.map(tab =>
          tab.tabId === action.tabId
            ? { ...tab, sessionId: action.sessionId, title: action.title }
            : tab,
        ),
        activeId: state.activeId,
      }
    }
  }
}

export function useTabs() {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null })
  const openTab = useCallback((tab: Tab) => setState(s => reduceTabs(s, { type: 'open', tab })), [])
  const closeTab = useCallback((tabId: string) => setState(s => reduceTabs(s, { type: 'close', tabId })), [])
  const activate = useCallback((tabId: string) => setState(s => reduceTabs(s, { type: 'activate', tabId })), [])
  const renameTab = useCallback(
    (tabId: string, sessionId: string, title: string) =>
      setState(s => reduceTabs(s, { type: 'rename', tabId, sessionId, title })),
    [],
  )
  return { ...state, openTab, closeTab, activate, renameTab }
}
