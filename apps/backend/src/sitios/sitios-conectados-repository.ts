import type { Sql } from '../db/client.js';
import { encryptToToken, decryptFromToken } from '../crypto/aes-gcm.js';

/**
 * Acceso a datos de los SITIOS CONECTADOS (tabla `sitios_conectados`, V024): dominios en los que el
 * usuario YA inicio sesion EL MISMO (el login jamas se automatiza ni pasa por aqui) y cuya sesion de
 * navegador (cookies/storage) se hereda para que un agente opere DENTRO de su cuenta. Recibe el
 * cliente sql por inyeccion (testeable), mismo patron que ProviderCredentialRepository /
 * RecipeRepository, y SIEMPRE acota por owner_id: un sitio ajeno nunca se resuelve ni se modifica.
 *
 * Reglas de seguridad de esta capa (calcadas de la boveda de credenciales, V006):
 * - NO existe ningun campo de contrasena en ningun tipo de este modulo. Lo que se guarda es el
 *   CONTEXTO DE SESION resultante del login manual, y ese contexto SON credenciales: vale lo mismo
 *   que la contrasena que se evito guardar.
 * - El SELECT de metadata NUNCA pide contexto_cifrado: el blob no puede fugarse por una ruta que
 *   serialice el resultado del repo. Solo obtenerContextoDescifrado lo lee, y devuelve el contexto
 *   en claro exclusivamente para uso server-side (jamas por HTTP, jamas a logs).
 * - El cifrado ocurre AQUI (guardarContexto) con el MISMO modulo de VAULT_SECRET de toda la
 *   plataforma (src/crypto/aes-gcm.ts, AES-256-GCM): el contexto en claro NUNCA toca la base. En la
 *   columna bytea viven exactamente los bytes iv | tag | ciphertext que empaqueta ese modulo (el
 *   token base64url decodificado); el modulo no se modifica.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna
 * (p.ej. V024 sin aplicar), Postgres falla ruidosamente en vez de devolver campos undefined.
 *
 * Este modulo es SOLO datos (7.1a). El ejecutor que abre la sesion de navegador, muestra la vista en
 * vivo, verifica la egress_ip pineada y hereda el contexto es 7.1b; los endpoints y la UI son 7.1c.
 */

/** Ciclo de vida de una conexion (CHECK en V024). */
export type EstadoSitioConectado = 'esperando_login' | 'activo' | 'caducado' | 'error';

/** Un sitio conectado, tal como vive en la tabla. NUNCA incluye el contexto (ni cifrado ni en claro). */
export interface SitioConectado {
  id: string;
  /** Dueno de la conexion (sub del JWT), misma tenancy que agents.owner_id. */
  ownerId: string;
  /** Dominio conectado. Un owner tiene a lo sumo una conexion por dominio. */
  dominio: string;
  /** URL de login que se abrio en la vista en vivo. null = no registrada. */
  urlLogin: string | null;
  /** Id del contexto de navegador en el proveedor externo. null = aun no establecido. */
  contextoExternoId: string | null;
  /** Referencia de la salida de red pineada para este dominio. null = aun no asignada. */
  proxyRef: string | null;
  /** IP de salida observada al establecer la sesion. null = aun no observada. */
  egressIp: string | null;
  /** Referencia del fingerprint de navegador. null = no registrada. */
  fingerprintRef: string | null;
  estado: EstadoSitioConectado;
  /** true si hay un contexto de sesion guardado (cifrado). El blob en si jamas se expone. */
  tieneContexto: boolean;
  creadoEn: string;
  /** Ultima vez que una ejecucion uso esta sesion (ISO). null = nunca. */
  ultimoUsoEn: string | null;
  /** Expiracion conocida de la sesion (ISO). null = desconocida. */
  expiraEn: string | null;
}

/** Insumos para crear una conexion. Nace en 'esperando_login'; el contexto llega despues (guardarContexto). */
export interface CrearSitioConectadoInput {
  ownerId: string;
  dominio: string;
  /** null/ausente = sin URL de login registrada. */
  urlLogin?: string | null;
  /** null/ausente = salida de red aun no asignada. */
  proxyRef?: string | null;
  /** null/ausente = sin fingerprint registrado. */
  fingerprintRef?: string | null;
}

/**
 * Insumos para guardar el contexto de sesion al confirmar el login. `contexto` viene EN CLARO desde
 * el ejecutor server-side (7.1b) y este repositorio lo cifra ANTES de tocar la base: jamas se
 * persiste ni se loguea en claro.
 */
