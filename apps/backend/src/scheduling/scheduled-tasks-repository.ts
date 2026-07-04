import type { Sql } from '../db/client.js';

/**
 * Acceso a datos de las TAREAS PROGRAMADAS (tabla `scheduled_tasks`, V009). Recibe el cliente sql por
 * inyeccion (testeable), mismo patron que AgentRepository / ProviderCredentialRepository, y SIEMPRE
 * acota por owner_id en lecturas/escrituras por id: una tarea ajena nunca se resuelve ni se modifica.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej.
 * V009 sin aplicar), Postgres falla ruidosamente en vez de devolver una tarea con campos undefined.
 *
 * El disparo por horario (pg_cron, V010) NO pasa por aqui: lee y avanza scheduled_tasks en SQL puro.
 * Este repositorio cubre el CRUD del usuario (crear/listar/editar/borrar via los endpoints del backend).
 */

/** Una tarea programada, tal como vive en la tabla `scheduled_tasks`. snake_case -> camelCase. */
export interface ScheduledTask {
  id: string;
  /** Dueno de la tarea (sub del JWT), misma tenancy que agents.owner_id. */
  ownerId: string;
  /** Agente a ejecutar cada vez que el horario llega. */
  agentId: string;
  /** Credencial de la boveda a usar al ejecutar (provider_credentials.id). */
  credentialId: string;
  /** Horario en formato cron estandar de 5 campos (interpretado en UTC). */
  cronExpression: string;
  /** Mensajes/input fijos que se ejecutan cada vez (mismo shape que el payload de un job). */
  payload: unknown;
  /** Pausar/activar sin borrar: solo las activas se disparan. */
  isActive: boolean;
  /** Ultima vez que el disparo encolo un job para esta tarea (ISO). null = nunca corrio. */
  lastRunAt: string | null;
  /** Proximo horario en que toca correr (ISO). null = sin proximo run (cron imposible o pausada). */
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Insumos para crear una tarea. isActive/timestamps los pone la base; nextRunAt lo calcula la ruta. */
export interface CreateScheduledTaskInput {
  ownerId: string;
  agentId: string;
  credentialId: string;
  cronExpression: string;
  payload: unknown;
  /** Proximo run calculado a partir del cron (nextCronRun). Acepta Date o ISO; null = sin proximo. */
  nextRunAt?: Date | string | null;
}

/** Campos editables de una tarea. La ruta los fusiona (lee la actual + el patch) y pasa el set final. */
export interface UpdateScheduledTaskFields {
  cronExpression: string;
  payload: unknown;
  isActive: boolean;
  /** Recalculado por la ruta cuando cambia el cron o se reactiva la tarea. */
  nextRunAt: Date | string | null;
}

interface ScheduledTaskRow {
  id: string;
  owner_id: string;
  agent_id: string;
  credential_id: string;
  cron_expression: string;
  payload: unknown;
  is_active: boolean;
  last_run_at: Date | string | null;
  next_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar RangeError. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO de epoch: fallback no-lanzante para los timestamps not-null (created_at/updated_at). */
const EPOCH_ISO = new Date(0).toISOString();

function rowToTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    credentialId: row.credential_id,
    cronExpression: row.cron_expression,
    payload: row.payload,
    isActive: row.is_active,
    lastRunAt: toIso(row.last_run_at),
    nextRunAt: toIso(row.next_run_at),
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
    updatedAt: toIso(row.updated_at) ?? EPOCH_ISO,
  };
}

export class ScheduledTaskRepository {
  constructor(private readonly sql: Sql) {}

  /** Crea una tarea programada. is_active/timestamps los pone la base; next_run_at lo calcula la ruta. */
  async createTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    const rows = await this.sql<ScheduledTaskRow[]>`
      insert into scheduled_tasks (owner_id, agent_id, credential_id, cron_expression, payload, next_run_at)
      values (
        ${input.ownerId},
        ${input.agentId},
        ${input.credentialId},
        ${input.cronExpression},
        ${this.sql.json(input.payload as Parameters<Sql['json']>[0])},
        ${input.nextRunAt ?? null}
      )
      returning id, owner_id, agent_id, credential_id, cron_expression, payload, is_active,
        last_run_at, next_run_at, created_at, updated_at
    `;
    return rowToTask(rows[0] as ScheduledTaskRow);
  }

  /** Lista las tareas del owner (mas nuevas primero), con su estado, ultimo y proximo run. */
  async listTasksByOwner(ownerId: string): Promise<ScheduledTask[]> {
    const rows = await this.sql<ScheduledTaskRow[]>`
      select id, owner_id, agent_id, credential_id, cron_expression, payload, is_active,
        last_run_at, next_run_at, created_at, updated_at
      from scheduled_tasks
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToTask);
  }

  /** Resuelve UNA tarea del owner por id. null si no existe o no es del owner (aislamiento por owner). */
  async getTaskForOwner(id: string, ownerId: string): Promise<ScheduledTask | null> {
    const rows = await this.sql<ScheduledTaskRow[]>`
      select id, owner_id, agent_id, credential_id, cron_expression, payload, is_active,
        last_run_at, next_run_at, created_at, updated_at
      from scheduled_tasks
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToTask(row) : null;
  }

  /**
   * Actualiza una tarea del owner con el set de campos YA FUSIONADO por la ruta (cron, payload,
   * is_active, next_run_at). Acotado por id + owner_id: una tarea ajena no se toca (-> null). El
   * recalculo de next_run_at al cambiar el cron / reactivar lo decide la ruta, no este metodo.
   */
  async updateTaskForOwner(
    id: string,
    ownerId: string,
    fields: UpdateScheduledTaskFields,
  ): Promise<ScheduledTask | null> {
    const rows = await this.sql<ScheduledTaskRow[]>`
      update scheduled_tasks set
        cron_expression = ${fields.cronExpression},
        payload = ${this.sql.json(fields.payload as Parameters<Sql['json']>[0])},
        is_active = ${fields.isActive},
        next_run_at = ${fields.nextRunAt ?? null},
        updated_at = now()
      where id = ${id} and owner_id = ${ownerId}
      returning id, owner_id, agent_id, credential_id, cron_expression, payload, is_active,
        last_run_at, next_run_at, created_at, updated_at
    `;
    const row = rows[0];
    return row ? rowToTask(row) : null;
  }

  /**
   * CONTEO de tareas programadas ACTIVAS del owner (is_active = true), para el eje OPERACIONES del
   * dashboard. UNA query agregada (count server-side), read-only y aislada por owner_id: no trae la lista
   * entera solo para contarla. count(*)::int llega como number; el Number() es defensa extra.
   */
  async countActiveByOwner(ownerId: string): Promise<number> {
    const rows = await this.sql<Array<{ count: number | string }>>`
      select count(*)::int as count
      from scheduled_tasks
      where owner_id = ${ownerId} and is_active = true
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /** Borra una tarea del owner. true si borro una fila propia; false si ajena o inexistente. */
  async deleteTaskForOwner(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from scheduled_tasks
      where id = ${id} and owner_id = ${ownerId}
      returning id
    `;
    return rows.length > 0;
  }
}
