import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

function parseOrigins(value: string): true | string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // Un solo '*' => origin: true (reflejar cualquier origen). La API no usa cookies ni
  // credenciales ambientales; reflejar el origen es seguro y necesario para el widget
  // embebido en sitios de clientes.
  if (origins.length === 1 && origins[0] === '*') {
    return true;
  }
  return origins;
}

export interface SecurityPluginOptions {
  config: Env;
}

export const securityPlugin = fp<SecurityPluginOptions>(async (app, opts) => {
  const { config } = opts;

  await app.register(helmet);

  await app.register(cors, {
    origin: parseOrigins(config.CORS_ORIGINS),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-admin-token',
      'x-provider-key',
      'x-provider-base-url',
      'x-session-token',
    ],
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_TIME_WINDOW,
    errorResponseBuilder: (_req, context) =>
      new AppError(
        'RATE_LIMIT_EXCEEDED',
        429,
        `Rate limit exceeded, retry after ${context.after}`,
      ),
  });
});
