import { getTotalCost } from '../cost-tracker.js'
import { getSdkBetas, getTotalDuration } from '../bootstrap/state.js'
import { getCurrentSessionTitle } from '../utils/sessionStorage.js'
import { getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js'
import { getRuntimeMainLoopModel, parseUserSpecifiedModel, renderModelName } from '../utils/model/model.js'
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage } from '../utils/tokens.js'
import { getBranch } from '../utils/git.js'
import { getCurrentWorktreeSession } from '../utils/worktree.js'
import { isBackgroundTask } from '../tasks/types.js'
import type { TaskStateBase } from '../Task.js'
import type { PermissionMode } from '../types/permissions.js'
import type { Message } from '../types/message.js'
import type { SDKMessage } from '../entrypoints/sdk/shared.js'

/**
 * Structured snapshot of the same data the terminal statusline renders.
 *
 * This is the payload Studio asks for over the `openclaude/status` ACP
 * method. It is intentionally a *subset* of `StatusLineCommandInput` — the
 * fields Studio can render as badges — and is derived from the same helpers
 * `StatusLine.tsx` uses, so the two cannot drift.
 */
export type StatusSnapshot = {
  model: {
    id: string
    displayName: string
  }
  branch: string | null
  worktree: {
    name: string | null
    path: string | null
    branch: string | null
  } | null
  permissionMode: PermissionMode
  contextWindow: {
    usedPercent: number
    tokens: number
    size: number
  } | null
  session: {
    name: string | null
    costUsd: number
    durationMs: number
  }
  backgroundTasks: {
    total: number
    running: number
    labels: string[]
  }
}

/** Derive the branch name from the worktree session when available, falling
 *  back to `getBranch()` for plain (non-worktree) sessions. */
async function resolveBranch(): Promise<string | null> {
  const worktree = getCurrentWorktreeSession()
  if (worktree?.worktreeBranch) return worktree.worktreeBranch
  if (worktree?.originalBranch) return worktree.originalBranch
  try {
    const branch = await getBranch()
    return typeof branch === 'string' && branch.length > 0 ? branch : null
  } catch {
    return null
  }
}

/**
 * SDK messages are the internal messages with the SDK's field naming, so the
 * token/context helpers (which only read `type` and `message.*`) work on them
 * unchanged. The cast is confined here rather than leaking into callers.
 */
function asInternalMessages(messages: readonly SDKMessage[]): Message[] {
  return messages as unknown as Message[]
}

/** Build a `StatusSnapshot` from live agent state. Safe to call outside the
 * React render loop — it only reads global state and async git info. */
export async function buildStatusSnapshot(
  appState: AppState,
  sdkMessages: readonly SDKMessage[],
): Promise<StatusSnapshot> {
  const messages = asInternalMessages(sdkMessages)
  const permissionMode = appState.toolPermissionContext.mode
  const mainLoopModel = parseUserSpecifiedModel(
    appState.mainLoopModel ?? appState.mainLoopModelForSession ?? 'sonnet',
  )
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens: doesMostRecentAssistantMessageExceed200k([...messages]),
  })

  const currentUsage = getCurrentUsage([...messages])
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas())
  const contextPercentages = calculateContextPercentages(currentUsage, contextWindowSize)

  const worktree = getCurrentWorktreeSession()

  const backgroundTasks = Object.values(appState.tasks ?? {}).filter(isBackgroundTask)
  const labels = backgroundTasks
    .map(task => {
      const label = typeof (task as TaskStateBase).description === 'string'
        ? (task as TaskStateBase).description
        : (task as TaskStateBase).type
      return (label ?? '').trim()
    })
    .filter(Boolean)

  const sessionId = getSessionId()
  const sessionName = getCurrentSessionTitle(sessionId)

  return {
    model: {
      id: runtimeModel,
      displayName: renderModelName(runtimeModel),
    },
    branch: await resolveBranch(),
    worktree: worktree
      ? {
          name: worktree.worktreeName ?? null,
          path: worktree.worktreePath ?? null,
          branch: worktree.worktreeBranch ?? null,
        }
      : null,
    permissionMode,
    contextWindow:
      contextPercentages.used === null
        ? null
        : {
            usedPercent: contextPercentages.used,
            tokens: currentUsage
              ? currentUsage.input_tokens +
                currentUsage.cache_creation_input_tokens +
                currentUsage.cache_read_input_tokens
              : 0,
            size: contextWindowSize,
          },
    session: {
      name: sessionName ?? null,
      costUsd: getTotalCost(),
      durationMs: getTotalDuration(),
    },
    backgroundTasks: {
      total: backgroundTasks.length,
      running: backgroundTasks.filter(task => task.status === 'running').length,
      labels,
    },
  }
}
