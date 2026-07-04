import type { Sql } from '../db/client.js';

/**
 * Acceso a datos de los TRIGGERS POR EVENTO (tabla `triggers`, V012). Recibe el cliente sql por
 * inyeccion (testeable), mismo patron que AgentRepository / ScheduledTaskRepository.
 *
 * Reglas de seguridad de esta capa (analogas a la boveda de credenciales):
 *  - Los SELECT/RETURNING de METADATA (listByOwner, getForOwner, update) JAMAS piden
 *    hmac_secret_encrypted ni url_token_hash: el material de auth no puede fugarse por una ruta que
 *    serialice el resultado del repo. SOLO getByIdForDispatch los lee, exclusivamente para el endpoint
 *    entrante server-side (nunca por HTTP).
 *  - owner_id va en el WHERE de toda lectura/escritura del CRUD por id: un trigger ajeno nunca se
 *    resuelve ni se modifica. getByIdForDispatch es la UNICA excepcion (no owner-scoped) porque el
 *    evento entrante no tiene usuario: la autorizacion es el :id de la URL + la firma/token.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej.
 * V012 sin aplicar), Postgres falla ruidosamente en vez de devolver un trigger con campos undefined.
 */

export type TriggerAuthMode = 'hmac' | 'url_token';

/** Metadata de un trigger. NUNCA incluye el material de auth (ni cifrado ni hasheado). A HTTP va esto. */
export interface TriggerMetadata {
  id: string;
  ownerId: string;
  agentId: string;
  credentialId: string;
  authMode: TriggerAuthMode;
  payloadTemplate: unknown;
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fila COMPLETA incl. el material de auth: SOLO para el endpoint entrante server-side. NUNCA se
 * serializa a una respuesta HTTP. hmac_secret_encrypted sigue CIFRADO aqui (la ruta lo descifra con
 * VAULT_SECRET al verificar); url_token_hash es el hash contra el que se compara en tiempo constante.
 */
export interface TriggerForDispatch {
  id: string;
  ownerId: string;
  agentId: string;
  credentialId: string;
  authMode: TriggerAuthMode;
  hmacSecretEncrypted: string | null;
  urlTokenHash: string | null;
  payloadTemplate: unknown;
  isActive: boolean;
}

/** Insumos para crear un trigger. El material de auth ya viene cifrado/hasheado por la ruta. */
export interface CreateTriggerInput {
  ownerId: string;
  agentId: string;
  credentialId: string;
  authMode: TriggerAuthMode;
  /** Secreto HMAC ya cifrado (solo auth_mode='hmac'; null si no aplica). */
  hmacSecretEncrypted?: string | null;
  /** SHA-256 del url_token (solo auth_mode='url_token'; null si no aplica). */
  urlTokenHash?: string | null;
  payloadTemplate: unknown;
}

/**
 * Campos de una actualizacion del CRUD (PATCH): estado y, opcionalmente, ROTACION del material de auth.
 * isActive siempre se pasa (la ruta lo fusiona con el actual). hmacSecretEncrypted/urlTokenHash solo se
 * pasan al ROTAR: null = conservar el actual (coalesce en el UPDATE), nunca los pone en null.
 */
export interface UpdateTriggerFields {
  isActive: boolean;
  hmacSecretEncrypted?: string | null;
  urlTokenHash?: string | null;
}

interface MetadataRow {
  id: string;
  owner_id: string;
  agent_id: string;
  credential_id: string;
  auth_mode: string;
  payload_template: unknown;
  is_active: boolean;
  last_triggered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DispatchRow {
  id: string;
  owner_id: string;
  agent_id: string;
  credential_id: string;
  auth_mode: string;
  hmac_secret_encrypted: string | null;
  url_token_hash: string | null;
  payload_template: unknown;
  is_active: boolean;
}

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar RangeError. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO de epoch: fallback no-lanzante para los timestamps not-null (created_at/updated_at). */
const EPOCH_ISO = new Date(0).toISOString();

function rowToMetadata(row: MetadataRow): TriggerMetadata {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    credentialId: row.credential_id,
    authMode: row.auth_mode as TriggerAuthMode,
    payloadTemplate: row.payload_template,
    isActive: row.is_active,
    lastTriggeredAt: toIso(row.last_triggered_at),
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
    updatedAt: toIso(row.updated_at) ?? EPOCH_ISO,
  };
}

function rowToDispatch(row: DispatchRow): TriggerForDispatch {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    credentialId: row.credential_id,
    authMode: row.auth_mode as TriggerAuthMode,
    hmacSecretEncrypted: row.hmac_secret_encrypted,
    urlTokenHash: row.url_token_hash,
    payloadTemplate: row.payload_template,
    isActive: row.is_active,
  };
}

