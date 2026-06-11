import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agent.js';
import { adminAgentRoutes } from './routes/admin-agents.js';
import { agentRoutes as userAgentRoutes } from './routes/agents.js';
import { runAgentByIdRoutes } from './routes/run-agent-by-id.js';
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
  // El widget embebible y su demo se sirven desde public/widget. La ruta se resuelve relativa
  // a este archivo (src/ en dev y tests, dist/ compilado): public/ es hermana de ambas.
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../public/widget', import.meta.url)),
    prefix: '/widget/',
  });
  await app.register(healthRoutes);
  await app.register(agentRoutes);
  await app.register(adminAgentRoutes(config));
  await app.register(userAgentRoutes(config));
  await app.register(runAgentByIdRoutes(config));

  return app;
}
