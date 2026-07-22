import type postgres from 'postgres';
import type {
  CreateJobInput,
  Job,
  JobConsulta,
  JobStatus,
  JobStatusCounts,
  JobSummary,
  ListJobsByOwnerOptions,
  ReapedJob,
} from './types.js';
import { RECIPE_JOB_KIND } from './recipe-payload.js';
import { SITIO_JOB_KINDS } from './sitio-payload.js';
import { TAREA_WEB_JOB_KIND } from './tarea-web-payload.js';

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
  agent_id: string | null;
  owner_id: string;
  credential_id: string | null;
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
 * Fila del LISTADO de observabilidad: las columnas seguras del job MAS `payload_kind`, que es solo el
 * valor escalar `payload->>'kind'` (no el payload entero). Asi la query nunca trae los mensajes del
 * usuario a memoria: para decidir 'recipe' vs 'simple' basta el discriminador, no el contenido.
 */
interface JobSummaryRow {
  id: string;
  agent_id: string | null;
  status: string;
  payload_kind: string | null;
  attempts: number;
  last_error: string | null;
  scheduled_for: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

function rowToSummary(row: JobSummaryRow): JobSummary {
  return {
    id: row.id,
    agentId: row.agent_id,
    status: row.status as JobStatus,
    // Mismo criterio que isRecipeJobPayload / isSitioJobPayload (payload.kind), pero evaluado sobre el
    // escalar que trajo la query. Cualquier otro valor (null incluido) es un job simple.
    type:
      row.payload_kind === RECIPE_JOB_KIND
        ? 'recipe'
        : row.payload_kind === TAREA_WEB_JOB_KIND
          ? 'tarea_web'
          : (SITIO_JOB_KINDS as readonly string[]).includes(row.payload_kind ?? '')
            ? 'sitio'
            : 'simple',
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error,
    scheduledFor: toIso(row.scheduled_for),
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
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
   * CONTEO por estado de cola de los jobs de UN owner, para el eje OPERACIONES del dashboard. UNA sola
   * query agregada (count(*) ... group by status), read-only y AISLADA por owner_id: jamas mezcla jobs de
   * otro dueno. A diferencia de countPending (GLOBAL, sin owner, sobre jobs elegibles), esta cuenta TODOS
   * los estados del owner: es la foto actual de SU cola, no de la cola compartida del worker.
   *
   * Devuelve SIEMPRE las cuatro claves (un estado sin filas -> 0): la query solo trae los estados con al
   * menos una fila, y aqui se rellenan los ausentes. Un status inesperado (esquema divergente) se ignora
   * en vez de contaminar el conteo. count(*)::int llega como number; el Number() es defensa extra.
   */
  async countByStatusForOwner(ownerId: string): Promise<JobStatusCounts> {
    const rows = await this.sql<Array<{ status: string; count: number | string }>>`
      select status, count(*)::int as count
      from jobs
      where owner_id = ${ownerId}
      group by status
    `;
    const counts: JobStatusCounts = { pending: 0, running: 0, completed: 0, failed: 0, pausado: 0 };
    for (const row of rows) {
      if (
        row.status === 'pending' ||
        row.status === 'running' ||
        row.status === 'completed' ||
        row.status === 'failed' ||
        row.status === 'pausado'
      ) {
        counts[row.status] = Number(row.count ?? 0);
      }
    }
    return counts;
  }

  /**
   * LISTADO de OBSERVABILIDAD: los jobs de UN owner, del mas nuevo al mas viejo (created_at desc),
   * paginado por limit/offset y opcionalmente filtrado por estado. Read-only y AISLADO por owner_id
   * (jamas devuelve jobs de otro dueno), igual que listRecipesByOwner. NO trae el `payload` (dato
   * sensible): solo columnas seguras + `payload->>'kind'` para inferir el tipo (recipe|simple).
   *
   * Dos ramas explicitas (con/sin status) en vez de un fragmento SQL condicional: cada rama es UN solo
   * template, mas legible y trivial de testear con un mock del tagged template. La ruta valida y acota
   * limit/offset antes de llamar aca (este metodo confia en valores ya saneados).
   */
  async listByOwner(ownerId: string, options: ListJobsByOwnerOptions): Promise<JobSummary[]> {
    const { limit, offset, status } = options;
    const rows =
      status === undefined
        ? await this.sql<JobSummaryRow[]>`
            select id, agent_id, status, payload->>'kind' as payload_kind, attempts, last_error,
              scheduled_for, created_at, started_at, finished_at
            from jobs
            where owner_id = ${ownerId}
            order by created_at desc
            limit ${limit} offset ${offset}
          `
        : await this.sql<JobSummaryRow[]>`
            select id, agent_id, status, payload->>'kind' as payload_kind, attempts, last_error,
              scheduled_for, created_at, started_at, finished_at
            from jobs
            where owner_id = ${ownerId} and status = ${status}
            order by created_at desc
            limit ${limit} offset ${offset}
          `;
    return rows.map(rowToSummary);
  }

  /**
   * RESUMEN de UN job del owner, para que la UI haga polling del estado de un job que ella misma
   * encolo (p.ej. conectar/confirmar/desconectar un sitio, 7.1c). Mismo DTO seguro que listByOwner
   * (sin payload; solo payload->>'kind' para inferir el tipo) y AISLADO por owner_id: un job ajeno o
   * inexistente devuelve null, jamas datos de otro dueno.
   */
  async getSummaryForOwner(id: string, ownerId: string): Promise<JobSummary | null> {
    const rows = await this.sql<JobSummaryRow[]>`
      select id, agent_id, status, payload->>'kind' as payload_kind, attempts, last_error,
        scheduled_for, created_at, started_at, finished_at
      from jobs
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToSummary(row) : null;
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

  /**
   * Cierra un job OK: estado terminal 'completed' + finished_at.
   *
   * COMPARE-AND-SET (`and status = 'running'`): el cierre SOLO aplica si el job sigue 'running'. Es una
   * guarda barata contra el REAPER (reapOrphanedJobs) y contra N workers con recovery: si otro actor ya
   * movio el job (p.ej. el reaper lo devolvio a 'pending' por creerlo huerfano), este cierre no PISA ese
   * estado -- afecta 0 filas y es un no-op, en vez de resucitar un job ya re-transicionado (cierra H8 del
   * informe 06). Con un solo worker mono-proceso el job siempre sigue 'running' aqui, asi que no cambia el
   * camino feliz; es defensa para cuando exista un reaper o mas de un worker.
   */
  async markCompleted(id: string): Promise<void> {
    await this.sql`
      update jobs set status = 'completed', finished_at = now(), updated_at = now()
      where id = ${id} and status = 'running'
    `;
  }

  /** Cierra un job con error: estado terminal 'failed', guardando el detalle en last_error. Con guarda
   *  de estado (`and status = 'running'`), igual que markCompleted (ver su nota; cierra H8). */
  async markFailed(id: string, error: string): Promise<void> {
    await this.sql`
      update jobs set status = 'failed', last_error = ${error}, finished_at = now(), updated_at = now()
      where id = ${id} and status = 'running'
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
      where id = ${id} and status = 'running'
    `;
  }

  /**
   * Guarda el RESULTADO de un job (7.1d, columna jobs.resultado de V026) ANTES de marcarlo completado.
   * Es el canal de vuelta hacia la tool de consulta del agente (obtenerJobDeOwner): la cola pasa de
   * "solo estado" a "estado + resultado" SIN tocar las transiciones (markCompleted sigue siendo el
   * cierre). Solo escribe sobre un job 'running' (el que este worker posee): un job ya cerrado o
   * re-transicionado por el reaper no se pisa.
   */
  async guardarResultado(id: string, resultado: unknown): Promise<void> {
    await this.sql`
      update jobs set resultado = ${this.sql.json(resultado as Parameters<Sql['json']>[0])}, updated_at = now()
      where id = ${id} and status = 'running'
    `;
  }

  /**
   * CONSULTA de un job para la tool del agente (7.1d): estado + resultado + ultimo error, SIEMPRE
   * acotada por owner_id (un job ajeno -> null, jamas su resultado). No trae el payload: la tool no
   * lo necesita y es dato sensible.
   */
  async obtenerJobDeOwner(id: string, ownerId: string): Promise<JobConsulta | null> {
    const rows = await this.sql<Array<{ id: string; status: string; resultado: unknown; last_error: string | null }>>`
      select id, status, resultado, last_error
      from jobs
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status as JobStatus,
      resultado: row.resultado ?? null,
      lastError: row.last_error,
    };
  }

  /**
   * PAUSA un job de tarea web en un CHECKPOINT DE APROBACION humana (7.1e): 'running' -> 'pausado'.
   * Compare-and-set sobre 'running' (igual que markCompleted): solo el worker que posee el job puede
   * pausarlo, y un job ya re-transicionado por el reaper no se pisa. Un job 'pausado' es INVISIBLE
   * para el claim (que solo mira 'pending') y para el reaper (que solo mira 'running'): queda quieto
   * hasta que la decision humana lo devuelva a 'pending' (reanudarDePausado) o el barrido de
   * aprobaciones vencidas lo cierre (marcarPausadoFallido).
   */
  async marcarPausado(id: string): Promise<void> {
    await this.sql`
      update jobs set status = 'pausado', updated_at = now()
      where id = ${id} and status = 'running'
    `;
  }

  /**
   * Devuelve un job 'pausado' a 'pending' tras la DECISION humana sobre su aprobacion (7.1e): el
   * worker lo re-reclama y reanuda la tarea segun la decision. Compare-and-set sobre 'pausado' y
   * ACOTADO por owner_id (lo invoca el endpoint de decision del backend con el sub del token): un job
   * ajeno o en otro estado no se toca. started_at se limpia (la corrida anterior quedo suspendida).
   * Devuelve true si la transicion aplico.
   */
  async reanudarDePausado(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      update jobs set status = 'pending', scheduled_for = null, started_at = null, updated_at = now()
      where id = ${id} and owner_id = ${ownerId} and status = 'pausado'
      returning id
    `;
    return rows.length > 0;
  }

  /**
   * Cierra un job 'pausado' como 'failed' (aprobacion EXPIRADA sin decision, o limpieza del barrido).
   * Compare-and-set sobre 'pausado': una decision humana que llego en el mismo instante (y ya lo
   * devolvio a 'pending') gana; este cierre afecta 0 filas y es un no-op.
   */
  async marcarPausadoFallido(id: string, error: string): Promise<void> {
    await this.sql`
      update jobs set status = 'failed', last_error = ${error}, finished_at = now(), updated_at = now()
      where id = ${id} and status = 'pausado'
    `;
  }

  /**
   * REAPER de jobs HUERFANOS: recupera los jobs 'running' que quedaron ATASCADOS porque el worker murio
   * entre el claim y el cierre (crash / OOM / kill -9, o el watchdog forzando exit(0) con el drain
   * colgado). Cierra H3 y H4 del informe 06: sin esto, un 'running' nunca sale de ese estado (el claim
   * solo mira 'pending' y la retencion solo borra terminales), quedando invisible para siempre.
   *
   * QUE toca (y que JAMAS toca): SOLO jobs 'running' cuyo `started_at` sea mas viejo que un MARGEN AMPLIO,
   * calibrado por TIPO de job para SUPERAR SIEMPRE el maximo wall-clock legitimo:
   *   - job SIMPLE: una sola corrida acotada a runTimeoutMs -> margen `simpleThresholdMs` (varias veces
   *     runTimeoutMs).
   *   - job de RECETA (payload.kind = 'recipe'): hasta MAX_RECIPE_STEPS pasos, cada uno con su propio
   *     deadline runTimeoutMs -> margen `recipeThresholdMs` (> MAX_RECIPE_STEPS * runTimeoutMs).
   * El discriminador se lee del propio payload (`payload->>'kind'`, el mismo criterio que listByOwner),
   * sin traer el payload a memoria. Un job dentro de su margen (posiblemente vivo) NUNCA se toca: un
   * margen mal calibrado mataria jobs vivos, por eso es holgado.
   *
   * COMO cierra el job recuperado (respeta attempts/MAX_ATTEMPTS, que el claim ya incremento):
   *   - attempts < maxAttempts -> vuelve a 'pending' (scheduled_for=null: elegible ya) para re-ejecutarse.
   *   - attempts >= maxAttempts -> 'failed' con finished_at, sin re-ejecutar (ya agoto su presupuesto).
   * En ambos casos deja constancia en last_error de que fue una RECUPERACION de estado huerfano.
   *
   * ATOMICIDAD / CONCURRENCIA: es UN solo UPDATE ... WHERE status='running'. Postgres toma el lock de
   * fila; dos reapers concurrentes (o un reaper y otro worker) no la recuperan dos veces: el segundo ve
   * la fila con status ya cambiado y su WHERE la excluye. No re-ejecuta el motor ni toca el claim.
   * Devuelve las filas recuperadas (id + estado destino + attempts) para que el worker lo registre.
   */
  async reapOrphanedJobs(params: {
    simpleThresholdMs: number;
    recipeThresholdMs: number;
    maxAttempts: number;
  }): Promise<ReapedJob[]> {
    const { simpleThresholdMs, recipeThresholdMs, maxAttempts } = params;
    const pendingMessage =
      'recuperado de estado huerfano: el worker murio entre el claim y el cierre; devuelto a pending para reintento';
    const failedMessage =
      'recuperado de estado huerfano: el worker murio entre el claim y el cierre; intentos agotados, marcado failed';
    const rows = await this.sql<Array<{ id: string; status: string; attempts: number }>>`
      update jobs set
        status = case when attempts >= ${maxAttempts} then 'failed' else 'pending' end,
        last_error = case when attempts >= ${maxAttempts} then ${failedMessage} else ${pendingMessage} end,
        started_at = null,
        finished_at = case when attempts >= ${maxAttempts} then now() else null end,
        scheduled_for = null,
        updated_at = now()
      where status = 'running'
        and started_at is not null
        and started_at < now() - case
          when payload->>'kind' = ${RECIPE_JOB_KIND}
            then make_interval(secs => ${recipeThresholdMs / 1000})
          else make_interval(secs => ${simpleThresholdMs / 1000})
        end
      returning id, status, attempts
    `;
    return rows.map((row) => ({
      id: row.id,
      status: row.status as JobStatus,
      attempts: Number(row.attempts ?? 0),
    }));
  }
}
