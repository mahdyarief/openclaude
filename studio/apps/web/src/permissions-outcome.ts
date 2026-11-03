import type { RequestPermissionResponse } from '@openclaude-studio/acp'

/**
 * Builds the ACP `session/request_permission` response.
 *
 * `AskUserQuestion` answers are not part of the ACP schema, so they ride on
 * `_meta.answers` of the selected outcome, keyed by question text. The agent
 * lifts them back into `updatedInput.answers` before resolving the tool.
 */
export function buildPermissionOutcome(
  optionId: string | null,
  answers?: Record<string, string> | null,
): RequestPermissionResponse {
  if (!optionId) return { outcome: { outcome: 'cancelled' } }
  return {
    outcome: {
      outcome: 'selected',
      optionId,
      ...(answers ? { _meta: { answers } } : {}),
    },
  }
}
