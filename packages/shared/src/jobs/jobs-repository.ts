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
import { GRABACION_JOB_KINDS, GRABAR_TAREA_JOB_KIND } from './grabacion-payload.js';
import { PROMOVER_TRAYECTORIA_JOB_KIND } from './promover-trayectoria-payload.js';

/**
 * Cliente postgres (tagged template) que el repositorio recibe por inyeccion, IGUAL que los
 * repositorios del backend (AgentRepository, ProviderCredentialRepository). Es un alias type-only del
 * tipo de la libreria `postgres`: packages/shared no la importa en runtime (el repo solo usa el sql
 * inyectado), pero su tipo forma parte del contrato publico. Tanto el backend como el worker pasan su
 * instancia real; los tests pasan un mock.
 */
export type Sql = postgres.Sql;

/**
 * Intervalo del LATIDO de un job en ejecucion (ms): mientras un job esta 'running', el worker que lo
 * posee refresca updated_at cada este intervalo. Es la senal de vida que consume el reaper: un
 * 'running' sin latido por mas de REAP_SIN_LATIDO_MULTIPLO intervalos esta detenido con certeza.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Cuantos intervalos de latido perdidos declaran DETENIDO a un job 'running' (3 x 30s = 90s). Mas de
 * uno para tolerar una escritura de latido fallida (best-effort) sin matar un job vivo.
 */
export const REAP_SIN_LATIDO_MULTIPLO = 3;

/**
 * Prefijo ESTABLE de last_error de un job terminado por su dueno desde la consola (no hay estado
 * nuevo ni migracion: cancelar usa el 'failed' existente). La consola detecta este prefijo y muestra
 * la etiqueta "Cancelada" en vez de "Fallida".
 */
export const CANCELADO_POR_USUARIO_PREFIX = 'CANCELADO_POR_USUARIO: ';

/** Prefijo ESTABLE de last_error de un job detenido por el reaper de latido (etiqueta "Detenida"). */
export const SISTEMA_DETUVO_TAREA_PREFIX = 'SISTEMA_DETUVO_TAREA: ';

/** last_error exacto que escribe el reaper al recoger un job de sitio o tarea_web detenido. */
export const SISTEMA_DETUVO_TAREA_ERROR =
  `${SISTEMA_DETUVO_TAREA_PREFIX}la tarea dejo de responder y el sistema la termino automaticamente`;

/** last_error exacto que escribe la cancelacion desde la consola. */
export const CANCELADO_POR_USUARIO_ERROR = `${CANCELADO_POR_USUARIO_PREFIX}terminada por el usuario`;

/** Desenlace de cancelarPorUsuario: cancelado (con el estado que tenia), conflicto o inexistente. */
export type ResultadoCancelacion =
  | { resultado: 'cancelado'; estadoPrevio: JobStatus }
  | { resultado: 'conflicto' }
  | { resultado: 'no_encontrado' };

