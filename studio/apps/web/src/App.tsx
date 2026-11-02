import { useState } from 'react'
import { ConnectScreen } from './ConnectScreen.js'
import { ProjectPicker } from './ProjectPicker.js'
import { Workbench } from './Workbench.js'
import { readBridgeConfig, saveBridgeConfig, type BridgeConfig } from './bridge-config.js'
import type { ActiveProject } from './project-store.js'
import { useUiState } from './use-ui-state.js'

export function App() {
  const [config, setConfig] = useState<BridgeConfig | null>(() =>
    readBridgeConfig(window.location.search, localStorage, window.location.hostname),
  )
  const [failed, setFailed] = useState(false)
  const [picking, setPicking] = useState(false)
  const ui = useUiState(config)

  if (!config || failed) {
    return (
      <ConnectScreen
        initial={config}
        onConnect={next => {
          saveBridgeConfig(localStorage, next)
          setFailed(false)
          setConfig(next)
        }}
      />
    )
  }

  function addProject(next: ActiveProject) {
    ui.addProject(next)
    setPicking(false)
  }

  if (!ui.active) {
    return (
      <ProjectPicker
        config={config}
        onSelect={addProject}
        onDisconnect={() => {
          localStorage.removeItem('openclaude.bridge')
          setConfig(null)
        }}
      />
    )
  }

  return (
    <>
      <Workbench
        config={config}
        project={ui.active}
        projects={ui.projects}
        openSessions={ui.openSessions}
        onOpenSessionsChange={ui.setOpenSessions}
        onAddProject={() => setPicking(true)}
        onSwitchProject={ui.switchProject}
        onRemoveProject={ui.removeProject}
        onConnectionFailed={() => {
          localStorage.removeItem('openclaude.bridge')
          setFailed(true)
        }}
      />
      {picking ? (
        <ProjectPicker
          config={config}
          onSelect={addProject}
          onDisconnect={() => {
            localStorage.removeItem('openclaude.bridge')
            setConfig(null)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  )
}
