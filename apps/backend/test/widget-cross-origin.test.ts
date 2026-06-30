import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';

const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'test-admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

// public/widget/ledesma-agent.js es un artefacto de build (gitignored; lo genera copy-widget.mjs
// tras construir packages/widget). Para que el test no dependa de un build previo, escribimos un
// stub si falta y lo borramos al final SOLO si lo creamos nosotros (asi no pisamos el artefacto real).
const widgetDir = fileURLToPath(new URL('../public/widget', import.meta.url));
const assetPath = fileURLToPath(new URL('../public/widget/ledesma-agent.js', import.meta.url));
let stubCreado = false;

beforeAll(() => {
  if (!existsSync(assetPath)) {
    mkdirSync(widgetDir, { recursive: true });
    writeFileSync(assetPath, 'window.__ledesmaWidgetStub = true;\n');
    stubCreado = true;
  }
});

afterAll(() => {
  if (stubCreado && existsSync(assetPath)) {
    rmSync(assetPath);
  }
});

describe('widget cross-origin', () => {
  it('sirve /widget/ledesma-agent.js con CORP cross-origin y content-type de javascript', async () => {
    const app = await buildServer(parseEnv(BASE_ENV));
    const res = await app.inject({ method: 'GET', url: '/widget/ledesma-agent.js' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('application/javascript');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    await app.close();
  });

  it('no relaja CORP fuera de /widget: /health conserva el same-origin del helmet', async () => {
    const app = await buildServer(parseEnv(BASE_ENV));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    // El cambio es exclusivo de /widget: /health NO debe quedar cross-origin.
    expect(res.headers['cross-origin-resource-policy']).not.toBe('cross-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    await app.close();
  });
});
