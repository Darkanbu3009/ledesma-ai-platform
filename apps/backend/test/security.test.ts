import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';

describe('security plugins', () => {
  it('incluye cabeceras de helmet', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test' }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('incluye cabeceras de rate limit', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test' }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers).toHaveProperty('x-ratelimit-limit');
    await app.close();
  });

  it('responde 429 con sobre estructurado al exceder el limite', async () => {
    const app = await buildServer(
      parseEnv({ NODE_ENV: 'test', RATE_LIMIT_MAX: '1', RATE_LIMIT_TIME_WINDOW: '1 minute' }),
    );
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
    await app.close();
  });

  it('refleja el origen en CORS', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test' }));
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.ledesma-ai-labs.com' },
    });
    expect(res.headers).toHaveProperty('access-control-allow-origin');
    await app.close();
  });
});
