import { describe, expect, test } from 'vitest'
import { sessionMode } from '../src/use-agent-session.js'

describe('sessionMode', () => {
  test('loads when a session id is present', () => {
    expect(sessionMode('abc')).toEqual({ kind: 'load', sessionId: 'abc' })
  })
  test('defers creation when no session id is present', () => {
    expect(sessionMode(undefined)).toEqual({ kind: 'new' })
  })
})
