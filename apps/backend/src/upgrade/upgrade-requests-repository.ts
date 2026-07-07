import type { Sql } from '../db/client.js';

/**
 * Acceso a datos de las SOLICITUDES DE UPGRADE (tabla `upgrade_requests`, V023). Una solicitud captura la
 * DEMANDA de un usuario 'free' por una feature premium: quien la pide (owner_id = sub del JWT), a que tier
 * quiere subir y que feature la disparo. Recibe el cliente sql por inyeccion (testeable), mismo patron que
 * RecipeRepository / RegistrationRepository, y usa el rol de servicio del pooler (omite RLS): el
 * aislamiento por owner es el WHERE owner_id de cada query.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej. V023
 * sin aplicar), Postgres falla ruidosamente en vez de devolver una fila con campos undefined.
 *
 * Este repositorio cubre: la creacion self-service del usuario (con anti-duplicado), la lectura de las
 * solicitudes propias (GET /me) y la lectura a nivel plataforma para el admin (listAll, sin filtro de owner).
 */

/** Los planes que un usuario puede SOLICITAR: el universo de profiles.tier (V007) MENOS 'free' (el estado
 *  actual / un downgrade, no se 'solicita'). Coincide con el CHECK de V023 y el enum Zod de la ruta. */
export type RequestedTier = 'pro' | 'autonomous';

/** Las 4 superficies premium que pueden disparar una solicitud. null = CTA generico sin feature especifica. */
export type FeatureContext = 'scheduled_tasks' | 'triggers' | 'recipes' | 'configurator';

/** Estado del lead en el embudo de conversion (lo mueve el admin). Arranca 'pending'. */
export type UpgradeRequestStatus = 'pending' | 'contacted' | 'converted' | 'declined';

/** Una solicitud de upgrade, tal como vive en la tabla `upgrade_requests`. snake_case -> camelCase. */
export interface UpgradeRequest {
  id: string;
  /** Dueno de la solicitud (sub del JWT), misma tenancy que agents.owner_id. */
  ownerId: string;
  /** Plan al que quiere subir (nunca 'free'). */
  requestedTier: RequestedTier;
  /** Feature que disparo la solicitud. null = CTA generico. */
  featureContext: FeatureContext | null;
  /** Estado del lead en el embudo. */
  status: UpgradeRequestStatus;
  /** Nota opcional (contexto del usuario o resultado del contacto del admin). null = sin nota. */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Insumos para crear una solicitud. status/timestamps los pone la base. */
export interface CreateUpgradeRequestInput {
  ownerId: string;
  requestedTier: RequestedTier;
  /** null/ausente = sin feature especifica (CTA generico). */
  featureContext?: FeatureContext | null;
}

interface UpgradeRequestRow {
  id: string;
  owner_id: string;
  requested_tier: string;
  feature_context: string | null;
  status: string;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Fila del listado admin: la fila normal + el total de la ventana (count(*) over(), viene como string
 *  porque bigint). */
interface UpgradeRequestListRow extends UpgradeRequestRow {
  total_count: number | string;
}

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar RangeError. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO de epoch: fallback no-lanzante para los timestamps not-null (created_at/updated_at). */
const EPOCH_ISO = new Date(0).toISOString();

/** Entero tolerante para count(*) over() (llega como string por ser bigint). */
function toInt(value: number | string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** True si el error es un unique_violation de Postgres (SQLSTATE 23505). Mismo helper que registration-repository. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

function rowToUpgradeRequest(row: UpgradeRequestRow): UpgradeRequest {
  return {
    id: row.id,
    ownerId: row.owner_id,
    requestedTier: row.requested_tier as RequestedTier,
    featureContext: (row.feature_context as FeatureContext | null) ?? null,
    status: row.status as UpgradeRequestStatus,
    note: row.note,
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
    updatedAt: toIso(row.updated_at) ?? EPOCH_ISO,
  };
}

/** Pagina del listado admin: las filas + el total de la plataforma (para la paginacion). */
export interface UpgradeRequestPage {
  items: UpgradeRequest[];
  /** Total de solicitudes que matchean el filtro (ignora limit/offset), para calcular paginas en la UI. */
  total: number;
}

export class UpgradeRequestsRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * La solicitud 'pending' del owner para un tier dado, si existe. Es la base del ANTI-DUPLICADO: la ruta
   * la consulta antes de crear una nueva. Devuelve null si el owner no tiene ninguna 'pending' de ese tier.
   * Acotado por owner_id + requested_tier + status (aislamiento por owner).
   */
  async findPendingByOwnerAndTier(
    ownerId: string,
    requestedTier: RequestedTier,
  ): Promise<UpgradeRequest | null> {
    const rows = await this.sql<UpgradeRequestRow[]>`
      select id, owner_id, requested_tier, feature_context, status, note, created_at, updated_at
      from upgrade_requests
      where owner_id = ${ownerId} and requested_tier = ${requestedTier} and status = 'pending'
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    return row ? rowToUpgradeRequest(row) : null;
  }

  /**
   * Crea una solicitud para el owner. status/timestamps los pone la base; feature_context puede ir null.
   * Devuelve la solicitud + `created`: true si ESTA llamada inserto la fila, false si devolvio una
   * existente (idempotente), mismo contrato que RegistrationResult.created. La ruta usa el flag para el
   * status code (201 vs 200), asi la respuesta es EXACTA aun en el caso de recuperacion (ver abajo).
   *
   * ANTI-DUPLICADO (defensa en profundidad): el caso comun (clicks secuenciales) lo cubre el
   * select-then-insert de la ruta. Este metodo cierra la ventana TOCTOU de dos clicks CONCURRENTES: si el
   * INSERT choca con el indice unico parcial de V023 (23505), en vez de propagar un 500 captura el error y
   * devuelve la solicitud 'pending' existente con created:false (mismo criterio que registerOrganization),
   * de modo que el request perdedor de la carrera NO recibe un 201/created:true enganoso.
   */
  async createRequest(
    input: CreateUpgradeRequestInput,
  ): Promise<{ upgradeRequest: UpgradeRequest; created: boolean }> {
    try {
      const rows = await this.sql<UpgradeRequestRow[]>`
        insert into upgrade_requests (owner_id, requested_tier, feature_context)
        values (${input.ownerId}, ${input.requestedTier}, ${input.featureContext ?? null})
        returning id, owner_id, requested_tier, feature_context, status, note, created_at, updated_at
      `;
      return { upgradeRequest: rowToUpgradeRequest(rows[0] as UpgradeRequestRow), created: true };
    } catch (err) {
      // Carrera perdida (otro request creo la 'pending' del mismo owner+tier entre el SELECT y el INSERT):
      // devolver la existente de forma idempotente (created:false). Cualquier otro error se propaga.
      if (isUniqueViolation(err)) {
        const existing = await this.findPendingByOwnerAndTier(input.ownerId, input.requestedTier);
        if (existing) return { upgradeRequest: existing, created: false };
      }
      throw err;
    }
  }

  /** Lista TODAS las solicitudes del owner (mas nuevas primero), para GET /v1/upgrade-requests/me. */
  async listByOwner(ownerId: string): Promise<UpgradeRequest[]> {
    const rows = await this.sql<UpgradeRequestRow[]>`
      select id, owner_id, requested_tier, feature_context, status, note, created_at, updated_at
      from upgrade_requests
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToUpgradeRequest);
  }

