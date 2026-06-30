import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos la capa de modelo para no llamar APIs reales: el endpoint usa runModel internamente
// a traves de runAgent. Interceptamos en el punto de la capa de modelo.
const { runModelMock } = vi.hoisted(() => ({ runModelMock: vi.fn() }));

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';

function streamOf(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

/** Parsea un cuerpo SSE en una lista de { event, data }. */
function parseSse(raw: string): Array<{ event: string; data: unknown }> {
  const blocks = raw.split('\n\n').filter((b) => b.trim() !== '');
  return blocks.map((block) => {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    return { event, data: data === '' ? undefined : JSON.parse(data) };
  });
}

let app: FastifyInstance;

beforeEach(async () => {
  runModelMock.mockReset();
  app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }));
});

describe('POST /v1/agent/run', () => {
  it('rechaza con 400 si falta el header x-provider-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza con 400 si el body es invalido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'marte', model: '', messages: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('responde SSE con los eventos del agente y un evento done', async () => {
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
      ]),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.payload);
    expect(events).toContainEqual({ event: 'message', data: { type: 'text_delta', text: 'Hola' } });
    expect(events).toContainEqual({
      event: 'message',
      data: { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
    });
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
  });

  it('una peticion normal no se auto-cancela: no emite evento error', async () => {
    runModelMock.mockReturnValue(
      (async function* () {
        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
      })(),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });
    const events = parseSse(res.payload);
    expect(events.some((e) => e.event === 'error')).toBe(false);
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
  });

  it('pasa la key del header como credencial BYOK a la capa de modelo', async () => {
    runModelMock.mockReturnValue(streamOf([{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-byok-real' },
      payload: { providerId: 'openai', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(runModelMock).toHaveBeenCalled();
    const call = runModelMock.mock.calls[0]?.[0];
    expect(call?.credentials?.apiKey).toBe('sk-byok-real');
    expect(call?.providerId).toBe('openai');
  });

  it('emite un evento SSE error (no status) cuando el modelo falla', async () => {
    const { ProviderError } = await import('../src/providers/errors.js');
    runModelMock.mockReturnValue(
      // Stream que falla al primer next(): simula un error del proveedor durante la iteracion.
      // eslint-disable-next-line require-yield -- el generador solo lanza, no emite eventos
      (async function* (): AsyncIterable<ProviderStreamEvent> {
        throw new ProviderError({ code: 'AUTHENTICATION', providerId: 'anthropic', message: 'invalid key', status: 401 });
      })(),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-bad' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200); // SSE ya abierto
    const events = parseSse(res.payload);
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent?.data).toMatchObject({ code: 'AUTHENTICATION', providerId: 'anthropic', status: 401 });
  });

  it('el SSE de error nunca contiene la key', async () => {
    const { ProviderError } = await import('../src/providers/errors.js');
    runModelMock.mockReturnValue(
      // Stream que falla al primer next(): simula un error del proveedor durante la iteracion.
      // eslint-disable-next-line require-yield -- el generador solo lanza, no emite eventos
      (async function* (): AsyncIterable<ProviderStreamEvent> {
        throw new ProviderError({ code: 'AUTHENTICATION', providerId: 'anthropic', message: 'invalid key', status: 401 });
      })(),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-leak-endpoint-123' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.payload).not.toContain('sk-leak-endpoint-123');
  });
});
