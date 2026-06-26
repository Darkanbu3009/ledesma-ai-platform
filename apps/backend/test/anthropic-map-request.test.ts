import { describe, it, expect } from 'vitest';
import { mapRequestToAnthropic } from '../src/providers/anthropic/map-request.js';
import type { NormalizedRequest } from '@ledesma-platform/shared';

describe('mapRequestToAnthropic', () => {
  it('mapea system, mensajes con los tres tipos de bloque, tools y params', () => {
    const request: NormalizedRequest = {
      system: 'Eres un agente de cotizaciones',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'cotiza 10 piezas' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Calculando' },
            { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'tu_1', content: '1500 MXN' }],
        },
      ],
      tools: [
        {
          name: 'cotizar',
          description: 'Calcula el precio de N piezas',
          inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
        },
      ],
      modelConfig: {
        model: 'claude-x',
        maxTokens: 1024,
        temperature: 0.2,
        topP: 0.9,
        stopSequences: ['FIN'],
      },
    };

    const params = mapRequestToAnthropic(request);

    expect(params.model).toBe('claude-x');
    expect(params.max_tokens).toBe(1024);
    expect(params.system).toBe('Eres un agente de cotizaciones');
    expect(params.temperature).toBe(0.2);
    expect(params.top_p).toBe(0.9);
    expect(params.stop_sequences).toEqual(['FIN']);
    expect(params.messages).toHaveLength(3);
    expect(params.messages[1]?.content).toEqual([
      { type: 'text', text: 'Calculando' },
      { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
    ]);
    expect(params.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: '1500 MXN' },
    ]);
    expect(params.tools?.[0]).toEqual({
      name: 'cotizar',
      description: 'Calcula el precio de N piezas',
      input_schema: { type: 'object', properties: { piezas: { type: 'number' } } },
    });
  });

  it('omite los opcionales cuando no estan definidos', () => {
    const request: NormalizedRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'claude-x', maxTokens: 256 },
    };

    const params = mapRequestToAnthropic(request);

    expect(params).not.toHaveProperty('system');
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('stop_sequences');
    expect(params).not.toHaveProperty('tools');
  });

  it('mapea un ImageBlock a la forma de imagen del SDK con source url', () => {
    const request: NormalizedRequest = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'que dice esta factura' },
            {
              type: 'image',
              source: { kind: 'url', url: 'https://cdn.example.com/f.png', mimeType: 'image/png' },
            },
          ],
        },
      ],
      modelConfig: { model: 'claude-x', maxTokens: 256 },
    };

    const params = mapRequestToAnthropic(request);

    expect(params.messages[0]?.content).toEqual([
      { type: 'text', text: 'que dice esta factura' },
      { type: 'image', source: { type: 'url', url: 'https://cdn.example.com/f.png' } },
    ]);
  });

  it('marca is_error en tool_result cuando isError es true', () => {
    const request: NormalizedRequest = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'tu_9', content: 'fallo', isError: true }],
        },
      ],
      modelConfig: { model: 'claude-x', maxTokens: 256 },
    };

    const params = mapRequestToAnthropic(request);

    expect(params.messages[0]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_9', content: 'fallo', is_error: true },
    ]);
  });
});
