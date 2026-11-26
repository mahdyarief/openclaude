import { expect, test } from 'bun:test'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import * as React from 'react'
import { renderToString } from '../utils/staticRender.js'
import { AppStateProvider, getDefaultAppState } from '../state/AppState.js'
import type { PrStatusState } from '../hooks/usePrStatus.js'
import { StatusLine } from './StatusLine.js'

const NO_PR_STATUS: PrStatusState = {
  number: null,
  url: null,
  reviewState: null,
  lastUpdated: 0,
}

function statusLine(state: ReturnType<typeof getDefaultAppState>): Promise<string> {
  return renderToString(
    <AppStateProvider initialState={state}>
      <StatusLine
        messagesRef={{ current: [] }}
        lastAssistantMessageId={null}
        active={false}
        executeCommand={async () => undefined}
        prStatus={NO_PR_STATUS}
      />
    </AppStateProvider>,
    100,
  )
}

test('status line renders consecutive rows without blank gaps', async () => {
  const state = {
    ...getDefaultAppState(),
    statusLineText: 'model · ctx 12%\ncost · rate\nthird row',
  }

  const plain = stripAnsi(await statusLine(state))
  const rows = plain.trimEnd().split('\n')

  expect(rows).toHaveLength(3)
  expect(rows[0]?.trim()).toBe('model · ctx 12%')
  expect(rows[1]?.trim()).toBe('cost · rate')
  expect(rows[2]?.trim()).toBe('third row')
})
