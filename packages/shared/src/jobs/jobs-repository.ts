import type postgres from 'postgres';
import type { CreateJobInput, Job, JobStatus } from './types.js';

/**
 * Cliente postgres (tagged template) que el repositorio recibe por inyeccion, IGUAL que los
 * repositorios del backend (AgentRepository, ProviderCredentialRepository). Es un alias type-only del
 * tipo de la libreria `postgres`: packages/shared no la importa en runtime (el repo solo usa el sql
 * inyectado), pero su tipo forma parte del contrato publico. Tanto el backend como el worker pasan su
 * instancia real; los tests pasan un mock.
 */
export type Sql = postgres.Sql;

/** Fila cruda de la tabla `jobs` (snake_case). */
interface JobRow {
  id: string;
  agent_id: string;
  owner_id: string;
  credential_id: string;
  status: string;
  payload: unknown;
  scheduled_for: Date | string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar `RangeError: Invalid time value`. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO de epoch: fallback no-lanzante para los timestamps not-null (created_at/updated_at). */
const EPOCH_ISO = new Date(0).toISOString();

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    agentId: row.agent_id,
    ownerId: row.owner_id,
    credentialId: row.credential_id,
    status: row.status as JobStatus,
    payload: row.payload,
    scheduledFor: toIso(row.scheduled_for),
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error,
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
    updatedAt: toIso(row.updated_at) ?? EPOCH_ISO,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  };
}

/**
 * Acceso a datos de la COLA DE TAREAS (tabla `jobs`, V008). Recibe el cliente sql por inyeccion
 * (testeable), mismo patron que AgentRepository. Aisla por owner_id donde corresponde; las
 * transiciones de estado (claim/mark*) operan por id porque el llamador ya posee el job que tomo.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej.
 * V008 sin aplicar), Postgres falla ruidosamente en vez de devolver un Job con campos undefined.
 */
export class JobsRepository {
  constructor(private readonly sql: Sql) {}

  /** Encola una tarea nueva en estado 'pending'. status/attempts/timestamps los pone la base. */
  async createJob(input: CreateJobInput): Promise<Job> {
    const rows = await this.sql<JobRow[]>`
      insert into jobs (agent_id, owner_id, credential_id, payload, scheduled_for)
      values (
        ${input.agentId},
        ${input.ownerId},
        ${input.credentialId},
        ${this.sql.json(input.payload as Parameters<Sql['json']>[0])},
        ${input.scheduledFor ?? null}
      )
      returning id, agent_id, owner_id, credential_id, status, payload, scheduled_for,
        attempts, last_error, created_at, updated_at, started_at, finished_at
    `;
    return rowToJob(rows[0] as JobRow);
  }

  /**
   * PEEK de solo lectura: el proximo job ELEGIBLE (pending y cuyo scheduled_for ya vencio o es ASAP),
   * sin tomarlo. No bloquea ni cambia estado: util para inspeccionar la cola (p.ej. el esqueleto del
   * worker). Para TOMAR un job de forma segura entre varios workers, usar claimNextJob.
   */
  async getNextPendingJob(): Promise<Job | null> {
    const rows = await this.sql<JobRow[]>`
      select id, agent_id, owner_id, credential_id, status, payload, scheduled_for,
        attempts, last_error, created_at, updated_at, started_at, finished_at
      from jobs
      where status = 'pending' and (scheduled_for is null or scheduled_for <= now())
      order by created_at asc
      limit 1
    `;
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }

  /** Cantidad de jobs ELEGIBLES (pending y con scheduled_for vencido o ASAP). Read-only. */
  async countPending(): Promise<number> {
    const rows = await this.sql<Array<{ count: number | string }>>`
      select count(*)::int as count
      from jobs
      where status = 'pending' and (scheduled_for is null or scheduled_for <= now())
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Toma de forma ATOMICA el proximo job elegible y lo pasa a 'running' (incrementando attempts y
   * marcando started_at). El SELECT ... FOR UPDATE SKIP LOCKED dentro del subquery garantiza que dos
   * workers concurrentes NUNCA tomen el mismo job: cada uno bloquea una fila distinta y saltea las ya
   * bloqueadas. Devuelve el job tomado, o null si la cola no tiene nada elegible. Es UN solo statement
   * (atomico por si mismo, sin transaccion explicita). El worker real que lo consume es PR 5.2.
   */
  async claimNextJob(): Promise<Job | null> {
    const rows = await this.sql<JobRow[]>`
      update jobs set
        status = 'running',
        started_at = now(),
        attempts = attempts + 1,
        updated_at = now()
      where id = (
        select id from jobs
        where status = 'pending' and (scheduled_for is null or scheduled_for <= now())
        order by created_at asc
        for update skip locked
        limit 1
      )
      returning id, agent_id, owner_id, credential_id, status, payload, scheduled_for,
        attempts, last_error, created_at, updated_at, started_at, finished_at
    `;
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }

  /** Marca un job como 'running' (sin tocar attempts; eso lo hace el claim). */
  async markRunning(id: string): Promise<void> {
    await this.sql`
      update jobs set status = 'running', started_at = now(), updated_at = now()
      where id = ${id}
    `;
  }

  /** Cierra un job OK: estado terminal 'completed' + finished_at. */
  async markCompleted(id: string): Promise<void> {
    await this.sql`
      update jobs set status = 'completed', finished_at = now(), updated_at = now()
      where id = ${id}
    `;
  }

  /** Cierra un job con error: estado terminal 'failed', guardando el detalle en last_error. */
  async markFailed(id: string, error: string): Promise<void> {
    await this.sql`
      update jobs set status = 'failed', last_error = ${error}, finished_at = now(), updated_at = now()
      where id = ${id}
    `;
  }

  /**
   * Devuelve un job a 'pending' para REINTENTAR un fallo TRANSITORIO (error de proveedor, timeout,
   * credencial momentaneamente irresoluble). NO es un estado terminal: el job vuelve a la cola y otro
   * tick/worker lo retomara con claimNextJob (que incrementa attempts de nuevo). Guarda el ultimo
   * error en last_error y, opcionalmente, un scheduled_for futuro (backoff) para que el claim no lo
   * retome hasta que venza; null = elegible de inmediato. started_at se limpia (la corrida anterior no
   * llego a un cierre terminal). NO toca attempts: el conteo lo lleva el claim, asi un fallo permanente
   * (p.ej. tier insuficiente) que va directo a markFailed nunca pasa por aca.
   */
  async markPendingRetry(id: string, error: string, scheduledFor?: Date | string | null): Promise<void> {
    await this.sql`
      update jobs set
        status = 'pending',
        last_error = ${error},
        scheduled_for = ${scheduledFor ?? null},
        started_at = null,
        updated_at = now()
      where id = ${id}
    `;
  }
}
