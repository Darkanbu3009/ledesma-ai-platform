import type { JobsRepository } from '@ledesma-platform/shared';
import type { Logger } from './logger.js';

/**
 * Una pasada del loop: CONSULTA la cola (solo lectura) y reporta cuantos jobs pending hay y cual seria
 * el proximo elegible. Deliberadamente NO toma ni ejecuta nada.
 *
 * QUE FALTA (PR 5.2 - ejecucion real): reemplazar este peek por repo.claimNextJob() (claim atomico con
 * SKIP LOCKED), resolver la credencial de la boveda del job (por owner_id + credential_id), llamar a la
 * capa assembleAgentRun de apps/backend para armar el run, ejecutar runAgent con un deadline propio, y
 * cerrar el job con markCompleted / markFailed (con reintentos). Nada de eso ocurre en este PR: el
 * objetivo aqui es solo que el worker EXISTA, arranque y pueda LEER la cola.
 */
export async function pollQueueOnce(repo: JobsRepository, logger: Logger): Promise<void> {
  const pending = await repo.countPending();
  if (pending === 0) {
    logger.debug('cola vacia: no hay jobs pending');
    return;
  }
  // PEEK read-only (no claim): solo para loguear el proximo. El claim real es PR 5.2.
  const next = await repo.getNextPendingJob();
  logger.info('jobs pending en la cola (no se procesan todavia: ejecucion real en PR 5.2)', {
    pending,
    nextJobId: next?.id ?? null,
    nextAgentId: next?.agentId ?? null,
  });
}

export interface WorkerHandle {
  stop(): void;
}

/**
 * Arranca el loop de polling en intervalo. Hace una primera pasada inmediata y luego una cada
 * intervalMs. Un guard (inFlight) evita solapar pasadas si una consulta tarda mas que el intervalo.
 * Devuelve un handle con stop() para el shutdown limpio.
 */
export function startWorker(params: {
  repo: JobsRepository;
  logger: Logger;
  intervalMs: number;
}): WorkerHandle {
  const { repo, logger, intervalMs } = params;
  let inFlight = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      await pollQueueOnce(repo, logger);
    } catch (error) {
      logger.error('fallo al consultar la cola de jobs', {
        err: error instanceof Error ? error.message : 'desconocido',
      });
    } finally {
      inFlight = false;
    }
  };

  logger.info('worker iniciado: consultando la cola de jobs', { intervalMs });
  void tick();
  // El intervalo mantiene vivo el proceso (semantica de daemon): el worker poolea hasta que stop()
  // (disparado por SIGINT/SIGTERM en index.ts) lo detiene con un cierre limpio.
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
      logger.info('worker detenido');
    },
  };
}
