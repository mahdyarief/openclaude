import { describe, expect, mock, test } from 'bun:test'

const persistCalls: unknown[][] = []
const liveCalls: unknown[][] = []

const persistModule = await import('../../src/utils/permissions/PermissionUpdate.js')
const liveModule = await import('../../src/utils/permissions/permissionSetup.js')
const originalPersist = persistModule.persistPermissionUpdates
const originalApply = liveModule.applyPermissionUpdatesToLiveContext

mock.module('../../src/utils/permissions/PermissionUpdate.js', () => ({
  ...persistModule,
  persistPermissionUpdates: (...args: Parameters<typeof originalPersist>) => {
    persistCalls.push(args)
  },
}))
mock.module('../../src/utils/permissions/permissionSetup.js', () => ({
  ...liveModule,
  applyPermissionUpdatesToLiveContext: (...args: Parameters<typeof originalApply>) => {
    liveCalls.push(args)
    return originalApply(...args)
  },
}))

const { unstable_v2_createSession } = await import('../../src/entrypoints/sdk/v2.js')

const rules = [
  {
    type: 'addRules',
    behavior: 'allow',
    destination: 'localSettings',
    rules: [{ toolName: 'Edit' }],
  },
]

describe('V2: response to external permission prompts', () => {
  test('applies and persists updatedPermissions for a permanently allowed tool', () => {
    persistCalls.length = 0
    liveCalls.length = 0
    const session = unstable_v2_createSession({ cwd: process.cwd() })
    const internals = session as unknown as {
      pendingPermissionPrompts: Map<string, { resolve: (value: unknown) => void }>
    }
    let resolved: unknown = null
    internals.pendingPermissionPrompts.set('tool-1', {
      resolve: value => {
        resolved = value
      },
    })

    session.respondToPermission('tool-1', {
      behavior: 'allow',
      decisionClassification: 'user_permanent',
      updatedPermissions: rules,
    } as never)

    expect(resolved).toMatchObject({
      behavior: 'allow',
      decisionClassification: 'user_permanent',
    })
    expect(liveCalls).toHaveLength(1)
    expect(liveCalls[0]![1]).toEqual(rules)
    expect(persistCalls).toHaveLength(1)
    expect(persistCalls[0]![0]).toEqual(rules)
  })

  test('applies deny rules and keeps the rejection classification', () => {
    persistCalls.length = 0
    liveCalls.length = 0
    const session = unstable_v2_createSession({ cwd: process.cwd() })
    const internals = session as unknown as {
      pendingPermissionPrompts: Map<string, { resolve: (value: unknown) => void }>
    }
    let resolved: unknown = null
    internals.pendingPermissionPrompts.set('tool-2', {
      resolve: value => {
        resolved = value
      },
    })

    session.respondToPermission('tool-2', {
      behavior: 'deny',
      message: 'Permission permanently denied by ACP client',
      decisionClassification: 'user_reject',
      updatedPermissions: [{ ...rules[0], behavior: 'deny' }],
    } as never)

    expect(resolved).toMatchObject({
      behavior: 'deny',
      decisionClassification: 'user_reject',
    })
    expect(persistCalls).toHaveLength(1)
    expect(liveCalls).toHaveLength(1)
  })

  test('temporary decisions never touch persistence', () => {
    persistCalls.length = 0
    liveCalls.length = 0
    const session = unstable_v2_createSession({ cwd: process.cwd() })
    const internals = session as unknown as {
      pendingPermissionPrompts: Map<string, { resolve: (value: unknown) => void }>
    }
    internals.pendingPermissionPrompts.set('tool-3', { resolve: () => {} })

    session.respondToPermission('tool-3', {
      behavior: 'allow',
      decisionClassification: 'user_temporary',
    } as never)

    expect(persistCalls).toEqual([])
    expect(liveCalls).toEqual([])
  })
})
