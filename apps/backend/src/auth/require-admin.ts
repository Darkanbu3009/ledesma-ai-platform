import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { Env } from '../config/env.js';

/**
 * Comparacion en TIEMPO CONSTANTE del token presentado contra el esperado (mismo patron que
 * timingSafeEqualHex de trigger-auth y constantTimeEqualHex de relay-token, sobre bytes utf8: el
 * token admin no es hex). El chequeo de longitud previo evita que timingSafeEqual lance con buffers
 * de distinto tamano y no filtra timing util (la longitud no es el secreto); un token vacio jamas
 * pasa. Reemplaza el `!==` anterior, que filtraba por timing en que byte divergia.
 */
function tokenCoincide(presentado: string, esperado: string): boolean {
  const bp = Buffer.from(presentado, 'utf8');
  const be = Buffer.from(esperado, 'utf8');
  return bp.length === be.length && bp.length > 0 && timingSafeEqual(bp, be);
}

/**
 * Guard de super-admin (header x-admin-token contra ADMIN_API_TOKEN): FUENTE UNICA del gate por token.
 * La importan todos los endpoints admin (agents, registro/aprobacion, retencion, derechos del titular)
 * en vez de re-implementarlo en cada ruta. Distinto de requireAdminRole (gate por ROL), que es otra cosa.
 */
export function requireAdmin(request: FastifyRequest, config: Env): void {
  const token = request.headers['x-admin-token'];
  if (typeof token !== 'string' || !tokenCoincide(token, config.ADMIN_API_TOKEN)) {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or missing admin token');
  }
}
