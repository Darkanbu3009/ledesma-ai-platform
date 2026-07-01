import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env.js';

/**
 * Origen PUBLICO del backend para construir la URL del webhook entrante de un trigger. Prioriza
 * PUBLIC_BASE_URL (setearla en prod es lo robusto si el backend esta detras de proxy/CDN); si falta,
 * la deriva del request (protocolo + Host header). Normaliza quitando trailing slashes.
 */
export function publicBaseUrl(config: Env, request: FastifyRequest): string {
  const host = request.headers.host ?? request.hostname;
  const base = config.PUBLIC_BASE_URL ?? `${request.protocol}://${host}`;
  return base.replace(/\/+$/, '');
}

/**
 * URL del webhook ENTRANTE de un trigger. Para 'url_token' se incluye ?token= (el token viaja en la
 * URL); para 'hmac' es la URL a secas (la firma va en headers). El token se encodea por si trae chars
 * especiales (base64url no los trae, pero es defensivo).
 */
export function webhookUrl(base: string, triggerId: string, token?: string): string {
  const url = `${base}/webhooks/triggers/${triggerId}`;
  return token !== undefined ? `${url}?token=${encodeURIComponent(token)}` : url;
}
