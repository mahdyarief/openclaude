import type { StopReason } from '@openclaude-studio/acp'

const LABELS: Record<StopReason, string> = {
  end_turn: 'Finished',
  max_tokens: 'Stopped: token limit',
  max_turn_requests: 'Stopped: turn limit',
  refusal: 'Stopped: refused',
  cancelled: 'Cancelled',
}

export function formatStopReason(reason: StopReason | null): string {
  return reason ? LABELS[reason] : ''
}
