import { JobsRepository } from '@ledesma-platform/shared';
import {
  assembleAgentRun,
  runAgent,
  AgentRepository,
  ProviderCredentialRepository,
  resolveStoredCredential,
  RegistrationRepository,
} from '@ledesma-platform/backend/execution';
import { parseEnv, type WorkerEnv } from './env.js';
import { createLogger } from './logger.js';
import { getSql, closeSql } from './db.js';
import { startWorker } from './worker.js';
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
