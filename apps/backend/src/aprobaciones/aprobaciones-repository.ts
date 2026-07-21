import type { Sql } from '@ledesma-platform/shared';

/**
 * Acceso a datos de los CHECKPOINTS DE APROBACION HUMANA (tabla `aprobaciones_web`, V027, Fase 7.1e)
 * y de su registro de intervenciones (tabla `intervenciones_art22`, GDPR Art.22). Recibe el cliente
 * sql por inyeccion (testeable), mismo patron que JobsRepository / SitiosConectadosRepository.
 *
 * Invariantes que este repositorio garantiza a nivel de query (no de convencion):
 *  - Toda lectura de un owner va acotada por WHERE owner_id (RLS es la segunda capa).
 *  - Las transiciones de estado son COMPARE-AND-SET sobre 'pendiente': una aprobacion solo se decide
 *    UNA vez y solo mientras no expiro. Un doble click, una carrera decision-vs-barrido o un replay
 *    del endpoint afectan 0 filas y devuelven null (el llamador responde 409/no-op).
 *  - La decision JAMAS se escribe sin registrar la intervencion Art.22 correspondiente (lo encadena
 *    la capa que llama: endpoint de decision / barrido de expiradas del worker).
 */

export type AprobacionEstado = 'pendiente' | 'aprobada' | 'rechazada' | 'expirada';
export type AccionTipo = 'irreversible' | 'financiera';

export interface AprobacionWeb {
  id: string;
  ownerId: string;
  jobId: string;
  connectionId: string;
  sesionExternaId: string;
  accionTipo: AccionTipo;
  descripcion: string;
  screenshotPath: string | null;
  estado: AprobacionEstado;
  instruccionRechazo: string | null;
  decididaPor: string | null;
  decididaEn: string | null;
  creadaEn: string;
  expiraEn: string;
}

interface AprobacionRow {
  id: string;
  owner_id: string;
  job_id: string;
  connection_id: string;
  sesion_externa_id: string;
  accion_tipo: string;
  descripcion: string;
  screenshot_path: string | null;
  estado: string;
  instruccion_rechazo: string | null;
  decidida_por: string | null;
  decidida_en: Date | string | null;
  creada_en: Date | string;
  expira_en: Date | string;
}

/** ISO 8601 tolerante (mismo criterio que JobsRepository). */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EPOCH_ISO = new Date(0).toISOString();

function rowToAprobacion(row: AprobacionRow): AprobacionWeb {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    connectionId: row.connection_id,
    sesionExternaId: row.sesion_externa_id,
    accionTipo: row.accion_tipo as AccionTipo,
    descripcion: row.descripcion,
    screenshotPath: row.screenshot_path,
    estado: row.estado as AprobacionEstado,
    instruccionRechazo: row.instruccion_rechazo,
    decididaPor: row.decidida_por,
    decididaEn: toIso(row.decidida_en),
    creadaEn: toIso(row.creada_en) ?? EPOCH_ISO,
    expiraEn: toIso(row.expira_en) ?? EPOCH_ISO,
  };
}

export class AprobacionesWebRepository {
  constructor(private readonly sql: Sql) {}

  /** Crea el checkpoint en estado 'pendiente' (lo invoca el worker al pausar la tarea). */
  async crear(input: {
    ownerId: string;
    jobId: string;
    connectionId: string;
    sesionExternaId: string;
    accionTipo: AccionTipo;
    descripcion: string;
    screenshotPath?: string | null;
    expiraEn: Date | string;
  }): Promise<AprobacionWeb> {
    const rows = await this.sql<AprobacionRow[]>`
      insert into aprobaciones_web
        (owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
         screenshot_path, expira_en)
      values
        (${input.ownerId}, ${input.jobId}, ${input.connectionId}, ${input.sesionExternaId},
         ${input.accionTipo}, ${input.descripcion}, ${input.screenshotPath ?? null}, ${input.expiraEn})
      returning id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en
    `;
    return rowToAprobacion(rows[0] as AprobacionRow);
  }

  /** Lista las aprobaciones del owner (mas nuevas primero), opcionalmente filtradas por estado. */
  async listarPorOwner(ownerId: string, estado?: AprobacionEstado): Promise<AprobacionWeb[]> {
    const rows =
      estado === undefined
        ? await this.sql<AprobacionRow[]>`
            select id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en from aprobaciones_web
            where owner_id = ${ownerId}
            order by creada_en desc
            limit 100
          `
        : await this.sql<AprobacionRow[]>`
            select id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en from aprobaciones_web
            where owner_id = ${ownerId} and estado = ${estado}
            order by creada_en desc
            limit 100
          `;
    return rows.map(rowToAprobacion);
  }

