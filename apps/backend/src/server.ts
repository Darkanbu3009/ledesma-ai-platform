import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { securityPlugin } from './plugins/security.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { loggerRedaction } from './logger.js';
import type { Env } from './config/env.js';

export async function buildServer(config: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: loggerRedaction,
    },
  });

  await app.register(securityPlugin, { config });
  registerErrorHandler(app, config);
  await app.register(healthRoutes);

  return app;
}
