import { describe, it, expect } from 'vitest';
import { mapStopReason } from '../src/providers/anthropic/map-stop-reason.js';

describe('mapStopReason', () => {
  it('mapea las razones conocidas', () => {
    expect(mapStopReason('end_turn')).toBe('end_turn');
    expect(mapStopReason('tool_use')).toBe('tool_use');
    expect(mapStopReason('max_tokens')).toBe('max_tokens');
    expect(mapStopReason('stop_sequence')).toBe('stop_sequence');
  });

  it('mapea refusal a content_filter', () => {
    expect(mapStopReason('refusal')).toBe('content_filter');
  });

  it('usa end_turn como default para null o desconocido', () => {
    expect(mapStopReason(null)).toBe('end_turn');
    expect(mapStopReason(undefined)).toBe('end_turn');
    expect(mapStopReason('algo_raro')).toBe('end_turn');
  });
});
