import { describe, expect, test } from 'vitest'
import { groupSessions } from '../src/use-projects.js'

describe('groupSessions', () => {
  test('marks the active session', () => {
    const sessions = [
      { id: 'a', title: 'A', updatedAt: 2, messageCount: 1 },
      { id: 'b', title: 'B', updatedAt: 1, messageCount: 1 },
    ]
    expect(groupSessions(sessions, 'b')).toEqual([
      { id: 'a', title: 'A', active: false },
      { id: 'b', title: 'B', active: true },
    ])
  })

  test('marks nothing active when activeId is null', () => {
    const sessions = [{ id: 'a', title: 'A', updatedAt: 1, messageCount: 1 }]
    expect(groupSessions(sessions, null)).toEqual([{ id: 'a', title: 'A', active: false }])
  })

  test('returns an empty list for no sessions', () => {
    expect(groupSessions([], 'a')).toEqual([])
  })
})
