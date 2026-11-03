import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppShell,
  Button,
  ChatPane,
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
  type PermissionMode,
} from '@openclaude-studio/acp'
import type { BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'
import { useAgentSession } from './use-agent-session.js'
import { useFileContent, useFileTree } from './use-file-tree.js'
import { groupSessions, useProjectSessions } from './use-projects.js'
import { useTabs, type Tab } from './use-tabs.js'
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
  }, [openSessions])

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
                  onPermissionModeChange={onPermissionModeChange}
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
  onPermissionModeChange,
  onSessionCreated,
  onConnectionFailed,
}: {
  config: BridgeConfig
  cwd: string
  sessionId?: string | undefined
  /** current agent permission mode, server-backed */
  permissionMode: PermissionMode
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
    sendPrompt,
    cancel,
    ensureSession,
    pendingPermission,
    respondPermission,
  } = useAgentSession({
    url: config.url,
    token: config.token,
    cwd,
    // Build the options object conditionally — exactOptionalPropertyTypes is on.
    ...(initialSessionId ? { sessionId: initialSessionId } : {}),
  })
  const [draft, setDraft] = useState('')

  useEffect(() => {
    // A failed stored connection falls back to the connect screen automatically.
    if (status === 'dead') onConnectionFailed?.()
  }, [status, onConnectionFailed])

  const disabled = status !== 'ready'

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
    >
      {pendingPermission ? (
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
      <PromptBar
        value={draft}
        onChange={setDraft}
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
