import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { AppError } from '../src/errors/app-error.js';

describe('error handler', () => {
  it('devuelve sobre estructurado 404 para ruta inexistente', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890' }));
    const res = await app.inject({ method: 'GET', url: '/no-existe' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body).toHaveProperty('requestId');
    await app.close();
  });

  it('mapea AppError a su codigo y status', async () => {
    const app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890' }));
    app.get('/app-error', () => {
      throw new AppError('VALIDATION_ERROR', 422, 'campo invalido');
    });
    const res = await app.inject({ method: 'GET', url: '/app-error' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('no filtra el mensaje interno en produccion', async () => {
    const app = await buildServer(
      parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890' }),
    );
    app.get('/boom', () => {
      throw new Error('detalle interno secreto');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('secreto');
    await app.close();
  });
});
