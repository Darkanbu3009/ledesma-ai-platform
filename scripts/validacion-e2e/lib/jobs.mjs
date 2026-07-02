import { esperarHasta } from './http.mjs';

/**
 * Lectura de la cola `jobs` via PostgREST (HTTPS). El owner de prueba es NUEVO en cada corrida y
 * solo tiene los jobs que este script genera, asi que la atribucion de jobs se hace por (marca unica
 * en el payload) + (ids ya vistos), sin depender de timestamps de la base (evita sesgos de reloj
 * entre el runner y Postgres).
 */

const COLUMNAS = 'id,status,attempts,last_error,payload,created_at,started_at,finished_at';

/** Lee un job por id, acotado al owner de prueba. */
export async function leerJob(db, ownerId, jobId) {
  const filas = await db.get('jobs', `id=eq.${jobId}&owner_id=eq.${ownerId}&select=${COLUMNAS}`);
  return filas[0] ?? null;
}

/**
 * Pollea hasta que el job llegue a un estado TERMINAL (completed/failed) o venza el plazo. Devuelve
 * { desenlace: 'completed'|'failed'|'timeout'|'desaparecido', job }. El timeout con status 'pending'
 * es la falla caracteristica de "el worker desplegado no esta tomando jobs".
 */
export async function esperarJobTerminal(db, ownerId, jobId, { plazoMs = 180_000, intervaloMs = 5_000 } = {}) {
  let ultimo = null;
  const terminal = await esperarHasta(
    async () => {
      ultimo = await leerJob(db, ownerId, jobId);
      if (ultimo === null) return { desenlace: 'desaparecido', job: null };
      if (ultimo.status === 'completed' || ultimo.status === 'failed') {
        return { desenlace: ultimo.status, job: ultimo };
      }
      return null;
    },
    { plazoMs, intervaloMs },
  );
  if (terminal !== null) return terminal;
  return { desenlace: 'timeout', job: ultimo };
}

/**
 * Encuentra el job NUEVO del owner cuyo payload contiene la `marca` (texto unico por fuente:
 * scheduler / trigger hmac / trigger url_token) y que no este en `conocidos` (Set de ids). Trae los
 * jobs del owner (son pocos: solo los del usuario de prueba) y filtra la marca en JS sobre el
 * payload jsonb.
 */
export async function encontrarJobNuevo(db, ownerId, conocidos, marca, { plazoMs = 150_000, intervaloMs = 5_000 } = {}) {
  return esperarHasta(
    async () => {
      const filas = await db.get('jobs', `owner_id=eq.${ownerId}&select=${COLUMNAS}&order=created_at.asc`);
      const nuevo = filas.find((f) => !conocidos.has(f.id) && JSON.stringify(f.payload ?? '').includes(marca));
      return nuevo ?? null;
    },
    { plazoMs, intervaloMs },
  );
}

/** Resumen diagnosticable de un job para la evidencia del informe. */
export function resumenJob(job) {
  if (!job) return 'job no encontrado';
  return `status=${job.status}, attempts=${job.attempts}, last_error=${job.last_error === null ? 'null' : `'${String(job.last_error).slice(0, 200)}'`}`;
}
