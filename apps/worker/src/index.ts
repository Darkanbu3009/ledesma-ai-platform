import { JobsRepository } from '@ledesma-platform/shared';
import {
  assembleAgentRun,
  runAgent,
  AgentRepository,
  AgentRunRepository,
  ProviderCredentialRepository,
  resolveStoredCredential,
  RegistrationRepository,
} from '@ledesma-platform/backend/execution';
import { DataSubjectRequestRepository, SitiosConectadosRepository } from '@ledesma-platform/backend/sitios';
import { parseEnv, type WorkerEnv } from './env.js';
import { NavegadorBrowserbase } from './browserbase.js';
import type { SitiosJobDeps } from './sitios.js';
import { createLogger } from './logger.js';
import { getSql, closeSql } from './db.js';
import { startWorker } from './worker.js';
import { crearNotificadorFallos, leerEmailOwner, leerNombreAgente } from './alertas.js';
import type { JobRunnerDeps } from './execution.js';

/**
 * Punto de entrada del WORKER de ejecucion autonoma (Fase 5). Lee la config/env, se conecta a la MISMA
 * base que el backend y arranca el loop que TOMA jobs de la cola (V008) y los EJECUTA: resuelve la
 * credencial de la boveda por owner + credential, arma el run con la capa reutilizable del backend
 * (assembleAgentRun) y corre runAgent con un deadline de pared propio, cerrando cada job con exito o
 * con reintentos. El scheduler (PR 5.3) y los triggers (PR 5.4) son los que ENCOLAN; este proceso solo
 * CONSUME lo que ya esta en la cola.
 */
function loadConfig(): WorkerEnv {
  try {
    return parseEnv();
  } catch (err) {
    console.error('Configuracion de entorno invalida:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function main(): void {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const sql = getSql(config.DATABASE_URL);

  // Repos del backend reusados via el subpath @ledesma-platform/backend/execution (mismo motor y boveda
  // que la ruta HTTP, sin duplicar logica). Todos se instancian con el sql del worker (sin request).
  const jobs = new JobsRepository(sql);
  const agentRepo = new AgentRepository(sql);
  const credentialRepo = new ProviderCredentialRepository(sql);
  const registrationRepo = new RegistrationRepository(sql);
  // Registro de corridas autonomas: la MISMA tabla/metodo (agent_runs.record) que la ruta sincrona,
  // instanciada con el sql del worker. La escritura es best-effort (ver recordRun en JobRunnerDeps).
  const runRepo = new AgentRunRepository(sql);

  // Notificador de fallos DEFINITIVOS por correo (best-effort). Lee el email del owner de auth.users y el
  // nombre del agente con el MISMO cliente sql. El cooldown por owner vive en el closure (una instancia
  // por proceso). Si falta la config de email, notificarFallo loguea y no envia (no tumba el worker).
  const notificador = crearNotificadorFallos({
    ...(config.RESEND_API_KEY !== undefined ? { resendApiKey: config.RESEND_API_KEY } : {}),
    ...(config.RESEND_FROM_EMAIL !== undefined ? { fromEmail: config.RESEND_FROM_EMAIL } : {}),
    ...(config.CONSOLE_BASE_URL !== undefined ? { consoleBaseUrl: config.CONSOLE_BASE_URL } : {}),
    getOwnerEmail: (ownerId) => leerEmailOwner(sql, ownerId, logger),
    getAgentName: (agentId) => leerNombreAgente(sql, agentId, logger),
    logger,
  });

  // SITIOS CONECTADOS (7.1b): se cablea SOLO si la config de Browserbase esta completa; si falta, el
  // worker corre igual (los jobs de sitios fallan permanente con mensaje claro y el barrido no corre,
  // mismo espiritu opcional que las alertas). El repositorio de 7.1a cifra el contexto con
  // VAULT_SECRET server-side; el encadenado ARCO escribe en data_subject_requests (V014) una
  // solicitud de cancelacion YA RESUELTA por cada desconexion (el borrado ya ocurrio en el mismo job).
  let sitios: SitiosJobDeps | undefined;
  if (config.BROWSERBASE_API_KEY !== undefined && config.BROWSERBASE_PROJECT_ID !== undefined) {
    const sitiosRepo = new SitiosConectadosRepository(sql);
    const dsrRepo = new DataSubjectRequestRepository(sql);
    sitios = {
      repo: sitiosRepo,
      navegador: new NavegadorBrowserbase({
        apiKey: config.BROWSERBASE_API_KEY,
        projectId: config.BROWSERBASE_PROJECT_ID,
        proxyServer: config.BROWSERBASE_PROXY_SERVER,
        proxyUsername: config.BROWSERBASE_PROXY_USERNAME,
        proxyPassword: config.BROWSERBASE_PROXY_PASSWORD,
      }),
      vaultSecret: config.VAULT_SECRET,
      registrarDesconexionArco: async (ownerId, dominio) => {
        const solicitud = await dsrRepo.createRequest({
          ownerId,
          requestType: 'cancellation',
          details: `desconexion del sitio conectado ${dominio} (borrado de la sesion heredada)`,
        });
        await dsrRepo.updateStatus(
          solicitud.id,
          'completed',
          'contexto de sesion borrado en el proveedor de navegador y en la plataforma (7.1b)',
        );
      },
      logger,
    };
  } else {
    logger.info('sitios conectados deshabilitados: falta BROWSERBASE_API_KEY y/o BROWSERBASE_PROJECT_ID');
  }

  const deps: JobRunnerDeps = {
    jobs,
    getProfileTier: (ownerId) => registrationRepo.getProfileTier(ownerId),
    loadAgent: (agentId) => agentRepo.getById(agentId),
    resolveCredential: (ownerId, credentialId) =>
      resolveStoredCredential(credentialRepo, ownerId, credentialId, config.VAULT_SECRET),
    assembleAgentRun,
    runAgent,
    logger,
    config: {
      runTimeoutMs: config.RUN_TIMEOUT_SECONDS * 1000,
      runMaxTokens: config.RUN_MAX_TOKENS,
      ...(config.WEB_WORKER_URL !== undefined ? { webWorkerUrl: config.WEB_WORKER_URL } : {}),
      ...(config.WEB_WORKER_SECRET !== undefined ? { webWorkerSecret: config.WEB_WORKER_SECRET } : {}),
    },
    notifyJobFailure: (job, reason) => notificador.notificarFallo(job, reason),
    // Persistencia best-effort del usage de cada ejecucion autonoma en agent_runs (misma via que la ruta
    // sincrona). Si esto fallara, processClaimedJob lo traga: el job conserva su estado real.
    recordRun: (run) => runRepo.record(run),
    ...(sitios !== undefined ? { sitios } : {}),
  };

  const handle = startWorker({ deps, logger, intervalMs: config.WORKER_POLL_INTERVAL_MS });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('senal recibida, cerrando', { signal });
    // Watchdog de respaldo: si el cierre se cuelga (run wedgeado, conexion muerta), el proceso sale
    // igual tras el plazo. unref para no mantener vivo el event loop solo por este timer si el cierre
    // resuelve antes. closeSql(5) ademas acota el drenaje del end() a 5s (ver db.ts).
    const watchdog = setTimeout(() => process.exit(0), 10_000);
    watchdog.unref();
    // stop() detiene el loop, aborta el job en curso (vuelve a 'pending') y espera a que termine la
    // pasada en vuelo ANTES de cerrar el pool, para no abortar a media escritura el cierre del job.
    void handle
      .stop()
      .catch(() => {})
      .then(() => closeSql(5))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
