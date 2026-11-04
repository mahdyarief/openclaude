import { getTotalCost, getTotalAPIDuration, getTotalInputTokens, getTotalLinesAdded, getTotalLinesRemoved, getTotalOutputTokens } from '../cost-tracker.js'
import { getSdkBetas, getTotalDuration } from '../bootstrap/state.js'
import { getCurrentSessionTitle } from '../utils/sessionStorage.js'
import { getSessionId, getOriginalCwd, getIsRemoteMode, getMainThreadAgentType } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { getSettings_DEPRECATED } from './settings/settings.js'
import { createBaseHookInput, executeStatusLineCommand } from './hooks.js'
import { DEFAULT_OUTPUT_STYLE_NAME } from '../constants/outputStyles.js'
import type { AppState } from '../state/AppState.js'
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js'
import { getDisplayedEffortLevel, modelSupportsEffort } from '../utils/effort.js'
import { getRuntimeMainLoopModel, parseUserSpecifiedModel, renderModelName, type ModelName } from '../utils/model/model.js'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage, getUnreportedSessionUsage } from '../utils/tokens.js'
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
  /** Active reasoning/effort level shown by the terminal statusline. */
  effort: string | null
  /** Custom plugin statusline content (e.g. Oh-my-Claude HUD / graft HUD). */
  statusLineText: string | null
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

  const effort = modelSupportsEffort(runtimeModel)
    ? getDisplayedEffortLevel(runtimeModel, appState.effortValue)
    : null

  // Custom plugin statusline content (e.g. Oh-my-Claude HUD). The terminal
  // renders this verbatim below its own badges; Studio shows it the same way.
  // The CLI fills `appState.statusLineText` via its React statusline hook, but
  // the ACP agent runs headless (no React tree), so we execute the configured
  // statusline command here and strip ANSI codes for safe web rendering.
  const statusLineText = await resolveCustomStatusLine(permissionMode, messages, mainLoopModel)

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
    effort,
    statusLineText,
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

/**
 * Run the user's configured statusline command (e.g. an Oh-my-Claude or graft
 * HUD) and return its trimmed, ANSI-free output. The terminal statusline does
 * this inside a React hook; the ACP agent runs headless with no React tree, so
 * we replicate the call here to surface the same custom content in Studio.
 *
 * Returns `null` when no command is configured or it produces no output.
 */
const STATUS_LINE_CACHE_MS = 1500
let statusLineCache: { at: number; value: string | null } | null = null
let statusLineInFlight: Promise<string | null> | null = null

async function resolveCustomStatusLine(
  permissionMode: PermissionMode,
  messages: Message[],
  mainLoopModel: ModelName,
): Promise<string | null> {
  // Most sessions have no custom statusline command; skip building the whole
  // hook payload for them. The statusline runs on every AppState change (150ms
  // debounce), so a short cache also keeps a streaming turn from spawning a
  // shell process per chunk.
  if (!getSettings_DEPRECATED()?.statusLine) return null
  if (statusLineCache && Date.now() - statusLineCache.at < STATUS_LINE_CACHE_MS) {
    return statusLineCache.value
  }
  if (statusLineInFlight) return statusLineInFlight

  statusLineInFlight = (async () => {
    const value = await runCustomStatusLine(permissionMode, messages, mainLoopModel)
    statusLineCache = { at: Date.now(), value }
    return value
  })().finally(() => {
    statusLineInFlight = null
  })
  return statusLineInFlight
}

async function runCustomStatusLine(
  permissionMode: PermissionMode,
  messages: Message[],
  mainLoopModel: ModelName,
): Promise<string | null> {
  try {
    const sessionId = getSessionId()
    const abort = new AbortController()
    const input = createBaseHookInput(permissionMode, sessionId, {
      agentType: getMainThreadAgentType(),
    })
    const runtimeModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel,
      exceeds200kTokens: doesMostRecentAssistantMessageExceed200k([...messages]),
    })
    const outputStyleName = getSettings_DEPRECATED()?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME
    const currentUsage = getCurrentUsage([...messages])
    const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas())
    const contextPercentages = calculateContextPercentages(currentUsage, contextWindowSize)
    const totalInputTokens = getTotalInputTokens()
    const totalOutputTokens = getTotalOutputTokens()
    const unreported = getUnreportedSessionUsage(messages)
    const resolvedTokenTotals = {
      totalInputTokens: totalInputTokens + (unreported?.input_tokens ?? 0),
      totalOutputTokens: totalOutputTokens + (unreported?.output_tokens ?? 0),
      totalTokensAreEstimated: unreported ? true : undefined,
    }

    const result = await executeStatusLineCommand(
      {
        ...input,
        session_name: getCurrentSessionTitle(sessionId) ?? undefined,
        model: { id: runtimeModel, display_name: renderModelName(runtimeModel) },
        workspace: {
          current_dir: getCwd(),
          project_dir: getOriginalCwd(),
          added_dirs: [],
        },
        version: MACRO.VERSION,
        output_style: { name: outputStyleName },
        cost: {
          total_cost_usd: getTotalCost(),
          total_duration_ms: getTotalDuration(),
          total_api_duration_ms: getTotalAPIDuration(),
          total_lines_added: getTotalLinesAdded(),
          total_lines_removed: getTotalLinesRemoved(),
        },
        context_window: {
          total_input_tokens: resolvedTokenTotals.totalInputTokens,
          total_output_tokens: resolvedTokenTotals.totalOutputTokens,
          total_tokens_are_estimated: resolvedTokenTotals.totalTokensAreEstimated,
          context_window_size: contextWindowSize,
          current_usage: currentUsage,
          used_percentage: contextPercentages.used,
          remaining_percentage: contextPercentages.remaining,
        },
        exceeds_200k_tokens: doesMostRecentAssistantMessageExceed200k([...messages]),
        ...(getIsRemoteMode() && { remote: { session_id: sessionId } }),
      },
      abort.signal,
    )

    if (!result) return null
    const cleaned = stripAnsi(result).replace(/\s+/g, ' ').trim()
    return cleaned || null
  } catch {
    return null
  }
}
