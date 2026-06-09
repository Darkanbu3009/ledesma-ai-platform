import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedUser, JwtVerifier } from './jwt-verifier.js';

/** Extrae y verifica el Bearer token; devuelve el usuario o lanza UNAUTHORIZED. */
export async function requireUser(request: FastifyRequest, verifier: JwtVerifier): Promise<AuthenticatedUser> {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 401, 'Missing or invalid Authorization header');
  }
  const token = header.slice('Bearer '.length).trim();
  if (token === '') {
    throw new AppError('UNAUTHORIZED', 401, 'Missing bearer token');
  }
  try {
    return await verifier.verify(token);
  } catch {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or expired token');
  }
}
