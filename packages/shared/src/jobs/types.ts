/**
 * Tipos de la COLA DE TAREAS de la ejecucion autonoma (Fase 5). Viven en packages/shared porque los
 * consumen DOS workspaces: el backend (que encolara jobs desde triggers/scheduler en PRs siguientes)
 * y el worker (apps/worker, que los toma de la cola). El esquema fisico vive en
 * apps/backend/migrations/V008__jobs.sql.
 */

/** Estados REALES de cola (no solo terminales): pending -> running -> completed|failed. */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Una tarea de la cola, tal como vive en la tabla `jobs`. snake_case -> camelCase. */
export interface Job {
  id: string;
  /** Agente a ejecutar. */
  agentId: string;
  /** Dueno de la tarea (sub del JWT), misma tenancy que agents.owner_id. */
  ownerId: string;
  /** Credencial de la boveda a usar al ejecutar (provider_credentials.id). */
  credentialId: string;
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

/** Campos para encolar una tarea nueva. El resto (status, attempts, timestamps) lo pone la base. */
export interface CreateJobInput {
  agentId: string;
  ownerId: string;
  credentialId: string;
  payload: unknown;
  /** null/ausente = ASAP. Acepta Date o ISO string. */
  scheduledFor?: Date | string | null;
}

/**
 * Tipo de un job INFERIDO del payload (para OBSERVABILIDAD): 'recipe' si el payload lleva el
 * discriminador kind === 'recipe' (ver recipe-payload.ts), 'simple' en cualquier otro caso (el job de
 * un mensaje suelto). Es lo unico que se puede saber del payload SIN exponerlo: el origen
 * (scheduler/trigger/manual) NO es inferible sin cambios de esquema, asi que no se modela aqui.
 */
export type JobType = 'recipe' | 'simple';

/**
 * RESUMEN de un job para el historial de ejecuciones (listado de OBSERVABILIDAD). Deliberadamente NO
 * incluye el `payload` (contiene mensajes del usuario / snapshots de recetas: dato sensible) ni el
 * `ownerId` (siempre es el del que consulta). En su lugar expone `type`, inferido del payload en la
 * propia query. `lastError` viaja COMPLETO desde el repo; la capa HTTP lo trunca antes de serializar.
 */
export interface JobSummary {
  id: string;
  /** Agente que ejecuto (o ejecutara) el job. */
  agentId: string;
  status: JobStatus;
  /** Tipo inferido del payload: 'recipe' o 'simple'. Sin exponer el payload. */
  type: JobType;
  attempts: number;
  /** Detalle del ultimo fallo (COMPLETO aqui; la ruta lo trunca). null si nunca fallo. */
  lastError: string | null;
  scheduledFor: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
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