  /**
   * LISTA a nivel PLATAFORMA para el panel de admin (GET /v1/admin/upgrade-requests, gate requireAdminRole).
   * NO aisla por owner: el admin ve a TODOS (la proteccion es el gate de rol, no un filtro de pertenencia),
   * mismo criterio que RegistrationRepository.listUsers. Read-only.
   *
   * Filtro OPCIONAL por status (dos ramas explicitas con/sin filtro, mismo criterio que listUsers, mas
   * legible y testeable que un fragmento SQL condicional). El total sale del mismo SELECT con
   * `count(*) over()` (ventana calculada ANTES del limit/offset), sin una segunda query de conteo. Orden
   * estable `created_at desc, id desc` (el id desempata para que la paginacion no repita ni salte filas).
   * La ruta valida y acota limit/offset/status antes de llamar aca (este metodo confia en valores saneados).
   */
  async listAll(params: {
    limit: number;
    offset: number;
    status?: UpgradeRequestStatus;
  }): Promise<UpgradeRequestPage> {
    const { limit, offset, status } = params;
    const rows =
      status === undefined
        ? await this.sql<UpgradeRequestListRow[]>`
            select id, owner_id, requested_tier, feature_context, status, note, created_at, updated_at,
              count(*) over() as total_count
            from upgrade_requests
            order by created_at desc, id desc
            limit ${limit} offset ${offset}
          `
        : await this.sql<UpgradeRequestListRow[]>`
            select id, owner_id, requested_tier, feature_context, status, note, created_at, updated_at,
              count(*) over() as total_count
            from upgrade_requests
            where status = ${status}
            order by created_at desc, id desc
            limit ${limit} offset ${offset}
          `;
    const total = rows[0] ? toInt(rows[0].total_count) : 0;
    return { items: rows.map(rowToUpgradeRequest), total };
  }
}
