/**
 * Tipos de la COLA DE TAREAS de la ejecucion autonoma (Fase 5). Viven en packages/shared porque los
 * consumen DOS workspaces: el backend (que encolara jobs desde triggers/scheduler en PRs siguientes)
 * y el worker (apps/worker, que los toma de la cola). El esquema fisico vive en
 * apps/backend/migrations/V008__jobs.sql.
 */

/**
 * Estados REALES de cola (no solo terminales): pending -> running -> completed|failed. 'pausado'
 * (V027, 7.1e) es el estado de un job de tarea web detenido en un checkpoint de aprobacion humana:
 * el claim no lo toma y el reaper no lo toca; vuelve a 'pending' cuando el humano decide, o a
 * 'failed' si la aprobacion expira sin decision.
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'pausado';

/** Una tarea de la cola, tal como vive en la tabla `jobs`. snake_case -> camelCase. */
export interface Job {
  id: string;
  /** Agente a ejecutar. null SOLO en jobs de sitios conectados (V026): no ejecutan ningun modelo. */
  agentId: string | null;
  /** Dueno de la tarea (sub del JWT), misma tenancy que agents.owner_id. */
  ownerId: string;
  /** Credencial de la boveda a usar al ejecutar (provider_credentials.id). null solo en jobs de sitios. */
  credentialId: string | null;
  status: JobStatus;
  /** Mensajes/input de la tarea (mismo shape que el body de /v1/run/:agentId). */
  payload: unknown;
  /** Cuando debe ejecutarse, en ISO 8601. null = ASAP. */
  scheduledFor: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Campos para encolar una tarea nueva. El resto (status, attempts, timestamps) lo pone la base.
 *  agentId/credentialId van en null SOLO para jobs de sitios conectados (no ejecutan modelo). */
export interface CreateJobInput {
  agentId: string | null;
  ownerId: string;
  credentialId: string | null;
  payload: unknown;
  /** null/ausente = ASAP. Acepta Date o ISO string. */
  scheduledFor?: Date | string | null;
}

/**
 * Tipo de un job INFERIDO del payload (para OBSERVABILIDAD): 'recipe' si el payload lleva el
 * discriminador kind === 'recipe' (ver recipe-payload.ts), 'sitio' si lleva uno de los tres kinds de
 * sitios conectados (ver sitio-payload.ts), 'tarea_web' si lleva el kind de tarea web (ver
 * tarea-web-payload.ts; la UI lo usa para ofrecer la vista de trayectoria, V030) y 'simple' en
 * cualquier otro caso (el job de un mensaje suelto). Es lo unico que se puede saber del payload SIN
 * exponerlo: el origen (scheduler/trigger/manual) NO es inferible sin cambios de esquema, asi que no
 * se modela aqui.
 */
export type JobType = 'recipe' | 'simple' | 'sitio' | 'tarea_web';

/**
 * RESUMEN de un job para el historial de ejecuciones (listado de OBSERVABILIDAD). Deliberadamente NO
 * incluye el `payload` (contiene mensajes del usuario / snapshots de recetas: dato sensible) ni el
 * `ownerId` (siempre es el del que consulta). En su lugar expone `type`, inferido del payload en la
 * propia query. `lastError` viaja COMPLETO desde el repo; la capa HTTP lo trunca antes de serializar.
 */
export interface JobSummary {
  id: string;
  /** Agente que ejecuto (o ejecutara) el job. null en jobs de sitios conectados (sin agente). */
  agentId: string | null;
  status: JobStatus;
  /** Tipo inferido del payload: 'recipe', 'sitio' o 'simple'. Sin exponer el payload. */
  type: JobType;
  attempts: number;
  /** Detalle del ultimo fallo (COMPLETO aqui; la ruta lo trunca). null si nunca fallo. */
  lastError: string | null;
  scheduledFor: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /**
   * La tarea web se ejecuto con lo APRENDIDO de una vez anterior, sin volver a analizar el sitio
   * (Fase F paso 2). Es un escalar derivado de jobs.resultado, no el resultado: el listado sigue sin
   * exponerlo. false en todo lo demas.
   */
  conLoAprendido: boolean;
  /** Ademas, el sitio habia cambiado y la tarea se ajusto sola durante esa ejecucion. */
  ajustadaSola: boolean;
  /**
   * La tarea web se ejecuto con un PROCEDIMIENTO APRENDIDO POR OTRA CUENTA (plantilla compartida,
   * V041). Es la ETIQUETA DE TRANSPARENCIA del consumo sin aprobacion: el usuario no aprueba, pero
   * siempre puede ver que la tarea uso un procedimiento ajeno. Escalar derivado de jobs.resultado
   * (`via = 'plantilla_compartida'`), nunca el resultado entero. false en todo lo demas.
   */
  conProcedimientoAjeno: boolean;
  /** Ademas, ese procedimiento ya estaba CORROBORADO por origenes y consumidores distintos. */
  procedimientoCorroborado: boolean;
  /**
   * El SITIO CAMBIO su interfaz y la corrida se adapto sola (D6 de resiliencia): la sonda
   * pre-flight detecto el desajuste antes de ejecutar un solo paso, la tarea corrio por el motor
   * libre y el cierre exitoso reaprendio el procedimiento. Escalar derivado de jobs.resultado
   * (`desajusteDeInterfaz`), nunca el resultado entero. false en todo lo demas.
   */
  sitioCambio: boolean;
  /**
   * La GUARDIA CON CRITERIO GENERICO corrio en MODO OBSERVACION y HABRIA DETENIDO esta tarea; no
   * detuvo nada y la tarea siguio su curso. Es la telemetria con la que se mide la inversion del
   * default (una intencion que el sistema no reconoce deja de pasar sin comparar) antes de
   * encenderla. Escalar derivado de jobs.resultado (`guardiaSinIntencion.habriaDetenido`), nunca el
   * resultado entero. false en todo lo demas.
   */
  guardiaHabriaDetenido: boolean;
}

/**
 * Fila devuelta por el REAPER de jobs huerfanos (recuperacion de jobs 'running' que quedaron atascados
 * porque el worker murio entre el claim y el cierre). Es lo minimo que necesita el worker para LOGUEAR
 * que recupero, sin traer el payload. `status` es el estado AL QUE se movio el job: 'pending'
 * (re-reclamable) o 'failed' (ya habia agotado los intentos).
 */
export interface ReapedJob {
  id: string;
  status: JobStatus;
  attempts: number;
}

/**
 * VISTA de un job para la TOOL DE CONSULTA del agente (7.1d): el estado de cola + el resultado (si
 * termino) + el ultimo error (si fallo). Deliberadamente NO incluye el payload ni el owner: la tool
 * ya consulta acotada por owner_id y el agente solo necesita saber en que quedo el job.
 */
export interface JobConsulta {
  id: string;
  status: JobStatus;
  /** Resultado que el worker guardo al completar (jobs.resultado, V026). null si no hay. */
  resultado: unknown;
  /** Detalle del ultimo fallo. null si nunca fallo. */
  lastError: string | null;
}

/** Opciones del listado paginado por owner (observabilidad). status opcional = todos los estados. */
export interface ListJobsByOwnerOptions {
  /** Maximo de filas a devolver (la ruta lo acota; el repo confia en el valor ya validado). */
  limit: number;
  /** Desplazamiento para paginar (0 = primera pagina). */
  offset: number;
  /** Filtro opcional por estado. Ausente = todos. */
  status?: JobStatus;
}

/**
 * Conteo de jobs de UN owner desglosado por estado de cola, para el eje OPERACIONES del dashboard. Las
 * cuatro claves SIEMPRE estan presentes (un estado sin filas cuenta 0), asi el consumidor nunca tropieza
 * con un estado ausente. Es una FOTO del estado ACTUAL de la cola del owner (no acotada por fecha):
 * pending/running reflejan lo que hay en vuelo ahora; completed/failed acumulan dentro de la retencion.
 */
export interface JobStatusCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  /** Jobs detenidos en un checkpoint de aprobacion humana (V027, 7.1e). */
  pausado: number;
}
