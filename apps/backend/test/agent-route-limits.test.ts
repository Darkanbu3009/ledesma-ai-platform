import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';
import { AGENT_LIMITS } from '../src/agent/index.js';

const { runModelMock } = vi.hoisted(() => ({ runModelMock: vi.fn() }));

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeEach(async () => {
  runModelMock.mockReset();
  runModelMock.mockReturnValue(
    (async function* (): AsyncIterable<ProviderStreamEvent> {
      yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    })(),
  );
  app = await buildServer(parseEnv({ NODE_ENV: 'test' }));
});

describe('POST /v1/agent/run limites', () => {
  it('rechaza con 400 si hay demasiados mensajes', async () => {
    const messages = Array.from({ length: AGENT_LIMITS.maxMessages + 1 }, () => ({
      role: 'user' as const,
      content: 'x',
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza con 400 si el contenido total excede el limite', async () => {
    const big = 'a'.repeat(AGENT_LIMITS.maxTotalContentChars + 1);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: big }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza con 413 si el body excede el bodyLimit', async () => {
    const huge = 'x'.repeat(AGENT_LIMITS.maxBodyBytes + 100_000);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: huge }] },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('acepta una peticion dentro de limites', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
      headers: { 'x-provider-key': 'sk-A' },
      payload: { providerId: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hola' }] },
    });
    expect(res.statusCode).toBe(200);
  });
});
