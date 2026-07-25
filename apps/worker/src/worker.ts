import { claimAndProcessOne, MAX_ATTEMPTS, REAP_STALE_MS, type JobRunnerDeps } from './execution.js';
import { barrerLoginsVencidos } from './sitios.js';
import { barrerAprobacionesVencidas } from './aprobaciones.js';
import type { Logger } from './logger.js';

/**
 * Cada cuanto, COMO MAXIMO, el worker corre el reaper de jobs detenidos (ms). El reaper es barato (un
 * SELECT indexado que casi siempre devuelve 0 filas), y con el umbral por LATIDO (90s, ver
 * REAP_STALE_MS) el barrido debe ser mas frecuente que antes para que un job detenido se detecte en
 * menos de 2 minutos de punta a punta (90s de umbral + hasta 30s de espera del barrido). La PRIMERA
 * pasada siempre reapea (lastReapAtMs arranca en 0), asi un worker que reinicia (Railway) recupera de
 * inmediato los jobs que dejo el proceso anterior muerto.
 */
const REAP_INTERVAL_MS = 30_000;

/**
 * REAPER de jobs detenidos POR LATIDO: recoge los jobs 'running' que dejaron de latir (worker muerto
 * entre el claim y el cierre, o proceso colgado sin event loop). Un job de sitio o tarea_web recogido
 * va DIRECTO a 'failed' (jamas se reencola: repetiria acciones sobre la cuenta del usuario); el resto
 * vuelve a 'pending' mientras le queden intentos. Best-effort: un fallo del reaper se registra y NO
 * rompe la pasada (el proximo tick reintenta).
 *
 * SEGURIDAD (jamas toca un job vivo): el umbral (REAP_STALE_MS = 3 latidos) supera con margen el
 * intervalo real de latido, el reclamo es un CAS por fila sobre status + updated_at (D2) y ademas el
 * reaper corre DENTRO del guard `inFlight` del tick, asi que nunca se solapa con un job que ESTE
 * proceso este ejecutando (que, por definicion, esta latiendo).
 */
async function reapOrphans(deps: JobRunnerDeps): Promise<void> {
  try {
    const reaped = await deps.jobs.reapOrphanedJobs({
      staleMs: REAP_STALE_MS,
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
   * Una pasada del worker: primero RECUPERA huerfanos y BARRE logins de sitios abandonados (ambos
   * throttled con el mismo intervalo), luego DRENA la cola. Corre entera dentro del guard `inFlight`,
   * asi ni el reaper ni el barrido se solapan con un job en vuelo de este proceso.
   */
  const runPass = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastReapAtMs >= REAP_INTERVAL_MS) {
      lastReapAtMs = now;
      await reapOrphans(deps);
      // BARRIDO de sitios (7.1b): cierra sesiones de login sin confirmar tras 10 min (nunca se dejan
      // sesiones colgadas: cuestan minutos del proveedor). Solo si sitios esta cableado (env de
      // Browserbase presente). Best-effort: sus fallos se loguean adentro y jamas rompen la pasada.
      if (deps.sitios && !shutdown.signal.aborted) {
        await barrerLoginsVencidos(deps.sitios, new Date(now));
      }
      // BARRIDO de aprobaciones (7.1e): expira los checkpoints sin decision, cierra su sesion de
      // navegador (mantenida viva mientras estuvo pendiente) y cierra el job pausado. Best-effort:
      // sus fallos se loguean adentro y jamas rompen la pasada.
      if (deps.barridoAprobaciones && !shutdown.signal.aborted) {
        await barrerAprobacionesVencidas(deps.barridoAprobaciones, new Date(now));
      }
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
