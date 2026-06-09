import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';

describe('error handler - errores de fastify con statusCode 4xx', () => {
  it('mapea statusCode 413 a PAYLOAD_TOO_LARGE', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co' }));
    app.get('/e413', () => {
      const err = new Error('too large') as Error & { statusCode: number };
      err.statusCode = 413;
      throw err;
    });
    const res = await app.inject({ method: 'GET', url: '/e413' });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    await app.close();
  });

  it('mapea un statusCode 4xx generico a BAD_REQUEST', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co' }));
    app.get('/e418', () => {
      const err = new Error('teapot') as Error & { statusCode: number };
      err.statusCode = 418;
      throw err;
    });
    const res = await app.inject({ method: 'GET', url: '/e418' });
    expect(res.statusCode).toBe(418);
    expect(res.json().error.code).toBe('BAD_REQUEST');
    await app.close();
  });

  it('un error sin statusCode sigue siendo INTERNAL_ERROR 500', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co' }));
    app.get('/eboom', () => {
      throw new Error('boom');
    });
    const res = await app.inject({ method: 'GET', url: '/eboom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    await app.close();
  });
});
