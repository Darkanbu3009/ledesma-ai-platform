import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Centinelas: valores distintivos que JAMAS deben salir del request. Todos comparten el fragmento
// 'SENTINEL' para que cualquier fuga (entera, parcial o re-serializada) se detecte en cualquier
// haystack, sin importar cual de los tres secretos se filtro.
const KEY = 'sk-SENTINEL-PROVIDER-9f8e7d';
const ADMIN = 'admin-SENTINEL-token-1234567890';
const JWT = 'Bearer eyJ-SENTINEL-jwt';
const SESSION_TOKEN = 'tok-SENTINEL-session-9a8b7c';
// Secreto de cifrado de tokens de sesion del server de test (no es un centinela: jamas viaja).
const SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { runModelMock, getByIdMock, listMock, listByOwnerMock } = vi.hoisted(() => ({
  runModelMock: vi.fn(),
  getByIdMock: vi.fn(),
  listMock: vi.fn(),
  listByOwnerMock: vi.fn(),
}));

// Capa de modelo mockeada: no se llama a APIs reales (mismo patron que agent-route.test.ts).
vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});

// Repositorio y cliente sql mockeados: no se toca DB real.
vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    getById = getByIdMock;
    list = listMock;
    listByOwner = listByOwnerMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// jose mockeado para rechazar todo token: solo se prueba el camino 401.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async () => {
    throw new Error('invalid token');
  }),
}));

import pino from 'pino';
import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { loggerRedaction } from '../src/logger.js';
import { ProviderError } from '../src/providers/errors.js';
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

/** Ningun haystack contiene el secreto ni su fragmento distintivo SENTINEL. */
function expectNoLeak(haystacks: string[], secret: string): void {
  for (const haystack of haystacks) {
    expect(haystack).not.toContain(secret);
    expect(haystack).not.toContain('SENTINEL');
  }
}

const AGENT_ID = '0b9f2c4e-5a1d-4f3b-9c8e-7d6a5b4c3f2e';

