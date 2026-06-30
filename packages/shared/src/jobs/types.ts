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