/** Desenlace de borrarTerminalDeOwner: borrado, en un estado no terminal, o inexistente/ajeno. */
export type ResultadoBorradoJob = 'borrado' | 'no_terminal' | 'no_encontrado';

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
  /** `resultado->>'via'`: por donde corrio una tarea web ('receta' | 'modelo'). Ver rowToSummary. */
  resultado_via: string | null;
  /** `resultado->>'reparada'`: la ejecucion por receta tuvo que ajustar algun paso. */
  resultado_reparada: string | null;
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
    // Dos ESCALARES del resultado, nunca el resultado entero (mismo criterio que payload_kind): el
    // listado no debe traer a memoria ni exponer lo que el worker guardo de la tarea.
    conLoAprendido: row.resultado_via === 'receta',
    ajustadaSola: row.resultado_via === 'receta' && row.resultado_reparada === 'true',
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
   * IDEMPOTENCIA del guardado de una tarea aprendida: el job de PROMOCION en vuelo (pending o
   * running) del owner para el MISMO job de origen, si existe. El endpoint lo devuelve en lugar de
   * encolar otro: un doble click (dos POST antes de que el primero termine) produce UN solo job de
   * conversion en vez de dos tarjetas fallidas. Acotado por owner_id, como toda lectura.
   */
  async buscarPromocionEnVuelo(ownerId: string, jobOrigenId: string): Promise<string | null> {
    const rows = await this.sql<Array<{ id: string }>>`
      select id
      from jobs
      where owner_id = ${ownerId}
        and status in ('pending', 'running')
        and payload->>'kind' = ${PROMOVER_TRAYECTORIA_JOB_KIND}
        and payload->>'jobId' = ${jobOrigenId}
      order by created_at asc
      limit 1
    `;
    return rows[0]?.id ?? null;
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
   *
   * El job INTERNO de guardado (kind 'promover_trayectoria') queda FUERA del listado a proposito:
   * guardar una tarea aprendida no es una actividad del agente, y su tarjeta salia como "Agente
   * eliminado" con estado fallida cada vez que la conversion se rechazaba. Su estado se sigue
   * consultando por el detalle (getSummaryForOwner), que es lo que la consola sondea al guardar.
   */
  async listByOwner(ownerId: string, options: ListJobsByOwnerOptions): Promise<JobSummary[]> {
    const { limit, offset, status } = options;
    const rows =
      status === undefined
        ? await this.sql<JobSummaryRow[]>`
            select id, agent_id, status, payload->>'kind' as payload_kind, attempts, last_error,
              scheduled_for, created_at, started_at, finished_at,
              resultado->>'via' as resultado_via, resultado->>'reparada' as resultado_reparada
            from jobs
            where owner_id = ${ownerId}
              and (payload->>'kind' is distinct from ${PROMOVER_TRAYECTORIA_JOB_KIND})
            order by created_at desc
            limit ${limit} offset ${offset}
          `
        : await this.sql<JobSummaryRow[]>`
            select id, agent_id, status, payload->>'kind' as payload_kind, attempts, last_error,
              scheduled_for, created_at, started_at, finished_at,
              resultado->>'via' as resultado_via, resultado->>'reparada' as resultado_reparada
            from jobs
            where owner_id = ${ownerId} and status = ${status}
              and (payload->>'kind' is distinct from ${PROMOVER_TRAYECTORIA_JOB_KIND})
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
        scheduled_for, created_at, started_at, finished_at,
        resultado->>'via' as resultado_via, resultado->>'reparada' as resultado_reparada
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
   * SESION DE NAVEGADOR VIVA de una grabacion EN CURSO, para acunar el token del relay de teclado
   * movil sobre ella. La tabla `grabaciones` (V036) no guarda la sesion del proveedor; el worker la
   * publica como resultado INTERMEDIO del job kind:'grabar_tarea' (jobs.resultado, V026) al abrir la
   * vista en vivo, y este metodo la lee SIEMPRE acotada por owner_id y SOLO mientras el job sigue
   * 'running' (la captura instalada): un job cerrado o ajeno devuelve null y no se acuna nada.
   */
  async obtenerSesionDeGrabacion(grabacionId: string, ownerId: string): Promise<string | null> {
    const rows = await this.sql<Array<{ resultado: unknown }>>`
      select resultado
      from jobs
      where owner_id = ${ownerId}
        and status = 'running'
        and payload->>'kind' = ${GRABAR_TAREA_JOB_KIND}
        and payload->>'grabacionId' = ${grabacionId}
      order by created_at desc
      limit 1
    `;
    const resultado = rows[0]?.resultado;
    if (typeof resultado !== 'object' || resultado === null) return null;
    const sesion = (resultado as { sesionExternaId?: unknown }).sesionExternaId;
    return typeof sesion === 'string' && sesion.length > 0 ? sesion : null;
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
   * BARRERA ANTI RELANZAMIENTO (BUG A): ¿existe un job de TAREA WEB del owner sobre ESTA conexion
   * que haya terminado en FALLO PERMANENTE hace poco? La usa el ejecutor de las tools de sitios del
   * backend para RECHAZAR platform_ejecutar_tarea_en_sitio: tras un fallo permanente, el modelo del
   * agente NO puede reencolar la misma tarea por su cuenta (en produccion genero un segundo borrador
   * duplicado en Gmail); se requiere una decision del usuario. La barrera es SERVER-SIDE a proposito
   * (D5): instruir al modelo por prompt no cuenta como solucion.
   *
   * NO cuentan como fallo permanente para la barrera:
   *  - jobs 'pausado' (esperando aprobacion) ni 'completed': el WHERE exige status='failed';
   *  - jobs CANCELADOS por el usuario (cancelarPorUsuario) o DETENIDOS por el reaper de latido: ahi
   *    el usuario ya tomo una decision explicita (o ya sabe que la tarea murio) y reintentar es
   *    legitimo. La deteccion usa los MISMOS prefijos que escriben esos dos caminos
   *    (CANCELADO_POR_USUARIO_PREFIX / SISTEMA_DETUVO_TAREA_PREFIX), no literales propios.
   * SI cuenta, y a proposito, una tarea DETENIDA POR LA VERIFICACION (DETENIDA_VERIFICACION en el
   * last_error): ahi el usuario todavia NO decidio nada -- decidio el sistema al no dejar ejecutar
   * -- y relanzarla tiene que ser una decision del usuario, no del modelo.
   *
   * LA CONEXION SE BUSCA EN TODOS LOS SITIOS DE LA TAREA FALLIDA, no solo en el de arranque: una
   * tarea multisitio guarda el arranque en payload.connectionId y la lista completa en
   * payload.sitios. Antes solo se comparaba connectionId, asi que una tarea que fallo (o fue
   * detenida por la verificacion) mientras operaba en su SEGUNDO sitio no activaba la barrera para
   * un relanzamiento dirigido a ese sitio: es el agujero por el que el modelo relanzo tras un
   * bloqueo en produccion.
   *
   * `starts_with` y no LIKE a proposito: los prefijos contienen guiones bajos, que en un patron LIKE
   * son comodines de un caracter y volverian la EXENCION mas permisiva de lo escrito (y una exencion
   * de mas es justo lo que dejaria pasar un relanzamiento). starts_with compara texto literal.
   * La ventana la define el llamador (VENTANA_ANTI_RELANZAMIENTO_MS en sitio-tools.ts).
   */
  async existeFalloPermanenteReciente(
    ownerId: string,
    connectionId: string,
    ventanaMs: number,
  ): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      select id
      from jobs
      where owner_id = ${ownerId}
        and status = 'failed'
        and payload->>'kind' = ${TAREA_WEB_JOB_KIND}
        and (
          payload->>'connectionId' = ${connectionId}
          or jsonb_exists(payload->'sitios', ${connectionId})
        )
        and finished_at is not null
        and finished_at > now() - make_interval(secs => ${ventanaMs / 1000})
        and (
          last_error is null
          or (
            not starts_with(last_error, ${CANCELADO_POR_USUARIO_PREFIX})
            and not starts_with(last_error, ${SISTEMA_DETUVO_TAREA_PREFIX})
          )
        )
      limit 1
    `;
    return rows.length > 0;
  }

  /**
   * LATIDO de un job en ejecucion: refresca updated_at SOLO si el job sigue 'running' (un 'pausado'
   * esperando aprobacion NO late a proposito) y devuelve el status ACTUAL del job. Es la doble senal
   * del worker: (a) mantiene el job fuera del reaper de latido mientras corre, y (b) relee el estado
   * en cada latido, asi una cancelacion desde la consola ('failed' por cancelarPorUsuario) se detecta
   * en el siguiente intervalo y el ejecutor aborta sin escribir encima del estado nuevo.
   */
  async latirJob(id: string): Promise<JobStatus | null> {
    const updated = await this.sql<Array<{ id: string }>>`
      update jobs set updated_at = now()
      where id = ${id} and status = 'running'
      returning id
    `;
    if (updated.length > 0) return 'running';
    const rows = await this.sql<Array<{ status: string }>>`
      select status from jobs where id = ${id}
    `;
    const row = rows[0];
    return row ? (row.status as JobStatus) : null;
  }

  /**
   * CANCELACION por el DUENO desde la consola: cierra un job propio en 'pending' | 'running' |
   * 'pausado' como 'failed' con el last_error prefijado CANCELADO_POR_USUARIO (sin estado nuevo ni
   * migracion; la consola muestra "Cancelada" por el prefijo). ATOMICO: el CTE lockea la fila solo si
   * sigue cancelable y el UPDATE aplica sobre ese lock, asi un doble click o una carrera con el
   * cierre del worker afectan 0 filas -> 'conflicto' (los cierres del worker tienen su propio CAS
   * sobre 'running' y tampoco pisan este 'failed'). Acotado por owner_id (el sub del token, jamas el
   * cliente): un job ajeno responde 'no_encontrado', nunca se toca ni se revela.
   * Devuelve el estado previo para que la ruta cierre la aprobacion asociada si estaba 'pausado'.
   */
  async cancelarPorUsuario(id: string, ownerId: string): Promise<ResultadoCancelacion> {
    const rows = await this.sql<Array<{ estado_previo: string }>>`
      with previo as (
        select id, status from jobs
        where id = ${id} and owner_id = ${ownerId}
          and status in ('pending', 'running', 'pausado')
        for update
      )
      update jobs set
        status = 'failed',
        last_error = ${CANCELADO_POR_USUARIO_ERROR},
        finished_at = now(),
        updated_at = now()
      from previo
      where jobs.id = previo.id
      returning previo.status as estado_previo
    `;
    const row = rows[0];
    if (row) return { resultado: 'cancelado', estadoPrevio: row.estado_previo as JobStatus };
    const existe = await this.sql<Array<{ id: string }>>`
      select id from jobs where id = ${id} and owner_id = ${ownerId}
    `;
    return existe.length > 0 ? { resultado: 'conflicto' } : { resultado: 'no_encontrado' };
  }

  /**
   * BORRADO de una actividad por su DUENO desde la consola: elimina un job PROPIO que ya esta en
   * estado TERMINAL ('completed' o 'failed'; una cancelada o detenida es un 'failed' con prefijo).
   * Un job en vuelo (pending/running/pausado) NO se borra: para eso existe Terminar tarea, y borrar
   * un registro que todavia se mueve dejaria al worker escribiendo sobre una fila inexistente.
   *
   * ATOMICO: el DELETE exige owner, id y estado terminal en el mismo WHERE, asi una carrera con una
   * transicion de estado afecta 0 filas y se distingue despues (no_terminal vs no_encontrado). Un
   * job ajeno responde 'no_encontrado', identico a uno inexistente (jamas se toca ni se revela).
   * El segundo DELETE del mismo id tambien responde 'no_encontrado': idempotencia por 404.
   */
  async borrarTerminalDeOwner(id: string, ownerId: string): Promise<ResultadoBorradoJob> {
    const borrados = await this.sql<Array<{ id: string }>>`
      delete from jobs
      where id = ${id} and owner_id = ${ownerId} and status in ('completed', 'failed')
      returning id
    `;
    if (borrados.length > 0) return 'borrado';
    const existe = await this.sql<Array<{ id: string }>>`
      select id from jobs where id = ${id} and owner_id = ${ownerId}
    `;
    return existe.length > 0 ? 'no_terminal' : 'no_encontrado';
  }

  /**
   * REAPER POR LATIDO: recoge los jobs 'running' cuyo updated_at es mas viejo que `staleMs`
   * (3 x HEARTBEAT_INTERVAL_MS). Con el latido del worker (latirJob cada 30s), un 'running' sin
   * latido por 90s esta DETENIDO con certeza (worker muerto o colgado sin event loop), sea cual sea
   * su tipo: este umbral REEMPLAZA a los margenes por started_at (que esperaban multiplos del
   * deadline de cada tipo). Un job 'pausado' (checkpoint de aprobacion, que puede esperar minutos
   * sin latir) queda FUERA: el WHERE solo mira 'running'.
   *
   * RECLAMO en dos pasos, seguro con N workers (D2): (1) SELECT de candidatos leyendo status y
   * updated_at (::text para conservar los microsegundos que Date perderia), (2) UPDATE atomico POR
   * FILA cuyo WHERE verifica que status y updated_at NO cambiaron desde la lectura. Si el job late o
   * lo cierra otro actor entre medio, el CAS afecta 0 filas y no se toca.
   *
   * DESTINO por tipo:
   *   - sitio / tarea_web: SIEMPRE 'failed' con SISTEMA_DETUVO_TAREA_ERROR. JAMAS a 'pending':
   *     reencolar re-ejecutaria acciones sobre la cuenta real del usuario (D3).
   *   - resto (simple / receta): comportamiento de siempre -> 'pending' si attempts < maxAttempts
   *     (elegible ya), 'failed' definitivo si los agoto.
   */
  async reapOrphanedJobs(params: { staleMs: number; maxAttempts: number }): Promise<ReapedJob[]> {
    const { staleMs, maxAttempts } = params;
    const pendingMessage =
      'recuperado de estado detenido: el job dejo de latir; devuelto a pending para reintento';
    const failedMessage =
      'recuperado de estado detenido: el job dejo de latir; intentos agotados, marcado failed';
    const candidatos = await this.sql<
      Array<{ id: string; updated_at_txt: string; payload_kind: string | null; attempts: number }>
    >`
      select id, updated_at::text as updated_at_txt, payload->>'kind' as payload_kind, attempts
      from jobs
      where status = 'running'
        and updated_at < now() - make_interval(secs => ${staleMs / 1000})
    `;
    const reaped: ReapedJob[] = [];
    for (const candidato of candidatos) {
      const attempts = Number(candidato.attempts ?? 0);
      const kind = candidato.payload_kind ?? '';
      // Un job de GRABACION tampoco se reencola: re-ejecutar 'grabar_tarea' abriria una segunda sesion
      // de navegador sobre una grabacion que el usuario ya dio por terminada, y re-ejecutar
      // 'promover_grabacion' crearia una segunda version de la misma receta.
      const nuncaReencolar =
        kind === TAREA_WEB_JOB_KIND ||
        (SITIO_JOB_KINDS as readonly string[]).includes(kind) ||
        (GRABACION_JOB_KINDS as readonly string[]).includes(kind);
      const aFailed = nuncaReencolar || attempts >= maxAttempts;
      const lastError = nuncaReencolar
        ? SISTEMA_DETUVO_TAREA_ERROR
        : aFailed
          ? failedMessage
          : pendingMessage;
      const rows = aFailed
        ? await this.sql<Array<{ id: string; status: string; attempts: number }>>`
            update jobs set
              status = 'failed',
              last_error = ${lastError},
              finished_at = now(),
              updated_at = now()
            where id = ${candidato.id} and status = 'running'
              and updated_at = ${candidato.updated_at_txt}::timestamptz
            returning id, status, attempts
          `
        : await this.sql<Array<{ id: string; status: string; attempts: number }>>`
            update jobs set
              status = 'pending',
              last_error = ${lastError},
              started_at = null,
              scheduled_for = null,
              updated_at = now()
            where id = ${candidato.id} and status = 'running'
              and updated_at = ${candidato.updated_at_txt}::timestamptz
            returning id, status, attempts
          `;
      const row = rows[0];
      if (row) {
        reaped.push({ id: row.id, status: row.status as JobStatus, attempts: Number(row.attempts ?? 0) });
      }
    }
    return reaped;
  }
}
