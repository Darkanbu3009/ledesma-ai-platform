import type OpenAI from 'openai';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';
import { mapFinishReason } from './map-finish-reason.js';

interface PendingToolCall {
  id: string;
  name: string;
  argsBuffer: string;
}

/**
 * Traduce el stream de chunks de OpenAI (Chat Completions) a eventos normalizados.
 * Funcion pura sobre un async iterable; reutilizable por el adaptador OpenAI y por el
 * adaptador OpenAI-compatible (P1.4). Acumula los argumentos fragmentados de cada tool call
 * (indexados) y emite tool_use con el input parseado al cierre del stream.
 */
export async function* translateOpenAIStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): AsyncIterable<ProviderStreamEvent> {
  const toolCalls = new Map<number, PendingToolCall>();
  let finishReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
    }

    const choice = chunk.choices[0];
    if (!choice) {
      continue;
    }

    const delta = choice.delta;
    if (delta?.content) {
      yield { type: 'text_delta', text: delta.content };
    }

    if (delta?.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        let pending = toolCalls.get(toolCall.index);
        if (!pending) {
          pending = { id: '', name: '', argsBuffer: '' };
          toolCalls.set(toolCall.index, pending);
        }
        if (toolCall.id) {
          pending.id = toolCall.id;
        }
        if (toolCall.function?.name) {
          pending.name = toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          pending.argsBuffer += toolCall.function.arguments;
        }
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  const orderedIndices = [...toolCalls.keys()].sort((a, b) => a - b);
  for (const index of orderedIndices) {
    const pending = toolCalls.get(index);
    if (!pending) {
      continue;
    }
    const trimmed = pending.argsBuffer.trim();
    const parsedInput = trimmed === '' ? {} : (JSON.parse(trimmed) as Record<string, unknown>);
    yield { type: 'tool_use', id: pending.id, name: pending.name, input: parsedInput };
  }

  yield {
    type: 'stop',
    reason: mapFinishReason(finishReason),
    usage: { inputTokens, outputTokens },
  };
}
