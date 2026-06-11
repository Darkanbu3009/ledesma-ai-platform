import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';

const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'test-admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('cors comodin', () => {
  it("con CORS_ORIGINS='*' acepta el preflight del widget desde cualquier origen", async () => {
    const app = await buildServer(parseEnv({ ...BASE_ENV, CORS_ORIGINS: '*' }));
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/run/abc',
      headers: {
        origin: 'https://cliente-ejemplo.com',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    const allowOrigin = res.headers['access-control-allow-origin'];
    expect(['https://cliente-ejemplo.com', '*']).toContain(allowOrigin);
    await app.close();
  });

  it('sin comodin un origen no listado no recibe access-control-allow-origin', async () => {
    const app = await buildServer(
      parseEnv({ ...BASE_ENV, CORS_ORIGINS: 'https://app.ledesma-ai-labs.com' }),
    );
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/run/abc',
      headers: {
        origin: 'https://otro-sitio.com',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
