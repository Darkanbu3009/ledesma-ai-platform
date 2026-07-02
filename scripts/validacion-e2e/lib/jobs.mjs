import { esperarHasta } from './http.mjs';

/** Lee un job por id (estado + diagnostico), acotado al owner de prueba. */
export async function leerJob(sql, ownerId, jobId) {
  const filas = await sql`
    select id, status, attempts, last_error, created_at, started_at, finished_at
    from jobs where id = ${jobId} and owner_id = ${ownerId}
  `;
  return filas[0] ?? null;
}

/**
 * Pollea la tabla jobs hasta que el job llegue a un estado TERMINAL (completed/failed) o venza el
 * plazo. Devuelve { desenlace: 'completed'|'failed'|'timeout'|'desaparecido', job }. El timeout con
 * status 'pending' es la falla caracteristica de "el worker desplegado no esta tomando jobs".
 */
export async function esperarJobTerminal(sql, ownerId, jobId, { plazoMs = 180_000, intervaloMs = 5_000 } = {}) {
  let ultimo = null;
  const terminal = await esperarHasta(
    async () => {
      ultimo = await leerJob(sql, ownerId, jobId);
      if (ultimo === null) return { desenlace: 'desaparecido', job: null };
      if (ultimo.status === 'completed' || ultimo.status === 'failed') {
        return { desenlace: ultimo.status, job: ultimo };
      }
      return null;
    },
    { plazoMs, intervaloMs, descripcion: `job ${jobId} terminal` },
  );
  if (terminal !== null) return terminal;
  return { desenlace: 'timeout', job: ultimo };
}

/** Hora del SERVIDOR de la base (evita sesgos entre el reloj local y el created_at que pone la DB). */
export async function ahoraDb(sql) {
  const filas = await sql`select now() as t`;
  return filas[0].t;
}

/**
 * Encuentra el job NUEVO del owner creado a partir de `desde` (timestamp de la DB) que no este en
 * `conocidos` (Set de ids) y cuyo payload contenga la `marca` (texto unico por fuente: scheduler /
 * trigger hmac / trigger url_token). La marca discrimina jobs de fuentes distintas aunque se
 * solapen en el tiempo (p.ej. un segundo encolado del scheduler antes de desactivar la tarea).
 */
export async function encontrarJobNuevo(sql, ownerId, desde, conocidos, marca, { plazoMs = 150_000, intervaloMs = 5_000 } = {}) {
  const patron = `%${marca}%`;
  return esperarHasta(
    async () => {
      const filas = await sql`
        select id, status, attempts, last_error, created_at
        from jobs
        where owner_id = ${ownerId} and created_at >= ${desde} and payload::text like ${patron}
        order by created_at asc
      `;
      const nuevo = filas.find((f) => !conocidos.has(f.id));
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
