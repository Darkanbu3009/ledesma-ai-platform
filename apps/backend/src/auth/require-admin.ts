import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { Env } from '../config/env.js';

/**
 * Guard de super-admin: MISMO mecanismo que admin-agents.ts y registration.ts (header x-admin-token
 * contra ADMIN_API_TOKEN). Se centraliza aqui para los endpoints admin de cumplimiento (retencion,
 * resolucion de solicitudes de derechos) sin re-implementarlo en cada ruta.
 */
export function requireAdmin(request: FastifyRequest, config: Env): void {
  const token = request.headers['x-admin-token'];
  if (typeof token !== 'string' || token !== config.ADMIN_API_TOKEN) {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or missing admin token');
  }
}
