import { describe, it, expect, vi } from 'vitest';
import { requireUser } from '../src/auth/require-user.js';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { AppError } from '../src/errors/app-error.js';
import type { FastifyRequest } from 'fastify';

function reqWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

const okVerifier: JwtVerifier = { verify: vi.fn(async () => ({ id: 'u-1', email: 'a@b.com' })) };

describe('requireUser', () => {
  it('devuelve el usuario con un Bearer valido', async () => {
    const user = await requireUser(reqWith({ authorization: 'Bearer good' }), okVerifier);
    expect(user).toEqual({ id: 'u-1', email: 'a@b.com' });
  });
  it('lanza UNAUTHORIZED si falta el header', async () => {
    await expect(requireUser(reqWith({}), okVerifier)).rejects.toBeInstanceOf(AppError);
  });
  it('lanza UNAUTHORIZED si el header no es Bearer', async () => {
    await expect(requireUser(reqWith({ authorization: 'Basic xyz' }), okVerifier)).rejects.toBeInstanceOf(AppError);
  });
  it('lanza UNAUTHORIZED si el verifier rechaza el token', async () => {
    const bad: JwtVerifier = { verify: vi.fn(async () => { throw new Error('bad'); }) };
    await expect(requireUser(reqWith({ authorization: 'Bearer bad' }), bad)).rejects.toBeInstanceOf(AppError);
  });
});
