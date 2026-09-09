/**
 * Tipos y logica PURA del HISTORIAL DE EJECUCIONES (observabilidad de jobs) en la consola. Espeja la
 * forma camelCase que devuelve el backend (GET /v1/jobs, ver apps/backend/src/routes/jobs.ts). Sin React
 * ni red: las etiquetas de estado/tipo, la deteccion de jobs "en vuelo" (para el auto-refresh) y el
 * armado del querystring se testean como funciones puras, igual que scheduled-tasks.ts / recipes.ts.
 *
 * Es una vista de SOLO LECTURA: no hay reintento manual ni borrado (PR futuro). El backend NO expone el
 * payload (dato sensible) y trunca last_error; aca solo lo mostramos.
 */

import {
  ACCION_SIN_EFECTO_CONFIRMADO_PREFIX,
  GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES_PREFIX,
  MODELO_SIN_ACCESO_PREFIX,
} from '@ledesma-platform/shared/verificacion';
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
  /**
   * ETIQUETA DE TRANSPARENCIA: la tarea uso un procedimiento aprendido por OTRA cuenta (plantilla
   * compartida). No hubo aprobacion previa, asi que la tarjeta SIEMPRE lo dice. Lo deriva el backend
   * de jobs.resultado; aqui solo se pinta.
   */
  conProcedimientoAjeno?: boolean;
  /** Ademas, ese procedimiento ya estaba corroborado por varias cuentas independientes. */
  procedimientoCorroborado?: boolean;
  /**
   * El sitio cambio su interfaz y el agente lo detecto a tiempo, hizo la tarea por su cuenta y
   * reaprendio el procedimiento. Lo deriva el backend de jobs.resultado; aqui solo se pinta.
   */
  sitioCambio?: boolean;
  /**
   * La guardia con criterio generico corrio en MODO OBSERVACION y HABRIA detenido esta tarea: no se
   * detuvo nada. Lo deriva el backend de jobs.resultado; aqui solo se pinta.
   */
  guardiaHabriaDetenido?: boolean;
  /**
   * La tarea web termino con exito corriendo con el motor y su registro alcanza para GUARDARLA como
   * tarea aprendida (todavia sin guardar). Lo deriva el backend; ausente = no ofrecer el boton.
   */
  guardableComoTarea?: boolean;
  /** Esta tarea ya se guardo como tarea aprendida. */
  guardadaComoTarea?: boolean;
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
 * Intervalos del polling ADAPTATIVO de la LISTA de /actividad (semi tiempo real): con algun job en
 * vuelo entre los cargados, la lista se refresca cada JOBS_LISTA_EN_VUELO_MS para que el progreso
 * se vea sin refresh manual; con todo en estado terminal baja a JOBS_LISTA_REPOSO_MS en vez de
 * apagarse, porque una tarea RECIEN ENCOLADA desde otra pantalla (el Playground encola via el
 * agente) no figura entre los jobs cargados y con el polling apagado la tarjeta nueva jamas
 * aparecia sin interaccion. El endpoint de lista es barato (select paginado por owner+created_at
 * indexado, sin payload), y react-query no consulta con la pestana en background
 * (refetchIntervalInBackground=false por defecto).
 */
export const JOBS_LISTA_EN_VUELO_MS = 5_000;
export const JOBS_LISTA_REPOSO_MS = 30_000;

/** Intervalo adaptativo de la lista del historial segun los jobs ya cargados. */
export function intervaloRefetchDeLista(jobs: JobActivity[]): number {
  return hasInFlightJobs(jobs) ? JOBS_LISTA_EN_VUELO_MS : JOBS_LISTA_REPOSO_MS;
}

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

/**
 * Prefijo ESTABLE del last_error del job de promocion cuando la ejecucion incluye algo que todavia
 * no se puede convertir en repetible (mismo mecanismo que los dos anteriores; lo escribe el worker).
 * La tarjeta lo usa para mostrar el motivo real del fallo de guardado, sin invitar a reintentar:
 * reintentar no puede cambiar el resultado.
 */
export const PROMOCION_NO_REPETIBLE_PREFIX = 'PROMOCION_NO_REPETIBLE:';

/** true si el fallo de guardado es permanente: lo registrado no se puede volver repetible. */
export function esGuardadoNoRepetible(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(PROMOCION_NO_REPETIBLE_PREFIX);
}

/**
 * El MOTIVO de un fallo permanente de guardado, clasificado para la UI. El texto tras el prefijo es
 * el motivo del conversor del worker (estable y sin datos del usuario); aqui solo se reconocen las
 * familias que tienen mensaje propio y el resto cae al generico de fallo permanente. null si el
 * error no es un fallo permanente de guardado.
 */