const storedAgent = {
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
let logs: string[];

beforeEach(async () => {
  runModelMock.mockReset();
  getByIdMock.mockReset();
  listMock.mockReset();
  listByOwnerMock.mockReset();
  logs = [];
  // El ADMIN centinela es el token real del server: si la config completa se filtrara a un log
  // en cualquier request, cualquiera de estos tests lo detectaria via el fragmento SENTINEL.
  app = await buildServer(
    parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: ADMIN, SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: SESSION_SECRET }),
    { loggerDestination: { write: (m: string) => logs.push(m) } },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('centinelas BYOK: la key del proveedor nunca sale del request', () => {
  it('run exitoso: la key no aparece en logs ni en el cuerpo SSE', async () => {
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
      ]),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': KEY },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    // Sanidad: el stream realmente corrio con la key del header.
    const events = parseSse(res.payload);
    expect(events).toContainEqual({ event: 'message', data: { type: 'text_delta', text: 'Hola' } });
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe(KEY);
    expect(logs.length).toBeGreaterThan(0);

    expectNoLeak([logs.join(''), res.payload], KEY);
  });

  it('ProviderError: la key no aparece en el log de agent run failed ni en el event error del SSE', async () => {
    runModelMock.mockReturnValue(
      // Stream que falla al primer next(): simula un error del proveedor durante la iteracion.
      // eslint-disable-next-line require-yield -- el generador solo lanza, no emite eventos
      (async function* (): AsyncIterable<ProviderStreamEvent> {
        throw new ProviderError({ code: 'AUTHENTICATION', providerId: 'anthropic', message: 'invalid api key', status: 401 });
      })(),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': KEY },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200); // SSE ya abierto
    const errorEvent = parseSse(res.payload).find((e) => e.event === 'error');
    expect(errorEvent?.data).toMatchObject({ code: 'AUTHENTICATION', providerId: 'anthropic', status: 401 });
    // Sanidad: el log que auditamos SI ocurrio.
    expect(logs.join('')).toContain('agent run failed');

    expectNoLeak([logs.join(''), res.payload], KEY);
  });

  it('run por id con tool webhook: la key no va en logs, ni en la respuesta, ni hacia el webhook', async () => {
    const storedTool = {
      name: 'cotizar',
      description: 'Calcula el precio de N piezas',
      inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
      url: 'https://hooks.cliente.com/cotizar',
    };
    getByIdMock.mockResolvedValue({ ...storedAgent, tools: [storedTool] });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: 'precio: 300 MXN' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    runModelMock
      .mockReturnValueOnce(
        streamOf([
          { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 2 } },
          { type: 'stop', reason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
        ]),
      )
      .mockReturnValueOnce(
        streamOf([
          { type: 'text_delta', text: 'Son 300 MXN' },
          { type: 'stop', reason: 'end_turn', usage: { inputTokens: 8, outputTokens: 4 } },
        ]),
      );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': KEY },
      payload: { messages: [{ role: 'user', content: 'cotiza 2 piezas' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // (b) La llamada saliente al webhook no reenvia el header ni la key en ninguna parte.
    const [webhookUrl, webhookInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headerNames = Object.keys((webhookInit.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('x-provider-key');
    expect(headerNames).not.toContain('authorization');
    expectNoLeak(
      [webhookUrl, JSON.stringify(webhookInit.headers), String(webhookInit.body)],
      KEY,
    );

    // (a) Tampoco en logs ni en la respuesta SSE.
    expectNoLeak([logs.join(''), res.payload], KEY);
  });

  it('run por id con body invalido (400): la key del header no aparece en el sobre de error ni en logs', async () => {
    getByIdMock.mockResolvedValue(storedAgent);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': KEY },
      payload: { messages: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    expectNoLeak([logs.join(''), res.payload], KEY);
  });
});

describe('centinela de tokens de sesion: ni la key ni el token salen del request', () => {
  it('mint + run con token: la key no aparece en ningun paso y el token no se loguea', async () => {
    getByIdMock.mockResolvedValue(storedAgent);
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
      ]),
    );

    // Paso 1: mint. La KEY centinela viaja en el header y vuelve cifrada dentro del token.
    const mintRes = await app.inject({
      method: 'POST',
      url: '/v1/session-tokens',
      headers: { 'x-provider-key': KEY },
      payload: { agentId: AGENT_ID },
    });
    expect(mintRes.statusCode).toBe(200);
    const { token } = mintRes.json() as { token: string };
    expect(token.length).toBeGreaterThan(20);

    // Paso 2: run con el token, sin x-provider-key.
    const runRes = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-session-token': token },
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });
    expect(runRes.statusCode).toBe(200);
    // Sanidad: la corrida uso la key que viajaba cifrada dentro del token.
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe(KEY);

    // La KEY no aparece en logs ni en la respuesta de ninguno de los dos pasos: el token es
    // ciphertext, no una codificacion legible de la key.
    expectNoLeak([logs.join(''), mintRes.payload, runRes.payload], KEY);

    // El TOKEN es una credencial portadora: tampoco debe loguearse ni reaparecer en el run.
    // Se busca un fragmento distintivo (prefijo iv+tag, aleatorio por token) para detectar
    // tambien logueos truncados; el token completo solo es legitimo en el body del mint.
    const tokenFragment = token.slice(0, 24);
    expect(logs.join('')).not.toContain(tokenFragment);
    expect(runRes.payload).not.toContain(tokenFragment);
  });
});

describe('centinelas admin y JWT: los tokens de auth tampoco se loguean', () => {
  it('admin con token valido: el token no aparece en logs ni en la respuesta', async () => {
    listMock.mockResolvedValue([{ id: 'a1', name: 'Cotizador' }]);

    const res = await app.inject({ method: 'GET', url: '/v1/admin/agents', headers: { 'x-admin-token': ADMIN } });

    expect(res.statusCode).toBe(200);
    expect(res.json().agents).toHaveLength(1);

    expectNoLeak([logs.join(''), res.payload], ADMIN);
  });

  it('admin con token invalido (401): el token no aparece en logs ni en el sobre de error', async () => {
    const invalidAdmin = 'admin-SENTINEL-token-NO-VALIDO-99';

    const res = await app.inject({ method: 'GET', url: '/v1/admin/agents', headers: { 'x-admin-token': invalidAdmin } });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');

    expectNoLeak([logs.join(''), res.payload], invalidAdmin);
  });

  it('JWT invalido (401): el bearer no aparece en logs ni en el sobre de error', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents', headers: { authorization: JWT } });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');

    expectNoLeak([logs.join(''), res.payload], JWT);
  });
});

describe('sanidad del redact de pino en el logger del server', () => {
  it('si se loguea un req con headers de credenciales por el logger del server, no filtra el valor', () => {
    // El serializer req de Fastify omite headers (el objeto queda {}), y si algun dia se
    // cambiara por uno que los incluya, los paths req.headers.* del redact los censuran.
    // En ningun caso debe quedar el valor crudo en la salida.
    app.log.info(
      {
        req: {
          headers: {
            authorization: JWT,
            'x-provider-key': KEY,
            'x-provider-base-url': 'https://SENTINEL-base.example.com/v1',
            'x-admin-token': ADMIN,
            'x-session-token': SESSION_TOKEN,
          },
        },
      },
      'sanity req con headers',
    );

    const output = logs.join('');
    expectNoLeak([output], KEY);
    expectNoLeak([output], ADMIN);
    expectNoLeak([output], JWT);
    expectNoLeak([output], SESSION_TOKEN);
  });

  it('headers de credenciales en el primer nivel del log salen como [REDACTED]', () => {
    app.log.info(
      { headers: { authorization: JWT, 'x-provider-key': KEY, 'x-admin-token': ADMIN, 'x-session-token': SESSION_TOKEN } },
      'sanity headers sueltos',
    );

    const output = logs.join('');
    expect(output).toContain('[REDACTED]');
    expectNoLeak([output], KEY);
    expectNoLeak([output], ADMIN);
    expectNoLeak([output], JWT);
    expectNoLeak([output], SESSION_TOKEN);
  });

  it('los paths req.headers.* censuran con [REDACTED] (pino sin los serializers de fastify)', () => {
    const lines: string[] = [];
    const logger = pino({ redact: loggerRedaction }, { write: (line: string) => lines.push(line) });
    logger.info(
      {
        req: {
          headers: {
            authorization: JWT,
            'x-provider-key': KEY,
            'x-provider-base-url': 'https://SENTINEL-base.example.com/v1',
            'x-admin-token': ADMIN,
            'x-session-token': SESSION_TOKEN,
          },
        },
      },
      'request',
    );

    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    expectNoLeak([output], KEY);
    expectNoLeak([output], ADMIN);
    expectNoLeak([output], JWT);
    expectNoLeak([output], SESSION_TOKEN);
  });
});
