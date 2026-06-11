import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'test-admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  CORS_ORIGINS: 'https://app.ledesma-ai-labs.com',
};

describe('cors preflight', () => {
  it('acepta el preflight de PUT con los metodos y headers de la plataforma', async () => {
    const app = await buildServer(parseEnv(ENV));
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/agents/abc',
      headers: {
        origin: 'https://app.ledesma-ai-labs.com',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    const allowMethods = String(res.headers['access-control-allow-methods']);
    expect(allowMethods).toContain('PUT');
    expect(allowMethods).toContain('DELETE');
    const allowHeaders = String(res.headers['access-control-allow-headers']).toLowerCase();
    expect(allowHeaders).toContain('authorization');
    await app.close();
  });
});
