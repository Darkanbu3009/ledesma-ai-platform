import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mismo patron que run-agent-by-id.test.ts: mockeamos la capa de modelo y el repo, sin tocar red.
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

// DNS fijado a IP publica: la guarda anti-SSRF del webhook de cliente no depende de la red.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '34.107.221.82', family: 4 }]),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { signWebhookPayload } from '../src/tools/webhook-signature.js';
import type { FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';

function streamOf(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

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
const SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Secreto de plataforma: centinela (fragmento SENTINEL) para detectar cualquier fuga.
const WORKER_SECRET = 'worker-SENTINEL-platform-secret-0123456789abcd';
const WORKER_URL = 'https://web-worker.ledesma.example.com';
// Secreto del agente: DISTINTO del de plataforma, para probar que las nativas NO lo usan.
const AGENT_WEBHOOK_SECRET = 'whsec_secreto_del_agente_distinto_0123456789';

const baseAgent = {
  id: AGENT_ID,
  name: 'Cotizador',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Eres cotizador',
  maxTokens: 512,
  temperature: 0.3,
  baseUrl: null,
  tools: [] as Array<{ name: string; description: string; inputSchema: Record<string, unknown>; url: string }>,
  webhookSecret: AGENT_WEBHOOK_SECRET,
  ownerId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const storedTool = {
  name: 'cotizar',
  description: 'Calcula el precio de N piezas',
  inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
  url: 'https://hooks.cliente.com/cotizar',
};

const WORKER_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'test-admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: SESSION_SECRET,
  WEB_WORKER_URL: WORKER_URL,
  WEB_WORKER_SECRET: WORKER_SECRET,
};

function fakeResp(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/** Lee las llamadas registradas al fetch global como tuplas [url, init] (el impl del mock no
 * tipa el segundo argumento, asi que se normaliza aca para las aserciones). */
function fetchCalls(mock: { mock: { calls: unknown[] } }): Array<[string, RequestInit]> {
  return mock.mock.calls as unknown as Array<[string, RequestInit]>;
}

let app: FastifyInstance;
let logs: string[];

beforeEach(() => {
  runModelMock.mockReset();
  getByIdMock.mockReset();
  logs = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function buildWithWorker(): Promise<void> {
  app = await buildServer(parseEnv(WORKER_ENV), { loggerDestination: { write: (m: string) => logs.push(m) } });
}

describe('tools nativas en /v1/run/:agentId (worker configurado)', () => {
  it('agente SIN stored tools igual recibe las 2 nativas (y no cae al demo)', async () => {
    await buildWithWorker();
    getByIdMock.mockResolvedValue({ ...baseAgent, tools: [] });
    runModelMock.mockReturnValue(streamOf([{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    const tools = runModelMock.mock.calls[0]?.[0]?.request?.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['platform_iniciar_tarea_web', 'platform_revisar_tarea_web']);
    // No se inyecta el registro demo cuando hay nativas.
    expect(tools.map((t) => t.name)).not.toContain('get_current_time');
  });

  it('agente CON stored tools recibe nativas + las suyas (nativas primero)', async () => {
    await buildWithWorker();
    getByIdMock.mockResolvedValue({ ...baseAgent, tools: [storedTool] });
    runModelMock.mockReturnValue(streamOf([{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    const tools = runModelMock.mock.calls[0]?.[0]?.request?.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['platform_iniciar_tarea_web', 'platform_revisar_tarea_web', 'cotizar']);
  });

  it('dispatch: platform_* va al worker (firma de plataforma) y el resto al webhook del cliente (firma del agente)', async () => {
    await buildWithWorker();
    getByIdMock.mockResolvedValue({ ...baseAgent, tools: [storedTool] });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/tools/iniciar-tarea-web')) return fakeResp(JSON.stringify({ content: 'job_id: jb_1' }));
      if (String(url).includes('hooks.cliente.com/cotizar')) return fakeResp(JSON.stringify({ content: 'precio: 300 MXN' }));
      return fakeResp(JSON.stringify({ content: 'otro' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const iniciarInput = { flujo: 'extraer_datos_web', params: { url: 'https://ejemplo.com', instruccion: 'extrae el titulo' } };
    runModelMock
      .mockReturnValueOnce(
        streamOf([
          { type: 'tool_use', id: 'tu_1', name: 'platform_iniciar_tarea_web', input: iniciarInput },
          { type: 'tool_use', id: 'tu_2', name: 'cotizar', input: { piezas: 2 } },
          { type: 'stop', reason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
        ]),
      )
      .mockReturnValueOnce(
        streamOf([
          { type: 'text_delta', text: 'listo' },
          { type: 'stop', reason: 'end_turn', usage: { inputTokens: 8, outputTokens: 4 } },
        ]),
      );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'user', content: 'inicia tarea y cotiza' }] },
    });

    expect(res.statusCode).toBe(200);

    // La tool nativa pega a la ruta del worker, firmada con el SECRETO DE PLATAFORMA.
    const iniciarCall = fetchCalls(fetchMock).find(([u]) => u.includes('/tools/iniciar-tarea-web'));
    expect(iniciarCall).toBeDefined();
    const [iniciarUrl, iniciarInit] = iniciarCall!;
    expect(iniciarUrl).toBe('https://web-worker.ledesma.example.com/tools/iniciar-tarea-web');
    const iniciarHeaders = iniciarInit.headers as Record<string, string>;
    const iniciarBody = String(iniciarInit.body);
    const iniciarTs = Number(iniciarHeaders['x-ledesma-timestamp']);
    expect(iniciarBody).toBe(JSON.stringify({ tool: 'platform_iniciar_tarea_web', input: iniciarInput }));
    expect(iniciarHeaders['x-ledesma-signature']).toBe(`v1=${signWebhookPayload(iniciarBody, iniciarTs, WORKER_SECRET)}`);
    // No esta firmada con el secreto del agente.
    expect(iniciarHeaders['x-ledesma-signature']).not.toBe(`v1=${signWebhookPayload(iniciarBody, iniciarTs, AGENT_WEBHOOK_SECRET)}`);

    // La tool de cliente pega a su webhook, firmada con el secreto DEL AGENTE.
    const cotizarCall = fetchCalls(fetchMock).find(([u]) => u.includes('hooks.cliente.com/cotizar'));
    expect(cotizarCall).toBeDefined();
    const [, cotizarInit] = cotizarCall!;
    const cotizarHeaders = cotizarInit.headers as Record<string, string>;
    const cotizarTs = Number(cotizarHeaders['x-ledesma-timestamp']);
    expect(cotizarHeaders['x-ledesma-signature']).toBe(`v1=${signWebhookPayload(String(cotizarInit.body), cotizarTs, AGENT_WEBHOOK_SECRET)}`);

    // Ambos resultados se reinyectan al modelo.
    const events = parseSse(res.payload);
    expect(events).toContainEqual({ event: 'message', data: { type: 'tool_result', toolUseId: 'tu_1', content: 'job_id: jb_1', isError: false } });
    expect(events).toContainEqual({ event: 'message', data: { type: 'tool_result', toolUseId: 'tu_2', content: 'precio: 300 MXN', isError: false } });
  });

  it('centinela: el WEB_WORKER_SECRET no aparece en logs, ni en el SSE, ni en el fetch al worker', async () => {
    await buildWithWorker();
    getByIdMock.mockResolvedValue({ ...baseAgent, tools: [] });

    const fetchMock = vi.fn(async () => fakeResp(JSON.stringify({ content: 'job_id: jb_9' })));
    vi.stubGlobal('fetch', fetchMock);

    runModelMock
      .mockReturnValueOnce(
        streamOf([
          { type: 'tool_use', id: 'tu_1', name: 'platform_iniciar_tarea_web', input: { flujo: 'extraer_datos_web', params: { url: 'https://x', instruccion: 'y' } } },
          { type: 'stop', reason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
        ]),
      )
      .mockReturnValueOnce(streamOf([{ type: 'text_delta', text: 'listo' }, { type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-cualquiera' },
      payload: { messages: [{ role: 'user', content: 'inicia tarea' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Sanidad: el POST al worker SI va firmado (firma hex derivada), nunca el secreto crudo.
    const firstCall = fetchCalls(fetchMock)[0];
    expect(firstCall).toBeDefined();
    const init = firstCall![1];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-ledesma-signature']).toMatch(/^v1=[0-9a-f]{64}$/);

    for (const haystack of [logs.join(''), res.payload, JSON.stringify(headers), String(init.body)]) {
      expect(haystack).not.toContain(WORKER_SECRET);
      expect(haystack).not.toContain('SENTINEL');
    }
  });
});

describe('sin worker configurado: comportamiento identico al actual', () => {
  it('no inyecta nativas y un agente sin tools usa el registro demo', async () => {
    const ENV_SIN_WORKER = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://x',
      ADMIN_API_TOKEN: 'test-admin-token-1234567890',
      SUPABASE_URL: 'https://x.supabase.co',
      SESSION_TOKEN_SECRET: SESSION_SECRET,
    };
    app = await buildServer(parseEnv(ENV_SIN_WORKER));
    getByIdMock.mockResolvedValue({ ...baseAgent, tools: [] });
    runModelMock.mockReturnValue(streamOf([{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    const tools = (runModelMock.mock.calls[0]?.[0]?.request?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['get_current_time']);
    expect(tools.map((t) => t.name).some((n) => n.startsWith('platform_'))).toBe(false);
  });

  it('con WEB_WORKER_URL pero SIN secret: la feature queda desactivada (no se inyectan nativas)', async () => {
    const ENV_SOLO_URL = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://x',
      ADMIN_API_TOKEN: 'test-admin-token-1234567890',
      SUPABASE_URL: 'https://x.supabase.co',
      SESSION_TOKEN_SECRET: SESSION_SECRET,
      WEB_WORKER_URL: WORKER_URL,
    };
    app = await buildServer(parseEnv(ENV_SOLO_URL));
    getByIdMock.mockResolvedValue({ ...baseAgent, tools: [] });
    runModelMock.mockReturnValue(streamOf([{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }]));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-A' },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    const tools = (runModelMock.mock.calls[0]?.[0]?.request?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['get_current_time']);
  });
});
