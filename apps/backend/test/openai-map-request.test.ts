import { describe, it, expect } from 'vitest';
import { mapRequestToOpenAI, mapMessagesToOpenAI } from '../src/providers/openai/map-request.js';
import type { NormalizedRequest } from '@ledesma-platform/shared';

describe('mapMessagesToOpenAI', () => {
  it('antepone system y mapea user de texto', () => {
    const msgs = mapMessagesToOpenAI({
      system: 'Eres util',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'gpt-x', maxTokens: 100 },
    });
    expect(msgs[0]).toEqual({ role: 'system', content: 'Eres util' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hola' });
  });

  it('mapea assistant con texto y tool_use a content + tool_calls', () => {
    const msgs = mapMessagesToOpenAI({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Calculo' },
            { type: 'tool_use', id: 'call_1', name: 'cotizar', input: { piezas: 10 } },
          ],
        },
      ],
      modelConfig: { model: 'gpt-x', maxTokens: 100 },
    });
    expect(msgs[0]).toEqual({
      role: 'assistant',
      content: 'Calculo',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'cotizar', arguments: '{"piezas":10}' } },
      ],
    });
  });

  it('mapea un mensaje user con tool_result a mensajes role tool separados', () => {
    const msgs = mapMessagesToOpenAI({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'call_1', content: '1500 MXN' },
            { type: 'tool_result', toolUseId: 'call_2', content: '3000 MXN' },
          ],
        },
      ],
      modelConfig: { model: 'gpt-x', maxTokens: 100 },
    });
    expect(msgs).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '1500 MXN' },
      { role: 'tool', tool_call_id: 'call_2', content: '3000 MXN' },
    ]);
  });
});

describe('mapRequestToOpenAI', () => {
  it('arma params de streaming con usage y opcionales', () => {
    const request: NormalizedRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      tools: [
        {
          name: 'cotizar',
          description: 'Calcula precio',
          inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
        },
      ],
      modelConfig: {
        model: 'gpt-x',
        maxTokens: 512,
        temperature: 0.3,
        topP: 0.8,
        stopSequences: ['FIN'],
      },
    };

    const params = mapRequestToOpenAI(request);

    expect(params.model).toBe('gpt-x');
    expect(params.max_completion_tokens).toBe(512);
    expect(params.stream).toBe(true);
    expect(params.stream_options).toEqual({ include_usage: true });
    expect(params.temperature).toBe(0.3);
    expect(params.top_p).toBe(0.8);
    expect(params.stop).toEqual(['FIN']);
    expect(params.tools?.[0]).toEqual({
      type: 'function',
      function: {
        name: 'cotizar',
        description: 'Calcula precio',
        parameters: { type: 'object', properties: { piezas: { type: 'number' } } },
      },
    });
  });

  it('omite opcionales cuando no estan definidos', () => {
    const params = mapRequestToOpenAI({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'gpt-x', maxTokens: 256 },
    });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('stop');
    expect(params).not.toHaveProperty('tools');
  });
});
