import type { StopReason } from '@ledesma-platform/shared';

/** Traduce el stop_reason de Anthropic a la razon de parada normalizada del contrato. */
export function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'content_filter';
    default:
      return 'end_turn';
  }
}
