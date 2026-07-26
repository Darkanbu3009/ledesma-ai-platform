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
import { upgradeRequestRoutes } from './routes/upgrade-requests.js';
import { subscriptionRoutes } from './routes/subscription.js';
import { adminUpgradeRequestsRoutes } from './routes/admin-upgrade-requests.js';
import { jobsRoutes } from './routes/jobs.js';
import { sitiosRoutes } from './routes/sitios.js';
import { aprobacionesRoutes } from './routes/aprobaciones.js';
import { politicasEjecucionRoutes } from './routes/politicas-ejecucion.js';
import { trayectoriasRoutes } from './routes/trayectorias.js';
import { grabacionesRoutes } from './routes/grabaciones.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { triggerRoutes } from './routes/triggers.js';
import { incomingTriggerRoutes } from './routes/incoming-triggers.js';
import { sessionTokenRoutes } from './routes/session-tokens.js';
import { registrationRoutes } from './routes/registration.js';
import { accountRoutes } from './routes/account.js';
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
  // Panel de admin (solo lectura): los leads de upgrade (solicitudes de acceso a features premium),
  // gateado por ROL (requireAdminRole). Read-only, no muta -> sin audit log. Aditivo.
  await app.register(adminUpgradeRequestsRoutes(config));
  await app.register(userAgentRoutes(config));
  await app.register(runAgentByIdRoutes(config));
  await app.register(toolCatalogRoutes(config));
  await app.register(configuratorRoutes(config));
  await app.register(credentialRoutes(config));
  await app.register(scheduledTaskRoutes(config));
  await app.register(recipeRoutes(config));
  // Captura de DEMANDA de upgrade (Fase 1 de monetizacion): un usuario 'free' que se topa con una feature
  // premium puede registrar su interes (POST /v1/upgrade-requests, GET /me). Aditivo: NO sube el tier (solo
  // registra el interes; subir el tier sigue siendo del admin), el enforcement de tier queda intacto.
  await app.register(upgradeRequestRoutes(config));
  // Seleccion SELF-SERVICE de plan (lanzamiento gratuito): activa el plan elegido al instante
  // escribiendo subscriptions.plan/status + profiles.tier (la fuente de verdad que leen los gates).
  // El desbloqueo de features ya NO pasa por upgrade_requests. Stripe gobernara el status despues.
  await app.register(subscriptionRoutes(config));
  // Observabilidad de la ejecucion autonoma (solo lectura): historial de jobs del owner. Aditivo.
  await app.register(jobsRoutes(config));
  // Sitios conectados (7.1c): conectar/confirmar/listar/desconectar. Solo encola jobs de 7.1b; el
  // login lo hace el usuario en la vista en vivo del proveedor (jamas pasa por este backend).
  await app.register(sitiosRoutes(config));
  // Checkpoints de aprobacion humana de tareas web (7.1e): listar/aprobar/rechazar. La decision
  // registra la intervencion Art.22 y devuelve el job pausado a 'pending'; el worker reanuda.
  await app.register(aprobacionesRoutes(config));
  // Politica de ejecucion (V034): los tres ajustes que el usuario configura UNA vez y que deciden si
  // una accion que no se puede deshacer se ejecuta o se detiene. El worker lee la misma fila.
  await app.register(politicasEjecucionRoutes(config));
  // Trayectorias de tareas web (Fase F, V030), solo lectura: los pasos censurados que ejecuto el
  // motor de navegacion en un job de tarea web. Aditivo: la escribe el worker; aqui solo se lee.
  await app.register(trayectoriasRoutes(config));
  // Grabacion de tareas (V036): la via COMPLEMENTARIA para sembrar una receta en los sitios donde el
  // agente falla de forma repetida. Solo encola jobs; el login jamas se graba (exige sitio 'activo').
  await app.register(grabacionesRoutes(config));
  // Resumen AGREGADO del dashboard (solo lectura): los tres ejes (actividad, operaciones, gasto) por
  // owner. Aditivo: lee agent_runs, jobs y los repos de recursos; no escribe nada.
  await app.register(dashboardRoutes(config));
  await app.register(triggerRoutes(config));
  await app.register(incomingTriggerRoutes(config));
  await app.register(sessionTokenRoutes(config));
  await app.register(registrationRoutes(config));
  // Borrado self-service de la PROPIA cuenta (DELETE /v1/me): el usuario borra sus datos + identidad,
  // con confirmacion por email. Reusa el MOTOR de borrado atomico (#151), el mismo que el erasure ARCO
  // admin. Aislado: ruta aparte, distinto metodo que el GET/PATCH /v1/me del registro (sin colision).
  await app.register(accountRoutes(config));
  // Andamiaje de privacidad y cumplimiento (Fase 5.6): consentimiento versionado, derechos del titular
  // (ARCO), registro de tratamiento y retencion. Aditivo: no toca los flujos anteriores.
  await app.register(consentRoutes(config));
  await app.register(dataSubjectRequestRoutes(config));
  await app.register(processingRecordRoutes(config));
  await app.register(retentionRoutes(config));

  return app;
}
