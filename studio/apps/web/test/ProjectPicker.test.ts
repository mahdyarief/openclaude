import { describe, expect, test } from 'vitest'
import { manualProject, matchesQuery } from '../src/ProjectPicker.js'

describe('manualProject', () => {
  test('names a manual project after its folder', () => {
    expect(manualProject('/home/dy/code/app')).toEqual({
      path: '/home/dy/code/app',
      name: 'app',
    })
  })

  test('returns null for an empty path', () => {
    expect(manualProject('   ')).toBeNull()
  })
})

describe('matchesQuery', () => {
  test('empty query matches every field', () => {
    expect(matchesQuery('  ', 'anything', 'else')).toBe(true)
  })
  test('matches any supplied field, case-insensitively', () => {
    expect(matchesQuery('CODE', 'src/Code/app', 'x')).toBe(true)
    expect(matchesQuery('app', 'src/code/APP', 'y')).toBe(true)
    expect(matchesQuery('zzz', 'src/code/app', 'nope')).toBe(false)
  })
})
