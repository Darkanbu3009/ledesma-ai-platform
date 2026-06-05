import { describe, it, expect } from 'vitest';
import { mapFinishReason } from '../src/providers/openai/map-finish-reason.js';

describe('mapFinishReason', () => {
  it('mapea las razones conocidas', () => {
    expect(mapFinishReason('stop')).toBe('end_turn');
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('function_call')).toBe('tool_use');
    expect(mapFinishReason('length')).toBe('max_tokens');
    expect(mapFinishReason('content_filter')).toBe('content_filter');
  });

  it('usa end_turn como default para null o desconocido', () => {
    expect(mapFinishReason(null)).toBe('end_turn');
    expect(mapFinishReason(undefined)).toBe('end_turn');
    expect(mapFinishReason('raro')).toBe('end_turn');
  });
});
