import { JobsRepository } from '@ledesma-platform/shared';
import { parseEnv, type WorkerEnv } from './env.js';
import { createLogger } from './logger.js';
import { getSql, closeSql } from './db.js';
import { startWorker } from './worker.js';

/**
 * Punto de entrada del WORKER de ejecucion autonoma (Fase 5). En ESTE PR (5.1) es un esqueleto: lee la
 * config/env, se conecta a la base y arranca un loop que CONSULTA la cola de jobs (V008). NO toma ni
 * ejecuta agentes todavia: la ejecucion real (conectar la capa assembleAgentRun del backend), el manejo
 * de errores y los reintentos llegan en PR 5.2. Este proceso NO se despliega aun; solo debe compilar y
 * poder correrse localmente.
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
  const repo = new JobsRepository(sql);
  const handle = startWorker({ repo, logger, intervalMs: config.WORKER_POLL_INTERVAL_MS });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('senal recibida, cerrando', { signal });
    handle.stop();
    // Watchdog de respaldo: si el cierre del pool se cuelga (p.ej. conexion wedgeada), el proceso sale
    // igual tras el plazo. unref para no mantener vivo el event loop solo por este timer si el cierre
    // resuelve antes. closeSql(5) ademas acota el drenaje del end() a 5s (ver db.ts).
    const watchdog = setTimeout(() => process.exit(0), 5000);
    watchdog.unref();
    void closeSql(5).finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
