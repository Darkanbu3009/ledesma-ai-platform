/**
 * SHAPES de los payloads de los JOBS DE SITIOS CONECTADOS (Fase 7.1b). Un "sitio conectado" es un
 * dominio en el que el usuario inicia sesion EL MISMO en un navegador real remoto (vista en vivo);
 * el worker solo ORQUESTA: abre la sesion de navegador, persiste el registro y despues hereda el
 * contexto ya confirmado. El login JAMAS se automatiza y NINGUN payload de este modulo lleva (ni
 * llevara) un campo de contrasena: el worker nunca ve credenciales del sitio.
 *
 * Vive en packages/shared (junto a recipe-payload.ts) porque lo consumen DOS workspaces: el backend
 * (el disparador que encola, 7.1c) y el worker (que ejecuta, 7.1b). Son tipos PUROS con validadores
 * SIN dependencias (ni Zod), igual que recipe-payload.ts.
 *
 * DISCRIMINADOR: mismo esquema que kind:'recipe' (V013/5.5a). Un job simple no tiene `kind`; una
 * receta lleva kind:'recipe'; los tres jobs de sitios llevan kind:'conectar_sitio',
 * kind:'confirmar_conexion' o kind:'desconectar_sitio'. Todas las formas son mutuamente excluyentes.
 *
 * NOTA sobre owner: el dueno de la operacion es SIEMPRE jobs.owner_id (la columna NOT NULL de V008),
 * la misma fuente de verdad que usan los jobs simples y de receta. El payload no duplica el owner:
 * un payload que pudiera contradecir a la fila seria un vector de confusion de tenancy.
 */

/** Discriminador del job que ABRE la sesion de navegador para el login manual del usuario. */
export const CONECTAR_SITIO_JOB_KIND = 'conectar_sitio';
/** Discriminador del job que CONFIRMA el login: hereda el contexto, lo cifra y cierra la sesion. */
export const CONFIRMAR_CONEXION_JOB_KIND = 'confirmar_conexion';
/** Discriminador del job que DESCONECTA el sitio: borra contexto local y en el proveedor (ARCO). */
export const DESCONECTAR_SITIO_JOB_KIND = 'desconectar_sitio';

/** Los tres kinds de jobs de sitios conectados, para chequeos de pertenencia. */
export const SITIO_JOB_KINDS = [
  CONECTAR_SITIO_JOB_KIND,
  CONFIRMAR_CONEXION_JOB_KIND,
  DESCONECTAR_SITIO_JOB_KIND,
] as const;

export type SitioJobKind = (typeof SITIO_JOB_KINDS)[number];

/** Payload del job que abre la sesion de navegador para que el usuario se loguee en `url`. */
export interface ConectarSitioJobPayload {
  kind: typeof CONECTAR_SITIO_JOB_KIND;
  /** URL de login del sitio (el dominio de la conexion se deriva de aca). */
  url: string;
  /**
   * PAIS del usuario (ISO 3166-1 alpha-2, mayusculas). El worker fija la geolocalizacion del proxy
   * a este pais y lo PINEA a (owner, dominio): desde entonces la continuidad de red se verifica por
   * PAIS de salida, no por IP exacta (los proxies del pool rotan IP dentro del pais).
   */
  pais: string;
}

/** Regex del pais ISO 3166-1 alpha-2 (dos letras; se normaliza a mayusculas al parsear). */
const PAIS_ISO2_REGEX = /^[A-Za-z]{2}$/;

/** ¿`value` es un codigo de pais ISO 3166-1 alpha-2 (dos letras ASCII)? */
export function esPaisIso2(value: unknown): value is string {
  return typeof value === 'string' && PAIS_ISO2_REGEX.test(value);
}

/** Payload del job que confirma una conexion cuyo login manual ya ocurrio. */
export interface ConfirmarConexionJobPayload {
  kind: typeof CONFIRMAR_CONEXION_JOB_KIND;
  /** Id de la fila de sitios_conectados (V024) creada por conectar_sitio. */
  connectionId: string;
}

/** Payload del job que borra la conexion en los tres lados (proveedor, base, ARCO). */
export interface DesconectarSitioJobPayload {
  kind: typeof DESCONECTAR_SITIO_JOB_KIND;
  /** Id de la fila de sitios_conectados (V024) a borrar. */
  connectionId: string;
}

export type SitioJobPayload =
  | ConectarSitioJobPayload
  | ConfirmarConexionJobPayload
  | DesconectarSitioJobPayload;

/** Resultado de validar un payload de sitio (estilo safeParse, sin lanzar; igual que recipe-payload). */
export type SitioJobPayloadParseResult =
  | { success: true; data: SitioJobPayload }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * DISCRIMINADOR barato: ¿este payload AFIRMA ser de sitios conectados (kind en los tres literales)?
 * No valida la forma completa (para eso esta parseSitioJobPayload); es el check que el worker usa
 * para RAMIFICAR igual que isRecipeJobPayload. false para jobs simples, recetas y basura.
 */
export function isSitioJobPayload(value: unknown): boolean {
  return isRecord(value) && (SITIO_JOB_KINDS as readonly unknown[]).includes(value.kind);
}

/**
 * Valida COMPLETAMENTE un payload de sitio segun su kind. conectar_sitio exige `url` string no vacio
 * ademas parseable como URL http(s); confirmar_conexion y desconectar_sitio exigen `connectionId`
 * string no vacio. Devuelve { success, data } o { success, error } sin lanzar.
 */
export function parseSitioJobPayload(value: unknown): SitioJobPayloadParseResult {
  if (!isRecord(value)) {
    return { success: false, error: 'payload no es un objeto' };
  }
  const kind = value.kind;
  if (kind === CONECTAR_SITIO_JOB_KIND) {
    if (typeof value.url !== 'string' || value.url.length === 0) {
      return { success: false, error: 'url debe ser un string no vacio' };
    }
    let parsed: URL;
    try {
      parsed = new URL(value.url);
    } catch {
      return { success: false, error: 'url no es una URL valida' };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { success: false, error: 'url debe ser http(s)' };
    }
    if (!esPaisIso2(value.pais)) {
      return { success: false, error: 'pais debe ser un codigo ISO 3166-1 alpha-2 (dos letras)' };
    }
    // El pais viaja SIEMPRE normalizado a mayusculas: es lo que se pinea y se compara.
    return { success: true, data: { kind, url: value.url, pais: value.pais.toUpperCase() } };
  }
  if (kind === CONFIRMAR_CONEXION_JOB_KIND || kind === DESCONECTAR_SITIO_JOB_KIND) {
    if (typeof value.connectionId !== 'string' || value.connectionId.length === 0) {
      return { success: false, error: 'connectionId debe ser un string no vacio' };
    }
    return { success: true, data: { kind, connectionId: value.connectionId } };
  }
  return { success: false, error: 'kind no corresponde a un job de sitios conectados' };
}

/** Deriva el DOMINIO de una conexion desde su URL de login (hostname en minusculas, sin puerto). */
export function dominioDeUrl(url: string): string {
  return new URL(url).hostname.toLowerCase();
}