export interface GuardarContextoInput {
  /** Contexto de sesion en claro (cookies/storage serializados). Solo existe en memoria server-side. */
  contexto: string;
  /** Id del contexto en el proveedor externo. null = el proveedor no maneja contextos con id. */
  contextoExternoId?: string | null;
  /** IP de salida observada al establecer la sesion. null = no observada. */
  egressIp?: string | null;
  /** Expiracion conocida de la sesion (ISO). null = desconocida. */
  expiraEn?: string | null;
}

/** Resultado de borrar: lo necesario para que 7.1b purgue el contexto TAMBIEN en el proveedor. */
export interface SitioConectadoBorrado {
  id: string;
  dominio: string;
  /** Id del contexto en el proveedor externo, o null si nunca se establecio. */
  contextoExternoId: string | null;
}

interface SitioRow {
  id: string;
  owner_id: string;
  dominio: string;
  url_login: string | null;
  contexto_externo_id: string | null;
  proxy_ref: string | null;
  egress_ip: string | null;
  fingerprint_ref: string | null;
  estado: string;
  tiene_contexto: boolean;
  creado_en: Date | string;
  ultimo_uso_en: Date | string | null;
  expira_en: Date | string | null;
}

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar RangeError. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO de epoch: fallback no-lanzante para el timestamp not-null (creado_en). */
const EPOCH_ISO = new Date(0).toISOString();

function rowToSitio(row: SitioRow): SitioConectado {
  return {
    id: row.id,
    ownerId: row.owner_id,
    dominio: row.dominio,
    urlLogin: row.url_login,
    contextoExternoId: row.contexto_externo_id,
    proxyRef: row.proxy_ref,
    egressIp: row.egress_ip,
    fingerprintRef: row.fingerprint_ref,
    estado: row.estado as EstadoSitioConectado,
    tieneContexto: row.tiene_contexto === true,
    creadoEn: toIso(row.creado_en) ?? EPOCH_ISO,
    ultimoUsoEn: toIso(row.ultimo_uso_en),
    expiraEn: toIso(row.expira_en),
  };
}

