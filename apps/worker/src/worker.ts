import { claimAndProcessOne, MAX_ATTEMPTS, reapThresholdsMs, type JobRunnerDeps } from './execution.js';
import type { Logger } from './logger.js';

/**
 * Cada cuanto, COMO MAXIMO, el worker corre el reaper de jobs huerfanos (ms). El reaper es barato (un
 * UPDATE indexado que casi siempre afecta 0 filas), pero no hace falta correrlo en cada tick de polling:
 * un huerfano solo aparece cuando un worker muere, y el margen de recuperacion ya es de decenas de
 * minutos. 60s da una recuperacion pronta sin ruido de escritura. La PRIMERA pasada siempre reapea
 * (lastReapAtMs arranca en 0), asi un worker que reinicia (Railway) recupera de inmediato los huerfanos
 * que dejo el proceso anterior muerto.
 */
const REAP_INTERVAL_MS = 60_000;

/**
 * REAPER de jobs huerfanos (cierra H3/H4 del informe 06): devuelve a 'pending' (o 'failed' si ya
 * agotaron intentos) los jobs 'running' que quedaron atascados porque el worker murio entre el claim y
 * el cierre. Best-effort: un fallo del reaper se registra y NO rompe la pasada (el proximo tick reintenta).
 *
 * SEGURIDAD (jamas toca un job vivo): corre DENTRO del guard `inFlight` del tick, asi que nunca se
 * solapa con un job que ESTE proceso este ejecutando; y ademas solo recupera jobs cuyo started_at supera
 * un MARGEN AMPLIO por tipo (ver reapThresholdsMs), que excede el maximo wall-clock legitimo. Doble red.
 */
async function reapOrphans(deps: JobRunnerDeps): Promise<void> {
  const { simpleMs, recipeMs } = reapThresholdsMs(deps.config.runTimeoutMs);
  try {
    const reaped = await deps.jobs.reapOrphanedJobs({
      simpleThresholdMs: simpleMs,
      recipeThresholdMs: recipeMs,
      maxAttempts: MAX_ATTEMPTS,
    });
    if (reaped.length > 0) {
      deps.logger.warn('reaper: jobs huerfanos recuperados', {
        count: reaped.length,
        toPending: reaped.filter((j) => j.status === 'pending').length,
        toFailed: reaped.filter((j) => j.status === 'failed').length,
        ids: reaped.map((j) => j.id),
      });
    }
  } catch (error) {
    deps.logger.error('reaper: fallo al recuperar jobs huerfanos (se ignora; se reintenta en el proximo ciclo)', {
      err: error instanceof Error ? error.message : 'desconocido',
    });
  }
}

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
  let lastReapAtMs = 0;

  /**
   * Una pasada del worker: primero RECUPERA huerfanos (throttled), luego DRENA la cola. Corre entera
   * dentro del guard `inFlight`, asi el reaper nunca se solapa con un job en vuelo de este proceso.
   */
  const runPass = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastReapAtMs >= REAP_INTERVAL_MS) {
      lastReapAtMs = now;
      await reapOrphans(deps);
    }
    if (shutdown.signal.aborted) return;
    await drainQueue(deps, shutdown.signal);
  };

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = runPass().finally(() => {
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
