import { describe, it, expect } from 'vitest';
import {
  FakeProvider,
  type ProviderStreamEvent,
  type ProviderStreamInput,
} from '../src/index.js';

async function collect(
  stream: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function baseInput(apiKey: string): ProviderStreamInput {
  return {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'fake-model', maxTokens: 256 },
    },
    credentials: { apiKey },
  };
}

describe('FakeProvider', () => {
  it('emite los eventos del guion en orden', async () => {
    const script: ProviderStreamEvent[] = [
      { type: 'text_delta', text: 'Hola' },
      { type: 'text_delta', text: ' mundo' },
      { type: 'stop', reason: 'end_turn' },
    ];
    const provider = new FakeProvider([script]);

    const events = await collect(provider.stream(baseInput('sk-test')));

    expect(events).toEqual(script);
  });

  it('registra cada llamada con la credencial BYOK recibida', async () => {
    const provider = new FakeProvider([[{ type: 'stop', reason: 'end_turn' }]]);

    await collect(provider.stream(baseInput('sk-byok-123')));

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.credentials.apiKey).toBe('sk-byok-123');
  });

  it('consume un guion distinto por llamada (multi-turno)', async () => {
    const provider = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'buscar', input: { q: 'precio' } },
        { type: 'stop', reason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: 'El resultado es 42' },
        { type: 'stop', reason: 'end_turn' },
      ],
    ]);

    const first = await collect(provider.stream(baseInput('sk-test')));
    const second = await collect(provider.stream(baseInput('sk-test')));

    expect(first[0]).toEqual({
      type: 'tool_use',
      id: 'tu_1',
      name: 'buscar',
      input: { q: 'precio' },
    });
    expect(first.find((e) => e.type === 'stop')).toEqual({ type: 'stop', reason: 'tool_use' });
    expect(second.find((e) => e.type === 'stop')).toEqual({ type: 'stop', reason: 'end_turn' });
    expect(provider.calls).toHaveLength(2);
  });

  it('devuelve un stream vacio cuando se agotan los guiones', async () => {
    const provider = new FakeProvider([[{ type: 'stop', reason: 'end_turn' }]]);

    await collect(provider.stream(baseInput('sk-test')));
    const overflow = await collect(provider.stream(baseInput('sk-test')));

    expect(overflow).toEqual([]);
  });

  it('expone id para logging', () => {
    const provider = new FakeProvider([]);
    expect(provider.id).toBe('fake');
  });
});
