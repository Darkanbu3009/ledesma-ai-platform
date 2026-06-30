import { claimAndProcessOne, type JobRunnerDeps } from './execution.js';
import type { Logger } from './logger.js';

/**
 * Drena la cola en una pasada: reclama y ejecuta jobs uno por uno (claim atomico) hasta vaciarla, o
 * hasta que llegue el apagado. claimAndProcessOne ya captura el fallo de CADA job (un job roto no
 * detiene el drenado). Si lanza algo a nivel del ciclo (p.ej. la DB se cae en el claim, o un cierre de
 * estado falla), se registra y se CORTA la pasada: no se entra en un bucle apretado contra una DB
 * caida; el proximo tick reintenta tras el intervalo.
 */
export async function drainQueue(deps: JobRunnerDeps, shutdownSignal: AbortSignal): Promise<void> {
  while (!shutdownSignal.aborted) {
    let result: 'empty' | 'processed';
    try {
      result = await claimAndProcessOne(deps, shutdownSignal);
    } catch (error) {
      deps.logger.error('fallo en el ciclo de la cola; se reintenta en el proximo intervalo', {
        err: error instanceof Error ? error.message : 'desconocido',
      });
      return;
    }
    if (result === 'empty') return;
  }
}

export interface WorkerHandle {
  /** Detiene el loop (no toma nuevos jobs), aborta el job en curso y espera a que termine. */
  stop(): Promise<void>;
}

/**
 * Arranca el loop de ejecucion en intervalo. Hace una primera pasada inmediata y luego una cada
 * intervalMs. Un guard (inFlight) evita solapar pasadas si una tarda mas que el intervalo. Devuelve un
 * handle con stop() para el shutdown limpio: deja de tomar jobs, aborta el run en curso (que se devuelve
 * a 'pending' para re-reclamar) y espera a que la pasada en vuelo termine antes de resolver.
 */
export function startWorker(params: {
  deps: JobRunnerDeps;
  logger: Logger;
  intervalMs: number;
}): WorkerHandle {
  const { deps, logger, intervalMs } = params;
  const shutdown = new AbortController();
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = drainQueue(deps, shutdown.signal).finally(() => {
      inFlight = null;
    });
    await inFlight;
  };

  logger.info('worker iniciado: ejecutando jobs de la cola', { intervalMs });
  void tick();
  // El intervalo mantiene vivo el proceso (semantica de daemon): el worker poolea hasta que stop()
  // (disparado por SIGINT/SIGTERM en index.ts) lo detiene con un cierre limpio.
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Aborta el run en curso: el job se devuelve a 'pending' (re-reclamable), no se corrompe estado.
      shutdown.abort();
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // drainQueue ya registra sus propios fallos; el cierre nunca lanza.
        }
      }
      logger.info('worker detenido');
    },
  };
}
