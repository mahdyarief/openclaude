import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppShell,
  Button,
  ChatPane,
  ConfigDialog,
  DocumentViewer,
  FileExplorer,
  LoadingState,
  PromptBar,
  ProjectRail,
  ResourceUsageFooter,
  SessionTabs,
} from '@openclaude-studio/ui'
import {
  PERMISSION_MODE_LABELS,
  PERMISSION_MODES,
  isPermissionMode,
  type ConnectionStatus,
  type PermissionMode,
} from '@openclaude-studio/acp'
import type { BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'
import { useAgentSession } from './use-agent-session.js'
import { useFileContent, useFileTree } from './use-file-tree.js'
import { groupSessions, useProjectSessions } from './use-projects.js'
import { useTabs, type Tab } from './use-tabs.js'
import { usePageVisibility } from './use-page-visibility.js'
import { useWorkspaceSessions } from './use-workspace-sessions.js'
import { useMetrics } from './use-metrics.js'

/** The mode selector's entries — derived from the canonical list so adding a
 *  mode to `@openclaude-studio/acp` automatically extends this dropdown. */
const PERMISSION_MODE_OPTIONS = PERMISSION_MODES.map(mode => ({
  id: mode,
  label: PERMISSION_MODE_LABELS[mode],
}))

export function Workbench({
  config,
  project,
  projects,
  openSessions,
  permissionMode,
  onPermissionModeChange,
  onOpenSessionsChange,
  onAddProject,
  onSwitchProject,
  onRemoveProject,
  onConnectionFailed,
}: {
  config: BridgeConfig
  project: ActiveProject
  /** every pinned workspace shown in the rail */
  projects: ActiveProject[]
  /** session ids that are open in tabs, server-backed */
  openSessions: string[]
  /** current agent permission mode, server-backed */
  permissionMode: PermissionMode
  /** change the permission mode (persisted to the bridge) */
  onPermissionModeChange: (mode: PermissionMode) => void
  /** called whenever the open session set changes */
  onOpenSessionsChange: (ids: string[]) => void
  onAddProject: () => void
  onSwitchProject: (project: ActiveProject) => void
  onRemoveProject: (path: string) => void
  onConnectionFailed?: (() => void) | undefined
}) {
  const { tabs, activeId, openTab, closeTab, activate, renameTab } = useTabs()
  const tabVisible = usePageVisibility()
  // Per-pane connection status, keyed by tab id, so the tab strip can show a
  // status dot and the pane can label its own state.
  const [statusByTab, setStatusByTab] = useState<Record<string, ConnectionStatus>>({})
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh } = useProjectSessions(
    config.url,
    config.token,
    project.path,
  )
  const { dirs, loading: fsLoading, error: fsError, loadDir, refresh: refreshFiles } = useFileTree(
    config.url,
    config.token,
    project.path,
  )
  const { metrics, error: metricsError } = useMetrics(config)

  // A file clicked in the explorer opens as a document tab. `openDocument` is
  // keyed on the workspace path so the same relative path in another project
  // opens that project's copy, not a stale one.
  const openDocument = useCallback(
    (relativePath: string) => {
      const name = relativePath.split('/').pop() ?? relativePath
      const tabId = `doc:${project.path}:${relativePath}`
      openTab({
        tabId,
        kind: 'document',
        path: relativePath,
        title: name,
        cwd: project.path,
      } satisfies Tab)
    },
    [openTab, project.path],
  )

  // Switching workspaces closes any open document tab from the previous project.
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.kind === 'document' && tab.cwd !== project.path) closeTab(tab.tabId)
    }
    // Only re-run when the workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.path])

  // The rail holds the user's pinned workspaces (recently opened projects).
  // Each workspace shows its own sessions, so the list stays personal rather
  // than dumping the whole bridge index.
  const workspaceProjects = projects.map(p => ({ path: p.path, name: p.name }))

  const { byPath, refresh: refreshSessions } = useWorkspaceSessions(
    config.url,
    config.token,
    workspaceProjects,
  )

  // When a brand-new (temp-id) tab's session is created, rename the tab in
  // place so the pane keeps its WebSocket, its streamed history, and the
  // in-flight first prompt. We never remount the pane for this transition.
  const handleSessionCreated = useCallback(
    (tabId: string, realId: string, cwd: string) => {
      renameTab(tabId, realId, sessions.find(s => s.id === realId)?.title ?? realId)
      if (cwd === project.path) refresh()
      refreshSessions(cwd)
    },
    [renameTab, refresh, refreshSessions, sessions, project.path],
  )

  // Session tabs that are currently open define a workspace's "Active" group;
  // everything else from the bridge index falls under "History". The set is
  // mirrored to the bridge so other devices resume the same tabs.
  const openIds = tabs
    .filter(tab => tab.kind === 'session' && tab.sessionId && !tab.sessionId.startsWith('new-'))
    .map(tab => tab.sessionId as string)

  const openKey = openIds.join('\n')
  useEffect(() => {
    if (openKey === openSessions.join('\n')) return
    onOpenSessionsChange(openIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey])

  // Restore: when the server reports open sessions (e.g. after a browser refresh
  // or another device opened them), reopen any that have no tab yet. The session
  // is loaded via `session/load` and its JSONL history replayed in useAgentSession.
  // Tracks the ids already handled so a later server frame (another device
  // opening a session) can still add its tab without re-opening ones we have.
  const restoredRef = useRef(new Set<string>())
  useEffect(() => {
    // The session listing per workspace may still be in flight when the server
    // state arrives. Opening a tab before it finishes guesses `cwd` from the
    // active project and the transcript loads from the wrong directory — the
    // "blank until refresh" bug. Wait until every listing has settled, then
    // resolve id → cwd/title from the summaries.
    const entries = Object.values(byPath)
    const listingsReady = entries.length > 0 && entries.every(entry => !entry.loading)
    if (!listingsReady) return
    const openSet = new Set(openIds)
    for (const id of openSessions) {
      if (openSet.has(id) || restoredRef.current.has(id)) continue
      restoredRef.current.add(id)
      let cwd = project.path
      let title = id
      for (const [path, entry] of Object.entries(byPath)) {
        const summary = entry.sessions.find(s => s.id === id)
        if (summary) {
          cwd = path
          title = summary.title || id
          break
        }
      }
      openTab({ tabId: id, kind: 'session', sessionId: id, title, cwd })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessions, byPath])

  // A session that opens — created here or pushed from another device over the
  // SSE state stream — may not yet appear in the per-workspace listing, so the
  // History list would otherwise only refresh after a manual button press. When
  // an open session id is missing from the known summaries, re-list so it shows
  // up without a refresh. Each id is only ever attempted once, so an id that
  // genuinely resolves to no workspace cannot spin the listing forever.
  const autoRefreshRef = useRef(new Set<string>())
  const openSessionsKey = openSessions.join('\n')
  useEffect(() => {
    const known = new Set(
      Object.values(byPath).flatMap(entry => entry.sessions.map(s => s.id)),
    )
    const missing = openSessions.filter(
      id => !known.has(id) && !autoRefreshRef.current.has(id),
    )
    const anyLoading = Object.values(byPath).some(entry => entry.loading)
    if (missing.length > 0 && !anyLoading) {
      for (const id of missing) autoRefreshRef.current.add(id)
      refreshSessions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionsKey, byPath])

  const workspaces = workspaceProjects.map(project => {
    const entry = byPath[project.path]
    return {
      ...project,
      sessions: groupSessions(entry?.sessions ?? [], activeId),
      openIds,
      loading: entry?.loading ?? true,
      error: entry?.error ?? null,
    }
  })

  return (
    <AppShell
      showThemeSwitcher
      rail={
        <ProjectRail
          workspaces={workspaces}
          activePath={project.path}
          onAddProject={onAddProject}
          onSelectWorkspace={path => {
            const found = projects.find(p => p.path === path)
            if (found) onSwitchProject(found)
          }}
          onSelectSession={(workspacePath, sessionId) => {
            const found = byPath[workspacePath]?.sessions.find(s => s.id === sessionId)
            openTab({
              tabId: sessionId,
              kind: 'session',
              sessionId,
              title: found?.title ?? sessionId,
              cwd: workspacePath,
            })
          }}
          onNewSession={workspacePath => {
            const id = `new-${Date.now()}`
            openTab({ tabId: id, kind: 'session', sessionId: id, title: 'New session', cwd: workspacePath })
          }}
          onRemove={path => {
            for (const tab of tabs) {
              if (tab.cwd === path) closeTab(tab.tabId)
            }
            onRemoveProject(path)
          }}
          onRefresh={() => refreshSessions()}
        />
      }
      tabs={
        <SessionTabs
          tabs={tabs.map(tab => ({
            tabId: tab.tabId,
            title: tab.title,
            kind: tab.kind,
            ...(statusByTab[tab.tabId] ? { status: statusByTab[tab.tabId] } : {}),
          }))}
          activeId={activeId}
          onActivate={activate}
          onClose={closeTab}
        />
      }
      chat={
        tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-2">
            Select a session or open a file from the explorer.
          </div>
        ) : (
          tabs.map(tab => {
            const visible = tab.tabId === activeId
            if (tab.kind === 'document') {
              return (
                <div key={tab.tabId} className={visible ? 'h-full' : 'hidden'}>
                  <DocumentTab
                    url={config.url}
                    token={config.token}
                    cwd={tab.cwd}
                    path={tab.path ?? ''}
                  />
                </div>
              )
            }
            return (
              <div key={tab.tabId} className={visible ? 'h-full' : 'hidden'}>
                <SessionPane
                  config={config}
                  cwd={tab.cwd}
                  sessionId={tab.sessionId?.startsWith('new-') ? undefined : tab.sessionId}
                  permissionMode={permissionMode}
                  // Only the visible pane is "active": hidden tabs may soft-idle
                  // their finished sessions, and the page-level visibility gates
                  // backgrounded browser tabs entirely.
                  active={visible && tabVisible}
                  onPermissionModeChange={onPermissionModeChange}
                  onStatusChange={next =>
                    setStatusByTab(prev =>
                      prev[tab.tabId] === next ? prev : { ...prev, [tab.tabId]: next },
                    )
                  }
                  onSessionCreated={realId => handleSessionCreated(tab.tabId, realId, tab.cwd)}
                  onConnectionFailed={onConnectionFailed}
                />
              </div>
            )
          })
        )
      }
      explorer={
        <FileExplorer
          dirs={dirs}
          loading={fsLoading}
          error={fsError}
          onRefresh={refreshFiles}
          onLoadDir={loadDir}
          onSelectFile={openDocument}
        />
      }
      footer={<ResourceUsageFooter metrics={metrics} error={metricsError} />}
    />
  )
}

function SessionPane({
  config,
  cwd,
  sessionId,
  permissionMode,
  active,
  onStatusChange,
  onPermissionModeChange,
  onSessionCreated,
  onConnectionFailed,
}: {
  config: BridgeConfig
  cwd: string
  sessionId?: string | undefined
  /** current agent permission mode, server-backed */
  permissionMode: PermissionMode
  /** whether this pane is the visible one (gates soft-idle) */
  active: boolean
  /** report the pane's connection status up to the tab strip */
  onStatusChange?: (status: ConnectionStatus) => void
  /** change the permission mode (persisted to the bridge) */
  onPermissionModeChange: (mode: PermissionMode) => void
  onSessionCreated: (realId: string) => void
  onConnectionFailed?: (() => void) | undefined
}) {
  // Freeze the id the pane opened with. A temp tab gains its real id after the
  // first prompt; once we have that stable identity, tear down the live socket
  // and replay the turn via `session/load`.
  const [initialSessionId] = useState(sessionId)
  const {
    state,
    status,
    error,
    awaiting,
    loadingHistory,
    ended,
    reloading,
    sendPrompt,
    cancel,
    ensureSession,
    reconnect,
    reload,
    disconnect,
    pendingPermission,
    respondPermission,
    getConfig,
    setConfig,
  } = useAgentSession({
    url: config.url,
    token: config.token,
    cwd,
    // Build the options object conditionally — exactOptionalPropertyTypes is on.
    ...(initialSessionId ? { sessionId: initialSessionId } : {}),
    permissionMode,
    active,
  })
  const [draft, setDraft] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [configSection, setConfigSection] =
    useState<"model" | "theme" | "provider" | "all">("all")

  useEffect(() => {
    // A failed stored connection falls back to the connect screen automatically.
    if (status === 'dead') onConnectionFailed?.()
  }, [status, onConnectionFailed])

  // Surface the pane's connection status to the tab strip dot. Only fire when it
  // actually changes so the parent state update is idempotent.
  const lastStatusRef = useRef<ConnectionStatus | null>(null)
  useEffect(() => {
    if (lastStatusRef.current === status) return
    lastStatusRef.current = status
    onStatusChange?.(status)
  }, [status, onStatusChange])

  // An idle (asleep) session stays typeable: sending a prompt reattaches the
  // agent automatically, so the user never waits on a manual reconnect first.
  const disabled = status !== 'ready' && status !== 'idle'

  async function submit() {
    const text = draft.trim()
    if (!text || disabled) return
    setDraft('')
    // Never create a session on mount; only the first prompt may.
    if (!sessionId) {
      const id = await ensureSession()
      if (id) onSessionCreated(id)
    }
    sendPrompt(text)
  }

  if (status === 'connecting') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <LoadingState variant="Spinner" labels={{ label: 'Connecting to agent' }} />
        <p className="text-sm text-ink-2">Connecting to agent…</p>
      </div>
    )
  }

  return (
    <ChatPane
      messages={state.messages}
      toolCalls={state.toolCalls}
      streaming={state.streaming}
      awaiting={awaiting}
      loadingHistory={loadingHistory}
      status={status}
      stopReason={state.stopReason}
      questions={pendingPermission?.questions ?? null}
      onAnswer={answers => respondPermission('allow', answers)}
      onDismissQuestions={() => respondPermission(null)}
      onReload={reload}
      onEnd={disconnect}
      reloading={reloading}
      ended={ended}
    >
      {pendingPermission && !pendingPermission.questions?.length ? (
        <div
          role="dialog"
          aria-modal="true"
          className="m-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]"
        >
          <p className="mb-3 text-sm text-ink-2">
            The agent wants to run <code>{pendingPermission.toolCall.toolCallId}</code>.
          </p>
          {error ? (
            <p role="alert" className="mb-3 text-sm text-red">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {pendingPermission.options.map(option => (
              <Button
                key={option.optionId}
                variant="accent"
                size="sm"
                onClick={() => respondPermission(option.optionId)}
              >
                {option.name}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => respondPermission(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        section={configSection}
        fetchConfig={getConfig}
        patchConfig={setConfig}
      />
      <PromptBar
        value={draft}
        onChange={next => {
          // A new session is created lazily on the first prompt. But the
          // composer's `/` menu needs the agent's advertised slash commands
          // (sent right after `session/new`), so kick off session creation the
          // moment the user types `/` rather than waiting for the send.
          if (!sessionId && next.startsWith('/')) void ensureSession()
          setDraft(next)
        }}
        onSend={submit}
        onCancel={cancel}
        disabled={disabled}
        streaming={state.streaming}
        modes={PERMISSION_MODE_OPTIONS}
        mode={permissionMode}
        onModeChange={id => {
          if (isPermissionMode(id)) onPermissionModeChange(id)
        }}
        labels={{ placeholder: disabled ? 'Connecting…' : 'Ask OpenClaude…' }}
        commands={state.commands}
        onCommandPick={name => {
          // Interactive commands render terminal UI and cannot run over ACP,
          // so open the studio's own panel for the ones we implement. Each
          // command lands on its own section instead of always showing model.
          if (name === 'config' || name === 'provider' || name === 'model' || name === 'theme') {
            setConfigSection(name === 'config' ? 'all' : name)
            setConfigOpen(true)
          }
        }}
      />
    </ChatPane>
  )
}

// Loads one workspace file for a document tab and hands it to the viewer.
// Each tab owns its own fetch so opening many files does not fight over state.
function DocumentTab({
  url,
  token,
  cwd,
  path,
}: {
  url: string
  token: string
  cwd: string
  path: string
}) {
  const { file, loading, error, saving, saveError, save } = useFileContent(url, token, cwd, path || null)
  return (
    <DocumentViewer
      source={{
        path,
        text: file?.text ?? '',
        truncated: file?.truncated ?? false,
        size: file?.size ?? 0,
        loading,
        error,
      }}
      onSave={text => {
        void save(text)
      }}
      saving={saving}
      saveError={saveError}
    />
  )
}
