import { describe, it, expect } from 'vitest';
import type {
  NormalizedMessage,
  NormalizedRequest,
  ProviderStreamEvent,
  StopReason,
} from '../src/index.js';

describe('contrato normalizado', () => {
  it('modela un ida y vuelta de tool con todos los tipos de bloque', () => {
    const conversation: NormalizedMessage[] = [
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
    ];

    const request: NormalizedRequest = {
      system: 'Eres un agente de cotizaciones',
      messages: conversation,
      tools: [
        {
          name: 'cotizar',
          description: 'Calcula el precio de N piezas',
          inputSchema: {
            type: 'object',
            properties: { piezas: { type: 'number' } },
            required: ['piezas'],
          },
        },
      ],
      modelConfig: { model: 'modelo-x', maxTokens: 1024, temperature: 0.2 },
    };

    expect(request.messages).toHaveLength(3);
    expect(request.tools?.[0]?.name).toBe('cotizar');
    expect(request.messages[1]?.content[1]).toMatchObject({ type: 'tool_use', name: 'cotizar' });
  });

  it('cubre todas las razones de parada normalizadas', () => {
    const reasons: StopReason[] = [
      'end_turn',
      'tool_use',
      'max_tokens',
      'stop_sequence',
      'content_filter',
      'error',
    ];
    const events: ProviderStreamEvent[] = reasons.map((reason) => ({ type: 'stop', reason }));
    expect(events).toHaveLength(6);
    expect(events.every((e) => e.type === 'stop')).toBe(true);
  });
});
