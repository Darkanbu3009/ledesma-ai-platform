import { createHmac } from 'node:crypto';

/**
 * Seudonimizacion de la IP para la EVIDENCIA de una aceptacion legal (tabla aceptaciones_legales, V039).
 *
 * Que problema resuelve: para acreditar un consentimiento hace falta poder decir "esta aceptacion vino del
 * mismo origen que aquella otra" y detectar aceptaciones masivas desde un solo punto. NO hace falta poder
 * recuperar la IP. Guardar la IP en claro (lo que hacia la tabla `consents` de V014) conserva un dato
 * personal por mas tiempo y con mas alcance del necesario.
 *
 * Solucion: HMAC-SHA256 con un secreto que vive SOLO en el entorno del backend. Es de una sola via (sin el
 * secreto no hay forma de volver a la IP) y es DETERMINISTA con el mismo secreto (dos aceptaciones desde la
 * misma IP producen el mismo digest, que es justo lo que permite correlacionar). Un hash simple sin secreto
 * NO serviria: el espacio de IPv4 son 2^32 valores y se invierte por fuerza bruta en minutos.
 *
 * Separacion de dominio: el mensaje lleva el prefijo `DOMAIN_PREFIX` para que, cuando se cae al secreto
 * compartido (SESSION_TOKEN_SECRET), el digest de este uso no pueda coincidir con el de ningun otro uso del
 * mismo secreto.
 */

/**
 * Prefijo de separacion de dominio. Lleva `v1` para poder cambiar el esquema en el futuro sin que los
 * digests viejos y nuevos se confundan entre si.
 */
const DOMAIN_PREFIX = 'aceptacion-legal-ip:v1|';

/** Config minima que necesita el hash. Se pide asi (y no el Env completo) para poder testearlo suelto. */
export interface IpHashSecrets {
  /** Secreto dedicado. Si esta, se usa este. */
  CONSENT_IP_HASH_SECRET?: string | undefined;
  /** Fallback siempre presente, con separacion de dominio (ver arriba). */
  SESSION_TOKEN_SECRET: string;
}

/**
 * Devuelve el HMAC-SHA256 en hex de la IP, o null si no hay IP que registrar. Nunca devuelve la IP: el
 * llamador no tiene forma de guardar el dato en claro por accidente.
 */
export function hashIp(ip: string | null | undefined, secrets: IpHashSecrets): string | null {
  const value = typeof ip === 'string' ? ip.trim() : '';
  if (value === '') return null;
  const secret = secrets.CONSENT_IP_HASH_SECRET ?? secrets.SESSION_TOKEN_SECRET;
  return createHmac('sha256', secret).update(`${DOMAIN_PREFIX}${value}`).digest('hex');
}
