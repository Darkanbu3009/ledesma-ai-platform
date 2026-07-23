import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { internalRelayRoutes } from './routes/internal-relay.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { AppError } from './errors/app-error.js';
import { loggerRedaction, loggerSerializers } from './logger.js';
import type { Env } from './config/env.js';

/**
 * SERVIDOR INTERNO del backend: un Fastify MINIMO, SEPARADO del publico (server.ts), con el UNICO
 * proposito de la autoridad de coordinacion del relay (B-1). Escucha en RELAY_INTERNAL_PORT, un puerto que
 * Railway NO mapea al dominio publico: solo es alcanzable por la RED PRIVADA (`*.railway.internal`) desde
 * el servicio relay. Asi el endpoint de consumo de jti NO queda expuesto a internet, y ademas cada
 * peticion se autentica con una MAC (defensa en profundidad).
 *
 * SIN helmet/cors/estaticos: no es browser-facing. Con rate limit propio (aunque sea privado). El error
 * handler es el mismo de la app publica (respuestas de error uniformes, sin oraculo).
 *
 * Se construye SOLO cuando el relay esta configurado (hay RELAY_TOKEN_SECRET); el llamador lo garantiza.
 */
export async function buildInternalServer(
  config: Env,
  secret: string,
  options: { loggerDestination?: { write(msg: string): void } } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: loggerRedaction,
      serializers: loggerSerializers,
      ...(options.loggerDestination !== undefined ? { stream: options.loggerDestination } : {}),
    },
  });

  registerErrorHandler(app, config);

  // Rate limit propio: aunque el listener sea privado, acota un bucle desbocado o un vecino comprometido
  // en la red interna. Holgado para el trafico real (una llamada por handshake).
  await app.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) =>
      new AppError('RATE_LIMIT_EXCEEDED', 429, `Rate limit exceeded, retry after ${context.after}`),
  });

  await app.register(internalRelayRoutes(config, secret));

  return app;
}