  /** Una aprobacion del owner por id. Ajena o inexistente -> null (jamas datos de otro dueno). */
  async obtenerPorId(id: string, ownerId: string): Promise<AprobacionWeb | null> {
    const rows = await this.sql<AprobacionRow[]>`
      select id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en from aprobaciones_web
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToAprobacion(row) : null;
  }

  /**
   * La aprobacion MAS RECIENTE de un job (la vigente: un job puede acumular varias si la tarea
   * reanudada topa con OTRA accion irreversible). La usa el worker al re-reclamar el job pausado,
   * acotada por owner (el owner del job, que el worker ya posee).
   */
  async obtenerVigentePorJob(jobId: string, ownerId: string): Promise<AprobacionWeb | null> {
    const rows = await this.sql<AprobacionRow[]>`
      select id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en from aprobaciones_web
      where job_id = ${jobId} and owner_id = ${ownerId}
      order by creada_en desc
      limit 1
    `;
    const row = rows[0];
    return row ? rowToAprobacion(row) : null;
  }

  /**
   * Persiste el path del screenshot subido a Storage (el worker lo sube DESPUES de crear la fila,
   * porque el path incluye el id de la aprobacion). Solo sobre 'pendiente': una aprobacion ya
   * decidida/expirada conserva la evidencia con la que se decidio.
   */
  async guardarScreenshotPath(id: string, path: string): Promise<void> {
    await this.sql`
      update aprobaciones_web set screenshot_path = ${path}
      where id = ${id} and estado = 'pendiente'
    `;
  }

  /**
   * DECIDE una aprobacion: 'pendiente' -> 'aprobada' | 'rechazada'. COMPARE-AND-SET: solo aplica si
   * sigue 'pendiente' Y no expiro (expira_en > now()); si otra decision, el barrido de expiradas o el
   * reloj llegaron primero, afecta 0 filas y devuelve null (el endpoint responde 409). Acotada por
   * owner_id: el sub del token, jamas el cliente.
   */
  async decidir(
    id: string,
    ownerId: string,
    input: { estado: 'aprobada' | 'rechazada'; decididaPor: string; instruccion?: string | null },
  ): Promise<AprobacionWeb | null> {
    const rows = await this.sql<AprobacionRow[]>`
      update aprobaciones_web set
        estado = ${input.estado},
        instruccion_rechazo = ${input.instruccion ?? null},
        decidida_por = ${input.decididaPor},
        decidida_en = now()
      where id = ${id} and owner_id = ${ownerId} and estado = 'pendiente' and expira_en > now()
      returning id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en
    `;
    const row = rows[0];
    return row ? rowToAprobacion(row) : null;
  }

  /** Las aprobaciones 'pendiente' cuyo expira_en ya vencio (para el barrido del worker). */
  async listarPendientesVencidas(ahora: Date): Promise<AprobacionWeb[]> {
    const rows = await this.sql<AprobacionRow[]>`
      select id, owner_id, job_id, connection_id, sesion_externa_id, accion_tipo, descripcion,
        screenshot_path, estado, instruccion_rechazo, decidida_por, decidida_en, creada_en, expira_en from aprobaciones_web
      where estado = 'pendiente' and expira_en <= ${ahora}
      order by expira_en asc
      limit 50
    `;
    return rows.map(rowToAprobacion);
  }

  /**
   * EXPIRA una aprobacion vencida: 'pendiente' -> 'expirada'. COMPARE-AND-SET sobre 'pendiente': si
   * una decision humana gano la carrera, afecta 0 filas y devuelve false (el barrido no toca nada).
   */
  async expirar(id: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      update aprobaciones_web set estado = 'expirada'
      where id = ${id} and estado = 'pendiente'
      returning id
    `;
    return rows.length > 0;
  }

  /**
   * Registra la INTERVENCION HUMANA (o su ausencia, en 'expirada') en intervenciones_art22 (V027):
   * quien decidio, cuando (creada_en lo pone la base) y QUE VIO (descripcion + screenshot). Es el
   * encadenado Art.22 del andamiaje de privacidad: toda decision de un checkpoint escribe una fila.
   */
  async registrarIntervencion(input: {
    ownerId: string;
    aprobacionId: string;
    decision: 'aprobada' | 'rechazada' | 'expirada';
    decididaPor?: string | null;
    descripcion: string;
    screenshotPath?: string | null;
    instruccion?: string | null;
  }): Promise<void> {
    await this.sql`
      insert into intervenciones_art22
        (owner_id, aprobacion_id, decision, decidida_por, descripcion, screenshot_path, instruccion)
      values
        (${input.ownerId}, ${input.aprobacionId}, ${input.decision}, ${input.decididaPor ?? null},
         ${input.descripcion}, ${input.screenshotPath ?? null}, ${input.instruccion ?? null})
    `;
  }
}
