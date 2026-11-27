import { describe, expect, test } from 'vitest'
import {
  clearActiveProject,
  folderName,
  forgetProject,
  readActiveProject,
  readProjectList,
  rememberProject,
  saveActiveProject,
} from '../src/project-store.js'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('project store', () => {
  test('round-trips an active project', () => {
    const storage = memoryStorage()
    saveActiveProject(storage, { path: 'D:/work/app', name: 'app' })
    expect(readActiveProject(storage)).toEqual({ path: 'D:/work/app', name: 'app' })
  })

  test('returns null for malformed stored json', () => {
    const storage = memoryStorage({ 'openclaude.project': '{oops' })
    expect(readActiveProject(storage)).toBeNull()
  })

  test('returns null when storage is null', () => {
    expect(readActiveProject(null)).toBeNull()
  })

  test('clears the active project', () => {
    const storage = memoryStorage()
    saveActiveProject(storage, { path: 'D:/work/app', name: 'app' })
    clearActiveProject(storage)
    expect(readActiveProject(storage)).toBeNull()
  })
})

describe('folderName', () => {
  test('takes the last POSIX segment', () => {
    expect(folderName('/home/dy/code/openclaude-studio')).toBe('openclaude-studio')
  })
  test('takes the last Windows segment', () => {
    expect(folderName('D:\\Github\\agent-workspace\\_wb_tmp\\ocs')).toBe('ocs')
  })
  test('ignores trailing separators', () => {
    expect(folderName('/home/dy/code/app/')).toBe('app')
  })
  test('returns the input when there is no segment', () => {
    expect(folderName('/')).toBe('/')
  })
})

describe('pinned workspace list', () => {
  test('rememberProject keeps insertion order and dedupes by path', () => {
    const storage = memoryStorage()
    rememberProject(storage, { path: 'D:/a', name: 'a' })
    rememberProject(storage, { path: 'D:/b', name: 'b' })
    rememberProject(storage, { path: 'D:/a', name: 'a-renamed' })
    expect(readProjectList(storage).map(p => p.path)).toEqual(['D:/a', 'D:/b'])
  })

  test('forgetProject drops only the named workspace', () => {
    const storage = memoryStorage()
    rememberProject(storage, { path: 'D:/a', name: 'a' })
    rememberProject(storage, { path: 'D:/b', name: 'b' })
    const remaining = forgetProject(storage, 'D:/a')
    expect(remaining).toEqual([{ path: 'D:/b', name: 'b' }])
    expect(readProjectList(storage)).toEqual([{ path: 'D:/b', name: 'b' }])
  })

  test('forgetProject on an unknown path leaves the list untouched', () => {
    const storage = memoryStorage()
    rememberProject(storage, { path: 'D:/a', name: 'a' })
    expect(forgetProject(storage, 'D:/nope')).toEqual([{ path: 'D:/a', name: 'a' }])
  })
})
