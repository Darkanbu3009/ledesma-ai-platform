import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agent.js';
import { adminAgentRoutes } from './routes/admin-agents.js';
import { agentRoutes as userAgentRoutes } from './routes/agents.js';
import { runAgentByIdRoutes } from './routes/run-agent-by-id.js';
import { toolCatalogRoutes } from './routes/tools.js';
import { configuratorRoutes } from './routes/configurator.js';
import { credentialRoutes } from './routes/credentials.js';
import { scheduledTaskRoutes } from './routes/scheduled-tasks.js';
import { sessionTokenRoutes } from './routes/session-tokens.js';
import { registrationRoutes } from './routes/registration.js';
import { securityPlugin } from './plugins/security.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { loggerRedaction } from './logger.js';
import type { Env } from './config/env.js';

export interface BuildServerOptions {
  /** Destino del stream de logs de pino. Inyectable en tests para capturar y auditar las lineas
   * emitidas; si no se pasa, pino escribe a stdout como siempre. */
  loggerDestination?: { write(msg: string): void };
}

export async function buildServer(config: Env, options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: loggerRedaction,
      ...(options.loggerDestination !== undefined ? { stream: options.loggerDestination } : {}),
    },
  });

  await app.register(securityPlugin, { config });
  registerErrorHandler(app, config);
  // El widget embebible y su demo se sirven desde public/widget. La ruta se resuelve relativa
  // a este archivo (src/ en dev y tests, dist/ compilado): public/ es hermana de ambas.
  //
  // El widget es embebible cross-origin POR DISENO: se inyecta como <script> desde
  // app.ledesma-ai-labs.com y desde los sitios de clientes. El helmet global (plugins/security.ts)
  // aplica Cross-Origin-Resource-Policy: same-origin a TODAS las respuestas, lo que hace que el
  // navegador BLOQUEE el asset al cargarlo desde otro origen (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
  // Registramos el static en un contexto encapsulado y, con un hook onSend (que corre DESPUES del
  // onRequest de helmet y por tanto sobreescribe su cabecera), relajamos CORP a cross-origin SOLO
  // en estas rutas y reflejamos Access-Control-Allow-Origin: * (es JS publico, sin credenciales).
  // El resto de la app conserva el CORP same-origin del helmet.
  await app.register(async (widgetAssets) => {
    widgetAssets.addHook('onSend', async (_request, reply) => {
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('Access-Control-Allow-Origin', '*');
    });
    await widgetAssets.register(fastifyStatic, {
      root: fileURLToPath(new URL('../public/widget', import.meta.url)),
      prefix: '/widget/',
    });
  });
  await app.register(healthRoutes);
  await app.register(agentRoutes(config));
  await app.register(adminAgentRoutes(config));
  await app.register(userAgentRoutes(config));
  await app.register(runAgentByIdRoutes(config));
  await app.register(toolCatalogRoutes(config));
  await app.register(configuratorRoutes(config));
  await app.register(credentialRoutes(config));
  await app.register(scheduledTaskRoutes(config));
  await app.register(sessionTokenRoutes(config));
  await app.register(registrationRoutes(config));

  return app;
}
