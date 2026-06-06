import { describe, it, expect, vi } from 'vitest';
import { FakeProvider } from '@ledesma-platform/shared';
import type { NormalizedRequest, ProviderId, ProviderStreamEvent } from '@ledesma-platform/shared';
import { runModel } from '../src/providers/run-model.js';

const request: NormalizedRequest = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
  modelConfig: { model: 'm', maxTokens: 128 },
};

async function collect(
  stream: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

describe('runModel', () => {
  it('selecciona el provider por id y le pasa request, credentials y signal', async () => {
    const fake = new FakeProvider([[{ type: 'stop', reason: 'end_turn' }]]);
    const createProviderMock = vi.fn<(id: ProviderId) => FakeProvider>(() => fake);
    const controller = new AbortController();

    const events = await collect(
      runModel(
        {
          providerId: 'anthropic',
          credentials: { apiKey: 'sk-byok-123' },
          request,
          signal: controller.signal,
        },
        { createProvider: createProviderMock },
      ),
    );

    expect(createProviderMock).toHaveBeenCalledWith('anthropic');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.credentials.apiKey).toBe('sk-byok-123');
    expect(fake.calls[0]?.request).toEqual(request);
    expect(fake.calls[0]?.signal).toBe(controller.signal);
    expect(events).toEqual([{ type: 'stop', reason: 'end_turn' }]);
  });

  it('pasa baseUrl en las credenciales cuando esta presente', async () => {
    const fake = new FakeProvider([[{ type: 'stop', reason: 'end_turn' }]]);

    await collect(
      runModel(
        {
          providerId: 'openai-compatible',
          credentials: { apiKey: 'sk-A', baseUrl: 'https://openrouter.ai/api/v1' },
          request,
        },
        { createProvider: () => fake },
      ),
    );

    expect(fake.calls[0]?.credentials.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('usa la key de cada llamada sin filtrarla entre llamadas', async () => {
    const fake = new FakeProvider([
      [{ type: 'stop', reason: 'end_turn' }],
      [{ type: 'stop', reason: 'end_turn' }],
    ]);
    const deps = { createProvider: () => fake };

    await collect(runModel({ providerId: 'openai', credentials: { apiKey: 'sk-A' }, request }, deps));
    await collect(runModel({ providerId: 'openai', credentials: { apiKey: 'sk-B' }, request }, deps));

    expect(fake.calls[0]?.credentials.apiKey).toBe('sk-A');
    expect(fake.calls[1]?.credentials.apiKey).toBe('sk-B');
  });

  it('no escribe la key en consola durante la ejecucion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const fake = new FakeProvider([
      [
        { type: 'text_delta', text: 'hola' },
        { type: 'stop', reason: 'end_turn' },
      ],
    ]);

    await collect(
      runModel(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-super-secreta-999' }, request },
        { createProvider: () => fake },
      ),
    );

    const allOutput = [
      ...logSpy.mock.calls,
      ...errSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...infoSpy.mock.calls,
    ]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    expect(allOutput).not.toContain('sk-super-secreta-999');

    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('el stream de retorno nunca contiene la key', async () => {
    const fake = new FakeProvider([
      [
        { type: 'text_delta', text: 'ok' },
        { type: 'stop', reason: 'end_turn' },
      ],
    ]);

    const events = await collect(
      runModel(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-leak-test' }, request },
        { createProvider: () => fake },
      ),
    );

    expect(JSON.stringify(events)).not.toContain('sk-leak-test');
  });

  it('propaga el error de un provider desconocido al seleccionar', () => {
    expect(() =>
      runModel({ providerId: 'mistral' as never, credentials: { apiKey: 'sk' }, request }),
    ).toThrow('unknown provider: mistral');
  });
});
