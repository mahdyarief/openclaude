import { describe, expect, test } from 'vitest'
import {
  defaultBridgeUrl,
  isReachableFrom,
  readBridgeConfig,
  saveBridgeConfig,
} from '../src/bridge-config.js'

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

describe('bridge config', () => {
  test('prefers query parameters over stored values', () => {
    const storage = memoryStorage({
      'openclaude.bridge': JSON.stringify({ url: 'ws://stored', token: 'stored' }),
    })

    expect(readBridgeConfig('?bridge=ws%3A%2F%2Fquery&token=t1', storage)).toEqual({
      url: 'ws://query',
      token: 't1',
    })
  })

  test('falls back to storage when the query is empty', () => {
    const storage = memoryStorage({
      'openclaude.bridge': JSON.stringify({ url: 'ws://stored', token: 'stored' }),
    })

    expect(readBridgeConfig('', storage)).toEqual({
      url: 'ws://stored',
      token: 'stored',
    })
  })

  test('returns null when nothing is configured', () => {
    expect(readBridgeConfig('', memoryStorage())).toBeNull()
  })

  test('ignores malformed stored json', () => {
    const storage = memoryStorage({ 'openclaude.bridge': '{oops' })
    expect(readBridgeConfig('', storage)).toBeNull()
  })

  test('persists a config', () => {
    const storage = memoryStorage()
    saveBridgeConfig(storage, { url: 'ws://x', token: 'y' })
    expect(readBridgeConfig('', storage)).toEqual({ url: 'ws://x', token: 'y' })
  })

  test('derives the bridge url from the page host', () => {
    expect(defaultBridgeUrl('100.84.56.62')).toBe('ws://100.84.56.62:8787')
  })

  test('treats a loopback bridge as unreachable from a remote host', () => {
    expect(isReachableFrom('ws://127.0.0.1:8787', '100.84.56.62')).toBe(false)
    expect(isReachableFrom('ws://100.84.56.62:8787', '100.84.56.62')).toBe(true)
  })

  test('re-points a loopback stored config to the serving host', () => {
    const storage = memoryStorage({
      'openclaude.bridge': JSON.stringify({ url: 'ws://127.0.0.1:8787', token: 't' }),
    })
    expect(readBridgeConfig('', storage, '100.84.56.62')).toEqual({
      url: 'ws://100.84.56.62:8787',
      token: 't',
    })
  })
})