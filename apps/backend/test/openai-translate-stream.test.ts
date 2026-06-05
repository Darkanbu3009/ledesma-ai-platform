import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { translateOpenAIStream } from '../src/providers/openai/translate-stream.js';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';

function chunkStream(
  chunks: unknown[],
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })() as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
}

async function collect(
  stream: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

describe('translateOpenAIStream', () => {
  it('traduce texto a text_delta y stop con usage del chunk final', async () => {
    const events = await collect(
      translateOpenAIStream(
        chunkStream([
          { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
          { choices: [{ index: 0, delta: { content: 'Hola' }, finish_reason: null }] },
          { choices: [{ index: 0, delta: { content: ' mundo' }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]),
      ),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hola' },
      { type: 'text_delta', text: ' mundo' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
  });

  it('acumula arguments fragmentados y emite tool_use parseado', async () => {
    const events = await collect(
      translateOpenAIStream(
        chunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    { index: 0, id: 'call_1', type: 'function', function: { name: 'cotizar', arguments: '' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"piezas":' } }] }, finish_reason: null },
            ],
          },
          {
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '10}' } }] }, finish_reason: null },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
          { choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } },
        ]),
      ),
    );

    expect(events).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'cotizar', input: { piezas: 10 } },
      { type: 'stop', reason: 'tool_use', usage: { inputTokens: 20, outputTokens: 8 } },
    ]);
  });

  it('maneja varios tool calls por indice en orden', async () => {
    const events = await collect(
      translateOpenAIStream(
        chunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_a', type: 'function', function: { name: 'uno', arguments: '{}' } },
                    { index: 1, id: 'call_b', type: 'function', function: { name: 'dos', arguments: '{"x":1}' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
          { choices: [], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } },
        ]),
      ),
    );

    expect(events).toEqual([
      { type: 'tool_use', id: 'call_a', name: 'uno', input: {} },
      { type: 'tool_use', id: 'call_b', name: 'dos', input: { x: 1 } },
      { type: 'stop', reason: 'tool_use', usage: { inputTokens: 4, outputTokens: 6 } },
    ]);
  });

  it('mapea finish_reason length a max_tokens', async () => {
    const events = await collect(
      translateOpenAIStream(
        chunkStream([
          { choices: [{ index: 0, delta: { content: 'parcial' }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
        ]),
      ),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'parcial' },
      { type: 'stop', reason: 'max_tokens', usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });
});
