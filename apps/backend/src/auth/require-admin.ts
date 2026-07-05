import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { Env } from '../config/env.js';

/**
 * Guard de super-admin (header x-admin-token contra ADMIN_API_TOKEN): FUENTE UNICA del gate por token.
 * La importan todos los endpoints admin (agents, registro/aprobacion, retencion, derechos del titular)
 * en vez de re-implementarlo en cada ruta. Distinto de requireAdminRole (gate por ROL), que es otra cosa.
 */
export function requireAdmin(request: FastifyRequest, config: Env): void {
  const token = request.headers['x-admin-token'];
  if (typeof token !== 'string' || token !== config.ADMIN_API_TOKEN) {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or missing admin token');
  }
}
