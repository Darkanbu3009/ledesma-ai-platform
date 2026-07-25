/**
 * Tipos y logica PURA del HISTORIAL DE EJECUCIONES (observabilidad de jobs) en la consola. Espeja la
 * forma camelCase que devuelve el backend (GET /v1/jobs, ver apps/backend/src/routes/jobs.ts). Sin React
 * ni red: las etiquetas de estado/tipo, la deteccion de jobs "en vuelo" (para el auto-refresh) y el
 * armado del querystring se testean como funciones puras, igual que scheduled-tasks.ts / recipes.ts.
 *
 * Es una vista de SOLO LECTURA: no hay reintento manual ni borrado (PR futuro). El backend NO expone el
 * payload (dato sensible) y trunca last_error; aca solo lo mostramos.
 */

import i18n from '../i18n';

/** Tipo inferido del job (del payload, sin exponerlo): receta multi-paso, mensaje suelto, sitio
 *  conectado o tarea web (la unica con trayectoria V030 que abrir). */
export type JobType = 'recipe' | 'simple' | 'sitio' | 'tarea_web';

/** Estados de la cola (mismos que el backend: CHECK de V008 + 'pausado' de V027). */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'pausado';

/** Una ejecucion del historial, tal como la devuelve GET /v1/jobs (sin payload; last_error truncado). */
export interface JobActivity {
  id: string;
  type: JobType;
  /** Agente que ejecuto (la pantalla resuelve el nombre con useAgents). null en jobs de sitios. */
  agentId: string | null;
  status: JobStatus;
  attempts: number;
  /** Detalle del ultimo fallo (ya truncado por el backend). null si nunca fallo. */
  lastError: string | null;
  scheduledFor: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /**
   * La tarea se ejecuto con lo APRENDIDO de una vez anterior, sin volver a analizar el sitio. Lo
   * deriva el backend de jobs.resultado; aqui solo se pinta la etiqueta.
   */
  conLoAprendido?: boolean;
  /** Ademas, el sitio habia cambiado y la tarea se ajusto sola. */
  ajustadaSola?: boolean;
}

/** Una pagina del historial: los jobs + la metadata de paginacion que devuelve el backend. */
export interface JobsPage {
  jobs: JobActivity[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}

/** Tamano de pagina del historial (alineado con el default del backend). */
export const JOB_PAGE_SIZE = 20;

/** Intervalo de auto-refresh cuando hay ejecuciones en vuelo (ms). */
export const JOBS_REFETCH_MS = 10_000;

/**
 * Umbral del AVISO de tarea lenta (ms): una ejecucion en curso que supera este tiempo muestra un
 * aviso destacado con el boton de terminarla. Es informativo: la decision de terminar una tarea que
 * sigue avanzando es SIEMPRE del usuario; el sistema jamas la termina por su cuenta en este caso.
 */
export const AVISO_TAREA_LENTA_MS = 180_000;

/**
 * Prefijos ESTABLES de lastError con los que el backend distingue como termino un job 'failed' (sin
 * estado nuevo en la base): terminado por el usuario desde la consola, o terminado por el sistema
 * al dejar de responder. La UI los detecta para etiquetar Cancelada / Detenida y para reemplazar el
 * texto tecnico del error por uno legible.
 */
export const CANCELADO_POR_USUARIO_PREFIX = 'CANCELADO_POR_USUARIO:';
export const SISTEMA_DETUVO_TAREA_PREFIX = 'SISTEMA_DETUVO_TAREA:';

/** true si el job fallo porque su dueno lo termino desde la consola (etiqueta Cancelada). */
export function esJobCancelado(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return job.status === 'failed' && (job.lastError?.startsWith(CANCELADO_POR_USUARIO_PREFIX) ?? false);
}

/** true si el sistema termino el job porque dejo de responder (etiqueta Detenida). */
export function esJobDetenido(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return job.status === 'failed' && (job.lastError?.startsWith(SISTEMA_DETUVO_TAREA_PREFIX) ?? false);
}

/**
 * Milisegundos que lleva EN EJECUCION un job 'running' (contra el reloj `ahora`). null si no esta
 * en ejecucion o no tiene startedAt usable. Pura para testear el umbral del aviso sin relojes.
 */
export function msEnEjecucion(
  job: Pick<JobActivity, 'status' | 'startedAt'>,
  ahora: number,
): number | null {
  if (job.status !== 'running' || job.startedAt === null) return null;
  const inicio = new Date(job.startedAt).getTime();
  if (Number.isNaN(inicio)) return null;
  return Math.max(0, ahora - inicio);
}

/** Filtro de estado en la UI. 'all' = todos (sin filtro en la query). */
export type JobStatusFilter = JobStatus | 'all';

/** Opciones del selector de filtro por estado (orden de aparicion en la UI). */
export const JOB_STATUS_FILTERS: { value: JobStatusFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'actividad.filtros.todas' },
  { value: 'pending', labelKey: 'actividad.jobEstado.pendiente' },
  { value: 'running', labelKey: 'actividad.jobEstado.enCurso' },
  { value: 'completed', labelKey: 'actividad.jobEstado.completada' },
  { value: 'failed', labelKey: 'actividad.jobEstado.fallida' },
  { value: 'pausado', labelKey: 'actividad.jobEstado.pausada' },
];

/** Etiqueta legible del estado de un job. */
export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return i18n.t('actividad.jobEstado.pendiente');
    case 'running':
      return i18n.t('actividad.jobEstado.enCurso');
    case 'completed':
      return i18n.t('actividad.jobEstado.completada');
    case 'failed':
      return i18n.t('actividad.jobEstado.fallida');
    case 'pausado':
      return i18n.t('actividad.jobEstado.pausada');
    default:
      return status;
  }
}

/** Etiqueta legible del tipo de job: receta (multi-paso), mensaje (suelto), sitio o tarea web. */
export function jobTypeLabel(type: JobType): string {
  if (type === 'recipe') return i18n.t('actividad.jobTipo.receta');
  if (type === 'sitio') return i18n.t('actividad.jobTipo.sitio');
  if (type === 'tarea_web') return i18n.t('actividad.jobTipo.tareaWeb');
  return i18n.t('actividad.jobTipo.mensaje');
}

/** Un job pending, running o pausado sigue "en vuelo": su estado puede cambiar (un pausado espera
 *  una decision humana y volvera a moverse) y justifica auto-refrescar. */
export function isJobInFlight(status: JobStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'pausado';
}

/**
 * ¿Hay algun job en vuelo (pending/running) entre los cargados? La pagina lo usa para decidir si
 * conviene auto-refrescar: si todo esta en estado terminal (completed/failed), NO reconsulta el API.
 */
export function hasInFlightJobs(jobs: JobActivity[]): boolean {
  return jobs.some((job) => isJobInFlight(job.status));
}

/**
 * Arma el querystring de una pagina del historial: limit, offset y, si el filtro no es 'all', el status.
 * Mantiene la construccion de la URL en un unico lugar testeable (el hook solo la consume).
 */
export function buildJobsQuery(params: { limit: number; offset: number; status?: JobStatusFilter }): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.status && params.status !== 'all') {
    search.set('status', params.status);
  }
  return `?${search.toString()}`;
}
