import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * TOKEN EFIMERO del RELAY DE TECLADO MOVIL (conocimiento minimo). Es el UNICO acoplamiento entre el
 * backend (que ACUNA el token, autenticado) y el servicio relay minimo (apps/relay, que lo VERIFICA):
 * un token stateless, cifrado, ligado a (owner_id, connection_id, sesion_externa_id) con expiracion
 * corta y un jti para uso unico. Vive en este paquete compartido -- y NO en el backend -- a proposito:
 * el servicio relay tiene superficie minima y NO debe depender del paquete backend entero (Fastify,
 * SDKs de modelo, boveda). Aca solo hay node:crypto.
 *
 * ESTO NO ES CIFRADO EXTREMO A EXTREMO: es la credencial de un solo uso que abre el canal del relay.
 * El texto plano de las pulsaciones jamas pasa por este modulo.
 *
 * Esquema AES-256-GCM byte-por-byte identico al de la boveda (apps/backend/src/crypto/aes-gcm.ts):
 * clave = sha256(secreto), salida base64url(iv[12] | authTag[16] | ciphertext). Se replica el esquema
 * (no se importa) para no acoplar el relay al backend; es el MISMO node:crypto, no una primitiva propia.
 * El backend acuna con el patron de session-token.ts (payload cifrado con expiracion), aca reproducido.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM: nonce de 96 bits
const AUTH_TAG_LENGTH = 16; // tag GCM estandar
const IV_END = IV_LENGTH;
const TAG_END = IV_LENGTH + AUTH_TAG_LENGTH;

/** Bytes de entropia del jti (128 bits): impredecible, holgado contra colision/fuerza bruta. */
const JTI_BYTES = 16;

/**
 * TTL del token (segundos). ALINEADO al timeout de esperando_login: la sesion de login del proveedor
 * caduca a los 15 min (SESSION_TIMEOUT_SECONDS del worker) y el barrido la cierra a los 10, asi que el
 * token nunca sobrevive util mas alla de la sesion a la que apunta. 15 min es el techo de la
 * especificacion. Coincide con SESSION_TOKEN_LIMITS.defaultTtlSeconds del backend (mismo patron).
 */
export const RELAY_TOKEN_TTL_SECONDS = 900;

/** Payload cifrado. Claves cortas para un token compacto (mismo criterio que session-token.ts). */
interface RelayTokenPayload {
  o: string; // owner_id (sub del JWT) dueno de la conexion
  c: string; // connection_id (id de la fila sitios_conectados)
  s: string; // sesion_externa_id (id de la sesion de navegador viva en el proveedor)
  e: number; // expiracion epoch segundos
  j: string; // jti: identificador de un solo uso (anti reuso del token)
}

/** Reclamos ya validados de un token del relay. */
export interface RelayTokenClaims {
  ownerId: string;
  connectionId: string;
  sesionExternaId: string;
  jti: string;
  /** Expiracion epoch segundos (para acotar la vida del canal y la retencion del jti consumido). */
  exp: number;
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest(); // 32 bytes para aes-256-gcm
}

function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

function decrypt(token: string, secret: string): string {
  const raw = Buffer.from(token, 'base64url');
  const iv = raw.subarray(0, IV_END);
  const tag = raw.subarray(IV_END, TAG_END);
  const ciphertext = raw.subarray(TAG_END);
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * ACUNA (backend) un token del relay ligado a la terna (owner, connection, sesion), con expiracion
 * corta y un jti impredecible de un solo uso. El jti se DEVUELVE para que el emisor lo audite si
 * quiere (metadato, jamas contenido). El token es la unica credencial que el cliente presenta al relay.
 */
export function mintRelayToken(
  params: {
    ownerId: string;
    connectionId: string;
    sesionExternaId: string;
    ttlSeconds?: number;
    /** Inyectable en tests para determinismo; default = ahora. */
    nowSeconds?: number;
  },
  secret: string,
): { token: string; jti: string; expiresAt: string } {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(params.ttlSeconds ?? RELAY_TOKEN_TTL_SECONDS, RELAY_TOKEN_TTL_SECONDS);
  const exp = now + ttl;
  const jti = randomBytes(JTI_BYTES).toString('hex');
  const payload: RelayTokenPayload = {
    o: params.ownerId,
    c: params.connectionId,
    s: params.sesionExternaId,
    e: exp,
    j: jti,
  };
  const token = encrypt(JSON.stringify(payload), secret);
  return { token, jti, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * VERIFICA (relay) un token. Devuelve los reclamos si el token descifra, autentica (tag GCM) y no
 * expiro; devuelve null ante CUALQUIER fallo (corrupto, secreto incorrecto, expirado, forma invalida)
 * sin distinguir el modo (evita un oraculo) ni filtrar detalle. El uso UNICO (jti no consumido) y el
 * alcance (owner de la conexion) los aplica el llamador; este modulo solo prueba autenticidad y vigencia.
 */
export function verifyRelayToken(
  token: string,
  secret: string,
  nowSeconds?: number,
): RelayTokenClaims | null {
  try {
    const payload = JSON.parse(decrypt(token, secret)) as RelayTokenPayload;
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (
      typeof payload.o !== 'string' ||
      typeof payload.c !== 'string' ||
      typeof payload.s !== 'string' ||
      typeof payload.j !== 'string' ||
      typeof payload.e !== 'number' ||
      payload.e <= now
    ) {
      return null;
    }
    return {
      ownerId: payload.o,
      connectionId: payload.c,
      sesionExternaId: payload.s,
      jti: payload.j,
      exp: payload.e,
    };
  } catch {
    return null;
  }
}

/**
 * Comparacion en TIEMPO CONSTANTE de dos cadenas hex de igual longitud (espejo de
 * trigger-auth.timingSafeEqualHex). El chequeo de longitud previo evita que timingSafeEqual lance con
 * buffers de distinto tamano y no filtra timing (la longitud es publica). Disponible para cualquier
 * cotejo de identificadores del canal; la autenticidad del token en si la garantiza el tag GCM.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}
