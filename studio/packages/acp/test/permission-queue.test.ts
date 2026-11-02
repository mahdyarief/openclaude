import { describe, expect, test } from 'vitest'
import { createSessionStore } from '../src/session-store.js'

const request = {
  requestId: 'call-1',
  sessionId: 's1',
  toolCall: { toolCallId: 'call-1', title: 'Write file' },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
}

describe('permission queue', () => {
  test('enqueues a permission request', () => {
    const store = createSessionStore('s1', '/work')
    store.enqueuePermission(request)
    expect(store.getState().permissionQueue).toHaveLength(1)
  })

  test('resolving removes exactly one request', () => {
    const store = createSessionStore('s1', '/work')
    store.enqueuePermission(request)
    store.enqueuePermission({ ...request, requestId: 'call-2' })
    store.resolvePermission('call-1')
    expect(store.getState().permissionQueue.map(item => item.requestId)).toEqual([
      'call-2',
    ])
  })

  test('resolving an unknown id leaves the queue unchanged', () => {
    const store = createSessionStore('s1', '/work')
    store.enqueuePermission(request)
    store.resolvePermission('missing')
    expect(store.getState().permissionQueue).toHaveLength(1)
  })
})
