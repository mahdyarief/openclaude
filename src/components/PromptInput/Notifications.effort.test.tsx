import { expect, test } from 'bun:test'
import React from 'react'
import {
  AppStateProvider,
  getDefaultAppState,
} from '../../state/AppState.js'
import type { Message } from '../../types/message.js'
import { renderToString } from '../../utils/staticRender.js'
import { Notifications } from './Notifications.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0
  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }
  return lastFrame ?? output
}

test('does not render the effort indicator above the prompt', async () => {
  const frame = await renderToString(
    <AppStateProvider
      initialState={{
        ...getDefaultAppState(),
        mainLoopModelForSession: 'claude-opus-4-8',
        effortValue: 'high',
      }}
    >
      <Notifications
        apiKeyStatus="valid"
        autoUpdaterResult={{ version: null, status: 'success' }}
        debug={false}
        isAutoUpdating={false}
        verbose={false}
        messages={[] as Message[]}
        onAutoUpdaterResult={() => {}}
        onChangeIsUpdating={() => {}}
        ideSelection={undefined}
        mcpClients={undefined}
      />
    </AppStateProvider>,
    120,
  )

  expect(extractLastFrame(frame)).not.toContain('/effort')
})
