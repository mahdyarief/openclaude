import { describe, expect, test } from 'vitest'
import { sessionMode } from '../src/use-agent-session.js'
import { buildPermissionOutcome } from '../src/permissions-outcome.js'

describe('sessionMode', () => {
  test('loads when a session id is present', () => {
    expect(sessionMode('abc')).toEqual({ kind: 'load', sessionId: 'abc' })
  })
  test('defers creation when no session id is present', () => {
    expect(sessionMode(undefined)).toEqual({ kind: 'new' })
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
