import type { Sql } from '../db/client.js';
import type { DocumentType } from './documents.js';

/**
 * Acceso a datos de los CONSENTIMIENTOS (tabla `consents`, V014). Registra la aceptacion VERSIONADA de un
 * documento por un titular. Recibe el cliente sql por inyeccion (testeable), mismo patron que
 * RecipeRepository / ScheduledTaskRepository, y SIEMPRE acota por owner_id: un consentimiento ajeno nunca
 * se lee ni se cuenta.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej. V014
 * sin aplicar), Postgres falla ruidosamente en vez de devolver un consent con campos undefined.
 */

/** Un consentimiento registrado, tal como vive en la tabla `consents`. snake_case -> camelCase. */
export interface Consent {
  id: string;
  /** Titular que acepto (sub del JWT). */
  ownerId: string;
  documentType: DocumentType;
  /** Version aceptada (fecha ISO o semver). */
  documentVersion: string;
  acceptedAt: string;
  /** Evidencia opcional. null = no capturada. */
  ipAddress: string | null;
  userAgent: string | null;
}

/** Insumos para registrar un consentimiento. accepted_at lo pone la base. */
export interface RecordConsentInput {
  ownerId: string;
  documentType: DocumentType;
  documentVersion: string;
  /** Evidencia opcional (IP y user-agent del request). null/ausente si no se capturan. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface ConsentRow {
  id: string;
  owner_id: string;
  document_type: string;
  document_version: string;
  accepted_at: Date | string;
  ip_address: string | null;
  user_agent: string | null;
}

/** ISO de epoch: fallback no-lanzante para el timestamp not-null accepted_at. */
const EPOCH_ISO = new Date(0).toISOString();

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar RangeError. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    ownerId: row.owner_id,
    documentType: row.document_type as DocumentType,
    documentVersion: row.document_version,
    acceptedAt: toIso(row.accepted_at) ?? EPOCH_ISO,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

export class ConsentRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Registra la aceptacion de una version de un documento. Idempotente: aceptar la MISMA version dos veces
   * NO duplica (ON CONFLICT DO NOTHING sobre el unique (owner_id, document_type, document_version)); en ese
   * caso devuelve el consentimiento ya existente para que el endpoint responda de forma estable.
   */
  async recordConsent(input: RecordConsentInput): Promise<Consent> {
    const rows = await this.sql<ConsentRow[]>`
      insert into consents (owner_id, document_type, document_version, ip_address, user_agent)
      values (
        ${input.ownerId},
        ${input.documentType},
        ${input.documentVersion},
        ${input.ipAddress ?? null},
        ${input.userAgent ?? null}
      )
      on conflict (owner_id, document_type, document_version) do nothing
      returning id, owner_id, document_type, document_version, accepted_at, ip_address, user_agent
    `;
    const row = rows[0];
    if (row) return rowToConsent(row);
    // Ya existia (conflicto): devolvemos el consentimiento previo, acotado por owner (idempotente).
    const existing = await this.sql<ConsentRow[]>`
      select id, owner_id, document_type, document_version, accepted_at, ip_address, user_agent
      from consents
      where owner_id = ${input.ownerId}
        and document_type = ${input.documentType}
        and document_version = ${input.documentVersion}
    `;
    return rowToConsent(existing[0] as ConsentRow);
  }

  /** Lista todos los consentimientos del titular (mas nuevos primero). */
  async listConsentsByOwner(ownerId: string): Promise<Consent[]> {
    const rows = await this.sql<ConsentRow[]>`
      select id, owner_id, document_type, document_version, accepted_at, ip_address, user_agent
      from consents
      where owner_id = ${ownerId}
      order by accepted_at desc
    `;
    return rows.map(rowToConsent);
  }
}
