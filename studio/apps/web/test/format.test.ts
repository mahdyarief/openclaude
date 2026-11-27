import { describe, expect, test } from 'vitest'
import { formatStopReason } from '../src/format.js'

describe('formatStopReason', () => {
  test('maps end_turn to a human label', () => {
    expect(formatStopReason('end_turn')).toBe('Finished')
  })

  test('maps max_tokens', () => {
    expect(formatStopReason('max_tokens')).toBe('Stopped: token limit')
  })

  test('maps cancelled', () => {
    expect(formatStopReason('cancelled')).toBe('Cancelled')
  })

  test('falls back for null', () => {
    expect(formatStopReason(null)).toBe('')
  })
})
