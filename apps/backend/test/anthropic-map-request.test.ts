import { describe, it, expect } from 'vitest';
import { mapRequestToAnthropic } from '../src/providers/anthropic/map-request.js';
import type { NormalizedRequest } from '@ledesma-platform/shared';

const EPHEMERAL = { type: 'ephemeral' } as const;

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
    // system se emite en forma de arreglo con cache_control (prefijo estable cacheable).
    expect(params.system).toEqual([
      { type: 'text', text: 'Eres un agente de cotizaciones', cache_control: EPHEMERAL },
    ]);
    expect(params.temperature).toBe(0.2);
    expect(params.top_p).toBe(0.9);
    expect(params.stop_sequences).toEqual(['FIN']);
    expect(params.messages).toHaveLength(3);
    // El mensaje intermedio (assistant) no lleva breakpoint: solo el ultimo bloque del ultimo mensaje.
    expect(params.messages[1]?.content).toEqual([
      { type: 'text', text: 'Calculando' },
      { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
    ]);
    // Ultimo mensaje: su unico bloque recibe el breakpoint incremental de historial.
    expect(params.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: '1500 MXN', cache_control: EPHEMERAL },
    ]);
    // La (unica y por lo tanto ultima) tool lleva el breakpoint de tools.
    expect(params.tools?.[0]).toEqual({
      name: 'cotizar',
      description: 'Calcula el precio de N piezas',
      input_schema: { type: 'object', properties: { piezas: { type: 'number' } } },
      cache_control: EPHEMERAL,
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
    // Sin system ni tools, el breakpoint de historial sigue marcando el ultimo mensaje.
    expect(params.messages[0]?.content).toEqual([
      { type: 'text', text: 'hola', cache_control: EPHEMERAL },
    ]);
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

    // El ultimo bloque (la imagen) recibe el breakpoint de historial; el texto previo queda intacto.
    expect(params.messages[0]?.content).toEqual([
      { type: 'text', text: 'que dice esta factura' },
      {
        type: 'image',
        source: { type: 'url', url: 'https://cdn.example.com/f.png' },
        cache_control: EPHEMERAL,
      },
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
      {
        type: 'tool_result',
        tool_use_id: 'tu_9',
        content: 'fallo',
        is_error: true,
        cache_control: EPHEMERAL,
      },
    ]);
  });
});

describe('mapRequestToAnthropic: prompt caching (cache_control)', () => {
  const base: NormalizedRequest = {
    system: 'Sos un agente util',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'buscar', input: {} }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 't1', content: 'ok' },
          { type: 'text', text: 'segui' },
        ],
      },
    ],
    tools: [
      { name: 'buscar', description: 'busca', inputSchema: { type: 'object' } },
      { name: 'sumar', description: 'suma', inputSchema: { type: 'object' } },
    ],
    modelConfig: { model: 'claude-x', maxTokens: 512 },
  };

  it('coloca cache_control sobre system, la ultima tool y el ultimo bloque del historial', () => {
    const params = mapRequestToAnthropic(base);

    // system: prefijo estable cacheado.
    expect(Array.isArray(params.system)).toBe(true);
    expect((params.system as { cache_control?: unknown }[])[0]?.cache_control).toEqual(EPHEMERAL);

    // tools: SOLO la ultima lleva el breakpoint (las anteriores no).
    expect(params.tools?.[0]).not.toHaveProperty('cache_control');
    expect(params.tools?.[params.tools.length - 1]).toHaveProperty('cache_control', EPHEMERAL);

    // messages: el ULTIMO bloque del ULTIMO mensaje lleva el breakpoint incremental; los previos no.
    const lastMsg = params.messages[params.messages.length - 1];
    const content = lastMsg?.content as { cache_control?: unknown }[];
    expect(content[0]).not.toHaveProperty('cache_control'); // tool_result intermedio
    expect(content[content.length - 1]).toHaveProperty('cache_control', EPHEMERAL); // ultimo bloque
  });

  it('usa a lo sumo 3 breakpoints (la API permite 4)', () => {
    const params = mapRequestToAnthropic(base);
    const json = JSON.stringify(params);
    const count = (json.match(/"cache_control"/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(4);
    expect(count).toBe(3); // system + ultima tool + ultimo bloque de historial
  });

  it('marca la ultima tool aun sin system (agente con tools y sin prompt de sistema)', () => {
    const req: NormalizedRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      tools: [{ name: 'x', description: 'x', inputSchema: { type: 'object' } }],
      modelConfig: { model: 'claude-x', maxTokens: 256 },
    };
    const params = mapRequestToAnthropic(req);
    expect(params).not.toHaveProperty('system');
    expect(params.tools?.[0]).toHaveProperty('cache_control', EPHEMERAL);
  });
});
