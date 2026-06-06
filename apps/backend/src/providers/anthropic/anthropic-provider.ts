import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelProvider,
  ProviderStreamEvent,
  ProviderStreamInput,
  StopReason,
} from '@ledesma-platform/shared';
import { mapRequestToAnthropic } from './map-request.js';
import { mapStopReason } from './map-stop-reason.js';
import { toProviderError } from '../errors.js';

interface PendingToolUse {
  id: string;
  name: string;
  jsonBuffer: string;
}

/**
 * Adaptador de Anthropic. Implementa el contrato ModelProvider traduciendo el stream de
 * eventos raw de Anthropic a eventos normalizados. BYOK: construye un cliente con la key
 * recibida por llamada y NO la guarda en ningun campo. No loguea credenciales ni contenido.
 */
export class AnthropicProvider implements ModelProvider {
  public readonly id = 'anthropic';

  async *stream(input: ProviderStreamInput): AsyncIterable<ProviderStreamEvent> {
    try {
      const client = new Anthropic({ apiKey: input.credentials.apiKey });
      const params = mapRequestToAnthropic(input.request);

      const stream = await client.messages.create(
        { ...params, stream: true },
        { signal: input.signal },
      );

      const toolBlocks = new Map<number, PendingToolUse>();
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: StopReason = 'end_turn';

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            inputTokens = event.message.usage.input_tokens ?? 0;
            break;
          }
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              toolBlocks.set(event.index, { id: block.id, name: block.name, jsonBuffer: '' });
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              const pending = toolBlocks.get(event.index);
              if (pending) {
                pending.jsonBuffer += delta.partial_json;
              }
            }
            break;
          }
          case 'content_block_stop': {
            const pending = toolBlocks.get(event.index);
            if (pending) {
              const trimmed = pending.jsonBuffer.trim();
              const parsedInput =
                trimmed === '' ? {} : (JSON.parse(trimmed) as Record<string, unknown>);
              yield { type: 'tool_use', id: pending.id, name: pending.name, input: parsedInput };
              toolBlocks.delete(event.index);
            }
            break;
          }
          case 'message_delta': {
            stopReason = mapStopReason(event.delta.stop_reason);
            if (event.usage?.output_tokens !== undefined && event.usage.output_tokens !== null) {
              outputTokens = event.usage.output_tokens;
            }
            break;
          }
          case 'message_stop': {
            break;
          }
          default:
            break;
        }
      }

      yield { type: 'stop', reason: stopReason, usage: { inputTokens, outputTokens } };
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }
}