export class SitiosConectadosRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Crea la conexion en 'esperando_login' (el usuario aun no confirma su login manual). El unique
   * (owner_id, dominio) de V024 rechaza un duplicado: reconectar un dominio existente es borrar y
   * volver a crear (o un upsert de 7.1b), nunca duplicar.
   */
  async crear(input: CrearSitioConectadoInput): Promise<SitioConectado> {
    const rows = await this.sql<SitioRow[]>`
      insert into sitios_conectados (owner_id, dominio, url_login, proxy_ref, fingerprint_ref, estado)
      values (
        ${input.ownerId},
        ${input.dominio},
        ${input.urlLogin ?? null},
        ${input.proxyRef ?? null},
        ${input.fingerprintRef ?? null},
        'esperando_login'
      )
      returning id, owner_id, dominio, url_login, contexto_externo_id, proxy_ref, egress_ip::text as egress_ip,
        fingerprint_ref, estado, (contexto_cifrado is not null) as tiene_contexto, creado_en,
        ultimo_uso_en, expira_en
    `;
    return rowToSitio(rows[0] as SitioRow);
  }

  /** Resuelve LA conexion del owner para un dominio. null si no existe o es ajena (aislamiento por owner). */
  async obtenerPorDominio(ownerId: string, dominio: string): Promise<SitioConectado | null> {
    const rows = await this.sql<SitioRow[]>`
      select id, owner_id, dominio, url_login, contexto_externo_id, proxy_ref, egress_ip::text as egress_ip,
        fingerprint_ref, estado, (contexto_cifrado is not null) as tiene_contexto, creado_en,
        ultimo_uso_en, expira_en
      from sitios_conectados
      where owner_id = ${ownerId} and dominio = ${dominio}
    `;
    const row = rows[0];
    return row ? rowToSitio(row) : null;
  }

  /** Lista las conexiones del owner (mas nuevas primero). Metadata solamente: jamas blobs. */
  async listarPorOwner(ownerId: string): Promise<SitioConectado[]> {
    const rows = await this.sql<SitioRow[]>`
      select id, owner_id, dominio, url_login, contexto_externo_id, proxy_ref, egress_ip::text as egress_ip,
        fingerprint_ref, estado, (contexto_cifrado is not null) as tiene_contexto, creado_en,
        ultimo_uso_en, expira_en
      from sitios_conectados
      where owner_id = ${ownerId}
      order by creado_en desc
    `;
    return rows.map(rowToSitio);
  }

  /** Actualiza el estado de una conexion del owner. Acotado por id + owner_id: una ajena no se toca (-> null). */
  async actualizarEstado(
    id: string,
    ownerId: string,
    estado: EstadoSitioConectado,
  ): Promise<SitioConectado | null> {
    const rows = await this.sql<SitioRow[]>`
      update sitios_conectados set estado = ${estado}
      where id = ${id} and owner_id = ${ownerId}
      returning id, owner_id, dominio, url_login, contexto_externo_id, proxy_ref, egress_ip::text as egress_ip,
        fingerprint_ref, estado, (contexto_cifrado is not null) as tiene_contexto, creado_en,
        ultimo_uso_en, expira_en
    `;
    const row = rows[0];
    return row ? rowToSitio(row) : null;
  }

  /**
   * Guarda el contexto de sesion al confirmar el login manual y marca la conexion 'activo'. El
   * contexto se cifra AQUI (AES-256-GCM / VAULT_SECRET, el modulo compartido aes-gcm.ts) ANTES de
   * tocar la base: en bytea se persisten los bytes iv | tag | ciphertext del token que produce
   * encryptToToken, y el claro no sale de esta funcion. Acotado por id + owner_id.
   */
  async guardarContexto(
    id: string,
    ownerId: string,
    input: GuardarContextoInput,
    vaultSecret: string,
  ): Promise<SitioConectado | null> {
    // encryptToToken empaqueta base64url(iv | tag | ciphertext); se decodifica a los bytes crudos
    // para bytea. La lectura (obtenerContextoDescifrado) re-encodea y descifra con el mismo modulo.
    const contextoCifrado = Buffer.from(encryptToToken(input.contexto, vaultSecret), 'base64url');
    const rows = await this.sql<SitioRow[]>`
      update sitios_conectados set
        contexto_cifrado = ${contextoCifrado},
        contexto_externo_id = ${input.contextoExternoId ?? null},
        egress_ip = ${input.egressIp ?? null},
        expira_en = ${input.expiraEn ?? null},
        estado = 'activo',
        ultimo_uso_en = now()
      where id = ${id} and owner_id = ${ownerId}
      returning id, owner_id, dominio, url_login, contexto_externo_id, proxy_ref, egress_ip::text as egress_ip,
        fingerprint_ref, estado, (contexto_cifrado is not null) as tiene_contexto, creado_en,
        ultimo_uso_en, expira_en
    `;
    const row = rows[0];
    return row ? rowToSitio(row) : null;
  }

  /**
   * USO INTERNO server-side (el ejecutor de 7.1b): resuelve la conexion del owner y devuelve el
   * contexto de sesion DESCIFRADO. El filtro owner_id es el aislamiento CRITICO: un usuario no puede
   * descifrar la sesion de otro (fila ajena -> null, jamas el contexto). Devuelve null si la
   * conexion no existe, no es del owner, no tiene contexto, o el descifrado falla (blob corrupto o
   * VAULT_SECRET incorrecto/rotado). NUNCA se expone por HTTP ni se loguea.
   */
  async obtenerContextoDescifrado(
    id: string,
    ownerId: string,
    vaultSecret: string,
  ): Promise<string | null> {
    const rows = await this.sql<Array<{ contexto_cifrado: Uint8Array | null }>>`
      select contexto_cifrado
      from sitios_conectados
      where id = ${id} and owner_id = ${ownerId}
    `;
    const blob = rows[0]?.contexto_cifrado;
    if (blob === null || blob === undefined) return null;
    try {
      return decryptFromToken(Buffer.from(blob).toString('base64url'), vaultSecret);
    } catch {
      // No distinguimos el modo de fallo ni filtramos detalle: la sesion simplemente no es usable.
      return null;
    }
  }

  /**
   * Borra la conexion del owner y devuelve el contexto_externo_id para que 7.1b lo purgue TAMBIEN en
   * el proveedor (el borrado ARCO opera en ambos lados). null si la conexion no existe o es ajena.
   * El borrado por CUENTA COMPLETA (erasure ARCO via data_subject_requests, V014/V015) lo cubre
   * AccountDeletionRepository, que incluye sitios_conectados en su transaccion.
   */
  async borrar(id: string, ownerId: string): Promise<SitioConectadoBorrado | null> {
    const rows = await this.sql<Array<{ id: string; dominio: string; contexto_externo_id: string | null }>>`
      delete from sitios_conectados
      where id = ${id} and owner_id = ${ownerId}
      returning id, dominio, contexto_externo_id
    `;
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, dominio: row.dominio, contextoExternoId: row.contexto_externo_id };
  }
}
