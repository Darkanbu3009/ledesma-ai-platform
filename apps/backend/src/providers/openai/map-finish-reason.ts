import type { StopReason } from '@ledesma-platform/shared';

/** Traduce el finish_reason de OpenAI a la razon de parada normalizada del contrato. */
export function mapFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'end_turn';
  }
}
