import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos la capa de modelo para no llamar APIs reales: el endpoint usa runModel internamente
// a traves de runAgent. Interceptamos en el punto de la capa de modelo.
const { runModelMock, getByIdMock } = vi.hoisted(() => ({
  runModelMock: vi.fn(),
  getByIdMock: vi.fn(),
}));

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});

vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    getById = getByIdMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

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

const AGENT_ID = '0b9f2c4e-5a1d-4f3b-9c8e-7d6a5b4c3f2e';

const anthropicAgent = {
  id: AGENT_ID,
  name: 'Cotizador',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Eres cotizador',
  maxTokens: 512,
  temperature: 0.3,
  baseUrl: null,
  tools: [],
  ownerId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let app: FastifyInstance;

beforeEach(async () => {
  runModelMock.mockReset();
  getByIdMock.mockReset();
  app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co' }));
});

describe('POST /v1/run/:agentId', () => {
  it('rechaza con 400 si falta el header x-provider-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('responde 404 si el agente no existe', async () => {
    getByIdMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(getByIdMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it('responde SSE ejecutando con la config guardada del agente y la key del header', async () => {
    getByIdMock.mockResolvedValue(anthropicAgent);
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
      ]),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-byok-integrador' },
      // Campos de config en el body son decoys: el endpoint debe ignorarlos y usar la config de DB.
      payload: {
        messages: [{ role: 'user', content: 'hola' }],
        model: 'modelo-del-body',
        system: 'system del body',
        maxTokens: 9999,
        temperature: 1.9,
      },
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

    expect(runModelMock).toHaveBeenCalled();
    const call = runModelMock.mock.calls[0]?.[0];
    expect(call?.providerId).toBe('anthropic');
    expect(call?.request?.modelConfig?.model).toBe('claude-sonnet-4-6');
    expect(call?.request?.modelConfig?.maxTokens).toBe(512);
    expect(call?.request?.modelConfig?.temperature).toBe(0.3);
    expect(call?.request?.system).toBe('Eres cotizador');
    expect(call?.credentials?.apiKey).toBe('sk-byok-integrador');
  });

  it('pasa el baseUrl de la config como credencial para openai-compatible', async () => {
    getByIdMock.mockResolvedValue({
      ...anthropicAgent,
      providerId: 'openai-compatible',
      model: 'llama-3-70b',
      baseUrl: 'https://llm.interno.example.com/v1',
    });
    runModelMock.mockReturnValue(streamOf([{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-compat' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    const call = runModelMock.mock.calls[0]?.[0];
    expect(call?.providerId).toBe('openai-compatible');
    expect(call?.credentials?.apiKey).toBe('sk-compat');
    expect(call?.credentials?.baseUrl).toBe('https://llm.interno.example.com/v1');
  });

  it('rechaza con 400 si messages esta vacio', async () => {
    getByIdMock.mockResolvedValue(anthropicAgent);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza con 400 si el body es invalido', async () => {
    getByIdMock.mockResolvedValue(anthropicAgent);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'sistema', content: 42 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('el SSE de error nunca contiene la key', async () => {
    getByIdMock.mockResolvedValue(anthropicAgent);
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
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-leak-run-by-id-123' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200); // SSE ya abierto
    const events = parseSse(res.payload);
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent?.data).toMatchObject({ code: 'AUTHENTICATION', providerId: 'anthropic', status: 401 });
    expect(res.payload).not.toContain('sk-leak-run-by-id-123');
  });
});