export class TriggersRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Crea un trigger. is_active/timestamps los pone la base. El material de auth (hmac_secret_encrypted o
   * url_token_hash) ya viene cifrado/hasheado por la ruta. RETURNING de metadata: nunca devuelve el
   * material de auth (el secreto/token en claro lo muestra la ruta una vez, desde lo que ella genero).
   */
  async createTrigger(input: CreateTriggerInput): Promise<TriggerMetadata> {
    const rows = await this.sql<MetadataRow[]>`
      insert into triggers (owner_id, agent_id, credential_id, auth_mode, hmac_secret_encrypted,
        url_token_hash, payload_template)
      values (
        ${input.ownerId},
        ${input.agentId},
        ${input.credentialId},
        ${input.authMode},
        ${input.hmacSecretEncrypted ?? null},
        ${input.urlTokenHash ?? null},
        ${this.sql.json(input.payloadTemplate as Parameters<Sql['json']>[0])}
      )
      returning id, owner_id, agent_id, credential_id, auth_mode, payload_template, is_active,
        last_triggered_at, created_at, updated_at
    `;
    return rowToMetadata(rows[0] as MetadataRow);
  }

  /** Lista los triggers del owner (mas nuevos primero), SIN material de auth. */
  async listByOwner(ownerId: string): Promise<TriggerMetadata[]> {
    const rows = await this.sql<MetadataRow[]>`
      select id, owner_id, agent_id, credential_id, auth_mode, payload_template, is_active,
        last_triggered_at, created_at, updated_at
      from triggers
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToMetadata);
  }

  /** Resuelve UN trigger del owner por id (metadata, sin secreto). null si no existe o es ajeno. */
  async getForOwner(id: string, ownerId: string): Promise<TriggerMetadata | null> {
    const rows = await this.sql<MetadataRow[]>`
      select id, owner_id, agent_id, credential_id, auth_mode, payload_template, is_active,
        last_triggered_at, created_at, updated_at
      from triggers
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToMetadata(row) : null;
  }

  /**
   * Actualiza estado y, opcionalmente, ROTA el material de auth de un trigger del owner. is_active
   * siempre se setea (fusionado por la ruta). Para el secreto/token usa coalesce(${nuevo}, actual): al
   * ROTAR llega el nuevo valor (cifrado/hasheado) y lo pisa; si no se rota llega null y CONSERVA el
   * actual. Acotado por id + owner_id (trigger ajeno -> null). RETURNING de metadata (sin secreto).
   */
  async updateForOwner(id: string, ownerId: string, fields: UpdateTriggerFields): Promise<TriggerMetadata | null> {
    const rows = await this.sql<MetadataRow[]>`
      update triggers set
        is_active = ${fields.isActive},
        hmac_secret_encrypted = coalesce(${fields.hmacSecretEncrypted ?? null}, hmac_secret_encrypted),
        url_token_hash = coalesce(${fields.urlTokenHash ?? null}, url_token_hash),
        updated_at = now()
      where id = ${id} and owner_id = ${ownerId}
      returning id, owner_id, agent_id, credential_id, auth_mode, payload_template, is_active,
        last_triggered_at, created_at, updated_at
    `;
    const row = rows[0];
    return row ? rowToMetadata(row) : null;
  }

  /**
   * CONTEO de triggers ACTIVOS del owner (is_active = true), para el eje OPERACIONES del dashboard. UNA
   * query agregada (count server-side, sin traer material de auth ni la lista entera), read-only y
   * aislada por owner_id. count(*)::int llega como number; el Number() es defensa extra.
   */
  async countActiveByOwner(ownerId: string): Promise<number> {
    const rows = await this.sql<Array<{ count: number | string }>>`
      select count(*)::int as count
      from triggers
      where owner_id = ${ownerId} and is_active = true
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /** Borra un trigger del owner. true si borro una fila propia; false si ajena o inexistente. */
  async deleteForOwner(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from triggers
      where id = ${id} and owner_id = ${ownerId}
      returning id
    `;
    return rows.length > 0;
  }

  /**
   * RESUELVE un trigger por id para el ENDPOINT ENTRANTE (server-side). Es la UNICA lectura NO
   * owner-scoped y la UNICA que trae el material de auth: el evento entrante no tiene usuario, asi que
   * la autorizacion es el :id + la firma/token que la ruta verifica. Devuelve null si no existe (la ruta
   * responde 404 generico, sin distinguir de un trigger inactivo). NUNCA se serializa a HTTP.
   */
  async getByIdForDispatch(id: string): Promise<TriggerForDispatch | null> {
    const rows = await this.sql<DispatchRow[]>`
      select id, owner_id, agent_id, credential_id, auth_mode, hmac_secret_encrypted, url_token_hash,
        payload_template, is_active
      from triggers
      where id = ${id}
    `;
    const row = rows[0];
    return row ? rowToDispatch(row) : null;
  }

  /** Marca que el trigger disparo (last_triggered_at = now()). Lo llama el entrante tras encolar el job. */
  async markTriggered(id: string): Promise<void> {
    await this.sql`
      update triggers set last_triggered_at = now(), updated_at = now()
      where id = ${id}
    `;
  }
}
