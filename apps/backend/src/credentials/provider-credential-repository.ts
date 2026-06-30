import type { ProviderId } from '@ledesma-platform/shared';
import type { Sql } from '../db/client.js';
import { decryptFromToken } from '../crypto/aes-gcm.js';

/**
 * Acceso a datos de la BOVEDA DE CREDENCIALES. Mismo patron que AgentRepository: recibe el cliente
 * sql por inyeccion (testeable) y SIEMPRE acota por ownerId.
 *
 * Reglas de seguridad de esta capa:
 * - El SELECT de metadata NUNCA pide encrypted_key: la key cifrada no puede fugarse por una ruta que
 *   serialice el resultado del repo. Solo getDecryptedKeyForOwner la lee, y devuelve la key en claro
 *   exclusivamente para uso server-side (jamas por HTTP).
 * - El descifrado ocurre aqui con el vaultSecret que recibe getDecryptedKeyForOwner. El cifrado al
 *   crear ocurre en la capa de ruta (encryptToToken): create recibe encrypted_key ya cifrada.
 * - owner_id va en el WHERE de toda lectura/borrado por id: una credencial ajena nunca se resuelve.
 */

/** Metadata de una credencial guardada. NUNCA incluye la key (ni cifrada ni en claro). */
export interface ProviderCredentialMetadata {
  id: string;
  label: string;
  providerId: ProviderId;
  baseUrl: string | null;
  createdAt: string;
}

/** Insumos para crear una credencial. encryptedKey ya viene cifrada (la ruta cifra con aes-gcm). */
export interface CreateProviderCredentialInput {
  ownerId: string;
  label: string;
  providerId: ProviderId;
  encryptedKey: string;
  baseUrl?: string | null;
}

/** Credencial resuelta + descifrada para uso server-side. NUNCA se serializa a una respuesta HTTP. */
export interface DecryptedProviderCredential {
  apiKey: string;
  providerId: ProviderId;
  baseUrl: string | null;
}

interface MetadataRow {
  id: string;
  label: string;
  provider_id: string;
  base_url: string | null;
  created_at: Date | string;
}

interface DecryptRow {
  encrypted_key: string;
  provider_id: string;
  base_url: string | null;
}

function rowToMetadata(row: MetadataRow): ProviderCredentialMetadata {
  return {
    id: row.id,
    label: row.label,
    providerId: row.provider_id as ProviderId,
    baseUrl: row.base_url,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class ProviderCredentialRepository {
  constructor(private readonly sql: Sql) {}

  // Columnas SIEMPRE explicitas (nunca select * / returning *): el SELECT/RETURNING de metadata jamas
  // incluye encrypted_key, de modo que la key cifrada no puede salir por accidente del repositorio.

  async create(input: CreateProviderCredentialInput): Promise<ProviderCredentialMetadata> {
    const rows = await this.sql<MetadataRow[]>`
      insert into provider_credentials (owner_id, label, provider_id, encrypted_key, base_url)
      values (
        ${input.ownerId},
        ${input.label},
        ${input.providerId},
        ${input.encryptedKey},
        ${input.baseUrl ?? null}
      )
      returning id, label, provider_id, base_url, created_at
    `;
    return rowToMetadata(rows[0] as MetadataRow);
  }

  async listByOwner(ownerId: string): Promise<ProviderCredentialMetadata[]> {
    const rows = await this.sql<MetadataRow[]>`
      select id, label, provider_id, base_url, created_at
      from provider_credentials
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToMetadata);
  }

  /**
   * USO INTERNO server-side: resuelve la credencial del owner, descifra la key con el vaultSecret y
   * devuelve { apiKey, providerId, baseUrl }. El filtro owner_id = ownerId es el aislamiento CRITICO:
   * un usuario NO puede descifrar la credencial de otro (fila ajena -> null, jamas la key). Devuelve
   * null si la credencial no existe, no es del owner, o el descifrado falla (encrypted_key corrupta o
   * vaultSecret incorrecto/rotado). NUNCA se expone por HTTP.
   */
  async getDecryptedKeyForOwner(
    ownerId: string,
    credentialId: string,
    vaultSecret: string,
  ): Promise<DecryptedProviderCredential | null> {
    const rows = await this.sql<DecryptRow[]>`
      select encrypted_key, provider_id, base_url
      from provider_credentials
      where id = ${credentialId} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    if (!row) return null;
    let apiKey: string;
    try {
      apiKey = decryptFromToken(row.encrypted_key, vaultSecret);
    } catch {
      // No distinguimos el modo de fallo ni filtramos detalle: la credencial simplemente no es usable.
      return null;
    }
    return { apiKey, providerId: row.provider_id as ProviderId, baseUrl: row.base_url };
  }

  async deleteForOwner(ownerId: string, credentialId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from provider_credentials
      where id = ${credentialId} and owner_id = ${ownerId}
      returning id
    `;
    return rows.length > 0;
  }
}
