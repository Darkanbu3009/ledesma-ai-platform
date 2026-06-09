import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

function parseOrigins(value: string): true | string[] {
  if (value.trim() === '*') {
    return true;
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token', 'x-provider-key', 'x-provider-base-url'],
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
