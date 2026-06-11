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

const ALLOWED_ORIGIN = 'https://app.ledesma-ai-labs.com';

function streamOf(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

let app: FastifyInstance;

beforeEach(async () => {
  runModelMock.mockReset();
  app = await buildServer(
    parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://x',
      ADMIN_API_TOKEN: 'test-admin-token-1234567890',
      SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      CORS_ORIGINS: ALLOWED_ORIGIN,
    }),
  );
});

describe('POST /v1/agent/run (CORS sobre SSE)', () => {
  it('incluye access-control-allow-origin en la respuesta SSE para un origin permitido', async () => {
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
      ]),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { origin: ALLOWED_ORIGIN, 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});
