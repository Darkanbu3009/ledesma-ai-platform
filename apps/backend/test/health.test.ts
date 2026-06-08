import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890' }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
