import type { Sql } from '../db/client.js';
import {
  COLUMN_TO_DOCUMENT_TYPE,
  DOCUMENT_TYPE_TO_COLUMN,
  type DocumentType,
} from './documents.js';

/**
 * Acceso a datos de las ACEPTACIONES LEGALES (tabla `aceptaciones_legales`, V039). Registra la aceptacion
 * VERSIONADA de un documento por un titular. Recibe el cliente sql por inyeccion (testeable), mismo patron
 * que RecipeRepository / ScheduledTaskRepository, y SIEMPRE acota por owner_id: una aceptacion ajena nunca
 * se lee ni se cuenta.
 *
 * EVIDENCIA SIN DATO PERSONAL: la unica evidencia de origen que se conserva es ip_hash, un HMAC-SHA256 no
 * reversible (privacy/ip-hash.ts). La IP en claro nunca llega a este repositorio: el endpoint la hashea
 * antes de llamar. La tabla vieja `consents` (V014), que si guardaba ip_address y user_agent, queda
 * congelada como historico y ya no se escribe.
 *
 * Este repositorio es tambien la UNICA frontera entre los dos vocabularios del documento: el contrato HTTP
 * habla privacy_notice/terms y la columna `documento` guarda aviso_privacidad/terminos (ver documents.ts).
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej. V039
 * sin aplicar), Postgres falla ruidosamente en vez de devolver una fila con campos undefined.
 */

/** Una aceptacion registrada. Se expone con el vocabulario del contrato HTTP (camelCase, tipos ingles). */
export interface Consent {
  id: string;
  /** Titular que acepto (sub del JWT). */
  ownerId: string;
  documentType: DocumentType;
  /** Version aceptada (fecha ISO). */
  documentVersion: string;
  acceptedAt: string;
  /** HMAC-SHA256 hex de la IP del request. null = no se capturo evidencia. NO reversible. */
  ipHash: string | null;
}

/** Insumos para registrar una aceptacion. aceptada_en lo pone la base. */
export interface RecordConsentInput {
  ownerId: string;
  documentType: DocumentType;
  documentVersion: string;
  /** Hash de la IP YA calculado por el llamador. Este repositorio nunca recibe una IP en claro. */
  ipHash?: string | null;
}

interface ConsentRow {
  id: string;
  owner_id: string;
  documento: string;
  version: string;
  aceptada_en: Date | string;
  ip_hash: string | null;
}

/** ISO de epoch: fallback no-lanzante para el timestamp not-null aceptada_en. */
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
    // Una fila con un `documento` fuera del CHECK no deberia existir; si existiera, no se inventa un tipo.
    documentType: COLUMN_TO_DOCUMENT_TYPE[row.documento] ?? (row.documento as DocumentType),
    documentVersion: row.version,
    acceptedAt: toIso(row.aceptada_en) ?? EPOCH_ISO,
    ipHash: row.ip_hash,
  };
}

export class ConsentRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Registra la aceptacion de una version de un documento. Idempotente: aceptar la MISMA version dos veces
   * NO duplica (ON CONFLICT DO NOTHING sobre el unique (owner_id, documento, version)); en ese caso
   * devuelve la aceptacion ya existente para que el endpoint responda de forma estable.
   */
  async recordConsent(input: RecordConsentInput): Promise<Consent> {
    const documento = DOCUMENT_TYPE_TO_COLUMN[input.documentType];
    const rows = await this.sql<ConsentRow[]>`
      insert into aceptaciones_legales (owner_id, documento, version, ip_hash)
      values (
        ${input.ownerId},
        ${documento},
        ${input.documentVersion},
        ${input.ipHash ?? null}
      )
      on conflict (owner_id, documento, version) do nothing
      returning id, owner_id, documento, version, aceptada_en, ip_hash
    `;
    const row = rows[0];
    if (row) return rowToConsent(row);
    // Ya existia (conflicto): devolvemos la aceptacion previa, acotada por owner (idempotente).
    const existing = await this.sql<ConsentRow[]>`
      select id, owner_id, documento, version, aceptada_en, ip_hash
      from aceptaciones_legales
      where owner_id = ${input.ownerId}
        and documento = ${documento}
        and version = ${input.documentVersion}
    `;
    return rowToConsent(existing[0] as ConsentRow);
  }

  /** Lista todas las aceptaciones del titular (mas nuevas primero). */
  async listConsentsByOwner(ownerId: string): Promise<Consent[]> {
    const rows = await this.sql<ConsentRow[]>`
      select id, owner_id, documento, version, aceptada_en, ip_hash
      from aceptaciones_legales
      where owner_id = ${ownerId}
      order by aceptada_en desc
    `;
    return rows.map(rowToConsent);
  }
}
