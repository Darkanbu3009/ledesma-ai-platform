import { describe, it, expect } from 'vitest';
import { requireAdmin } from '../src/auth/require-admin.js';
import { AppError } from '../src/errors/app-error.js';
import type { Env } from '../src/config/env.js';
import type { FastifyRequest } from 'fastify';

// Guard del token (x-admin-token) ahora vive en UNA sola fuente (auth/require-admin.ts) importada por
// todos los endpoints admin. Este test cubre la fuente unica directamente: solo lee el header y lo
// compara contra config.ADMIN_API_TOKEN. Mismo patron de request/config minimos que require-admin-role.
function reqWith(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

const config = { ADMIN_API_TOKEN: 'token-super-admin' } as unknown as Env;

describe('requireAdmin (x-admin-token, fuente unica)', () => {
  it('token correcto -> pasa sin lanzar', () => {
    expect(() => requireAdmin(reqWith({ 'x-admin-token': 'token-super-admin' }), config)).not.toThrow();
  });

  it('token incorrecto (misma longitud) -> UNAUTHORIZED 401', () => {
    try {
      requireAdmin(reqWith({ 'x-admin-token': 'token-super-admiX' }), config);
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    }
  });

  // La comparacion es timing-safe con chequeo de longitud previo (mismo patron que trigger-auth /
  // relay-token): un token de longitud DISTINTA no debe lanzar por timingSafeEqual, debe dar 401.
  it('token de longitud distinta -> UNAUTHORIZED 401 (sin lanzar por buffers desiguales)', () => {
    try {
      requireAdmin(reqWith({ 'x-admin-token': 'malo' }), config);
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    }
  });

  it('token vacio -> UNAUTHORIZED 401 (el chequeo de longitud minima no deja pasar vacios)', () => {
    try {
      requireAdmin(reqWith({ 'x-admin-token': '' }), config);
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    }
  });

  it('sin header x-admin-token -> UNAUTHORIZED 401', () => {
    try {
      requireAdmin(reqWith({}), config);
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    }
  });
});