export type MotivoNoRepetible =
  /** La ejecucion incluye una accion que el sistema todavia no sabe repetir (select, arrastre...). */
  | { tipo: 'metodo'; metodo: string }
  /**
   * Un paso quedo registrado sin ninguna forma de volver a encontrar su elemento. Cuando el worker
   * nombra el paso que bloqueo (motivos nuevos), `paso` y `descripcion` viajan para que el mensaje
   * de la UI diga cual fue en vez del generico.
   */
  | { tipo: 'sinEstrategia'; paso?: string; descripcion?: string }
  /** El registro no conserva como se llenaron todos los datos de la tarea. */
  | { tipo: 'datoSinCubrir' }
  /** Cualquier otro motivo permanente: mensaje generico que tampoco invita a reintentar. */
  | { tipo: 'generico' };

export function motivoDeGuardadoNoRepetible(error: unknown): MotivoNoRepetible | null {
  if (!esGuardadoNoRepetible(error) || !(error instanceof Error)) return null;
  const motivo = error.message.slice(PROMOCION_NO_REPETIBLE_PREFIX.length).trim();
  const metodo = /^metodo no re-ejecutable: (.+)$/.exec(motivo);
  // 'ninguno' es el placeholder del worker para un paso sin metodo registrado: no hay nombre util
  // que mostrar, asi que cae al mensaje generico de fallo permanente.
  if (metodo?.[1] !== undefined && metodo[1] !== 'ninguno') {
    return { tipo: 'metodo', metodo: metodo[1] };
  }
  if (metodo !== null) return { tipo: 'generico' };
  if (
    motivo.includes('sin ninguna estrategia de localizacion') ||
    motivo.includes('sin estrategia y sin paso adyacente')
  ) {
    // Los motivos nuevos del worker nombran el paso que bloqueo: "paso 13: type escribir el
    // cuerpo, sin ..." o "el click del paso 19 (click the message body area) quedo sin ...".
    const bloqueante =
      /^paso (\d+): (.+?), sin /.exec(motivo) ??
      /^el click del paso (\d+) \((.+?)\) quedo sin /.exec(motivo);
    if (bloqueante?.[1] !== undefined && bloqueante[2] !== undefined) {
      return { tipo: 'sinEstrategia', paso: bloqueante[1], descripcion: bloqueante[2] };
    }
    return { tipo: 'sinEstrategia' };
  }
  // El worker ya no aborta por una cabecera de llenado VACIA (esa no escribio nada), solo por el
  // paso que SI registro un dato del objetivo y que ningun otro paso vuelve a escribir. El motivo
  // viejo se sigue reconociendo: un job fallido de antes del cambio conserva su last_error.
  if (
    motivo.includes('de llenado sin campos registrados') ||
    motivo.includes('del objetivo y ningun otro paso lo cubre')
  ) {
    return { tipo: 'datoSinCubrir' };
  }
  return { tipo: 'generico' };
}

/** true si el job fallo porque su dueno lo termino desde la consola (etiqueta Cancelada). */
export function esJobCancelado(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return job.status === 'failed' && (job.lastError?.startsWith(CANCELADO_POR_USUARIO_PREFIX) ?? false);
}

/** true si el sistema termino el job porque dejo de responder (etiqueta Detenida). */
export function esJobDetenido(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return job.status === 'failed' && (job.lastError?.startsWith(SISTEMA_DETUVO_TAREA_PREFIX) ?? false);
}

/**
 * true si la tarea web ejecuto su paso final (enviar, pagar) y el sitio no mostro que surtiera
 * efecto (prefijo estable ACCION_SIN_EFECTO_CONFIRMADO del worker). La tarea AVANZO: el texto que se
 * muestra jamas dice "no se ejecuto nada"; puede haber quedado un borrador a medias en el sitio.
 */
export function esJobSinEfectoConfirmado(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return (
    job.status === 'failed' &&
    (job.lastError?.startsWith(ACCION_SIN_EFECTO_CONFIRMADO_PREFIX) ?? false)
  );
}

/**
 * true si el worker corto la corrida porque la guardia agoto los reintentos del paso irreversible
 * (prefijo estable GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES). Mismo mensaje veraz que el anterior.
 */
export function esJobBloqueadoPorReintentos(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return (
    job.status === 'failed' &&
    (job.lastError?.startsWith(GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES_PREFIX) ?? false)
  );
}

/**
 * true si la corrida se corto porque la LLAVE DEL MODELO no tiene saldo o no es valida (prefijo
 * estable MODELO_SIN_ACCESO del worker). No es un fallo de la tarea ni del objetivo: no tiene sentido
 * ofrecer un "detalle tecnico" que no orienta, ni invitar a reintentar. Lo unico accionable es
 * revisar la cuenta del proveedor del modelo, y eso es lo que dice el texto.
 */
export function esJobSinAccesoAlModelo(job: Pick<JobActivity, 'status' | 'lastError'>): boolean {
  return job.status === 'failed' && (job.lastError?.startsWith(MODELO_SIN_ACCESO_PREFIX) ?? false);
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
