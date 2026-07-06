import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agent.js';
import { adminAgentRoutes } from './routes/admin-agents.js';
import { adminUsersRoutes } from './routes/admin-users.js';
import { adminUserTierRoutes } from './routes/admin-user-tier.js';
import { agentRoutes as userAgentRoutes } from './routes/agents.js';
import { runAgentByIdRoutes } from './routes/run-agent-by-id.js';
import { toolCatalogRoutes } from './routes/tools.js';
import { configuratorRoutes } from './routes/configurator.js';
import { credentialRoutes } from './routes/credentials.js';
import { scheduledTaskRoutes } from './routes/scheduled-tasks.js';
import { recipeRoutes } from './routes/recipes.js';
import { jobsRoutes } from './routes/jobs.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { triggerRoutes } from './routes/triggers.js';
import { incomingTriggerRoutes } from './routes/incoming-triggers.js';
import { sessionTokenRoutes } from './routes/session-tokens.js';
import { registrationRoutes } from './routes/registration.js';
import { consentRoutes } from './routes/consents.js';
import { dataSubjectRequestRoutes } from './routes/data-requests.js';
import { processingRecordRoutes } from './routes/processing-records.js';
import { retentionRoutes } from './routes/retention.js';
import { securityPlugin } from './plugins/security.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { loggerRedaction, loggerSerializers } from './logger.js';
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
      serializers: loggerSerializers,
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
  // Panel de admin (solo lectura): listado de usuarios de la plataforma, gateado por ROL
  // (requireAdminRole del PR 1a). Aditivo; primer uso real del gate por rol en un endpoint.
  await app.register(adminUsersRoutes(config));
  // Cambio de tier ATRIBUIBLE (PUT /v1/admin/users/:id/tier): la UNICA mutacion del panel, gateada por
  // ROL, que registra en el audit log el sub REAL del admin. El endpoint viejo (POST /v1/admin/profiles/
  // :id/tier, x-admin-token) queda como fallback. Aditivo.
  await app.register(adminUserTierRoutes(config));
  await app.register(userAgentRoutes(config));
  await app.register(runAgentByIdRoutes(config));
  await app.register(toolCatalogRoutes(config));
  await app.register(configuratorRoutes(config));
  await app.register(credentialRoutes(config));
  await app.register(scheduledTaskRoutes(config));
  await app.register(recipeRoutes(config));
  // Observabilidad de la ejecucion autonoma (solo lectura): historial de jobs del owner. Aditivo.
  await app.register(jobsRoutes(config));
  // Resumen AGREGADO del dashboard (solo lectura): los tres ejes (actividad, operaciones, gasto) por
  // owner. Aditivo: lee agent_runs, jobs y los repos de recursos; no escribe nada.
  await app.register(dashboardRoutes(config));
  await app.register(triggerRoutes(config));
  await app.register(incomingTriggerRoutes(config));
  await app.register(sessionTokenRoutes(config));
  await app.register(registrationRoutes(config));
  // Andamiaje de privacidad y cumplimiento (Fase 5.6): consentimiento versionado, derechos del titular
  // (ARCO), registro de tratamiento y retencion. Aditivo: no toca los flujos anteriores.
  await app.register(consentRoutes(config));
  await app.register(dataSubjectRequestRoutes(config));
  await app.register(processingRecordRoutes(config));
  await app.register(retentionRoutes(config));

  return app;
}
