import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyWebhookSignature } from '../tools/webhook-signature.js';

/**
 * Primitivas de AUTENTICACION de los TRIGGERS ENTRANTES (Fase 5.4). El endpoint entrante es PUBLICO
 * (sin JWT): la unica barrera contra que cualquiera queme credenciales de clientes es autenticar el
 * evento. Este modulo concentra la generacion de secretos impredecibles y la verificacion, SIEMPRE en
 * tiempo constante (timingSafeEqual, nunca ===): un secreto/token comparado con == filtra por timing
 * cuantos caracteres coinciden.
 *
 * Dos mecanismos (uno por trigger, ver V012.auth_mode):
 *   - hmac:      el cliente firma "{timestamp}.{rawBody}" con HMAC-SHA256 (reusa verifyWebhookSignature,
 *                con ventana anti-replay). El secreto se guarda CIFRADO (AES-256-GCM / VAULT_SECRET).
 *   - url_token: un token impredecible viaja en la URL/header; se guarda solo su SHA-256 (hash), y el
 *                entrante compara hash(presentado) contra el guardado en tiempo constante.
 */

/** Header con el timestamp Unix (segundos) que el cliente firmo. Reusa el esquema de webhook-signature. */
export const HMAC_TIMESTAMP_HEADER = 'x-ledesma-timestamp';
/** Header con la firma HMAC-SHA256 en hex de "{timestamp}.{rawBody}". */
export const HMAC_SIGNATURE_HEADER = 'x-ledesma-signature';
/** Header alternativo para el url_token (ademas del query param ?token=). */
export const URL_TOKEN_HEADER = 'x-trigger-token';

/** Bytes de entropia de los secretos generados: 32 bytes = 256 bits, holgado contra fuerza bruta. */
const SECRET_BYTES = 32;

/**
 * Genera un secreto HMAC impredecible (hex de 32 bytes = 64 chars). Se DEVUELVE al usuario una sola vez
 * al crear/rotar y se persiste CIFRADO (nunca en claro). El cliente lo usa como clave para firmar.
 */
export function generateHmacSecret(): string {
  return randomBytes(SECRET_BYTES).toString('hex');
}

/**
 * Genera un url_token impredecible en base64url (URL-safe, ~43 chars) para que viaje limpio en la query
 * string del webhook. Se DEVUELVE una sola vez; se persiste solo su hash (ver hashUrlToken).
 */
export function generateUrlToken(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/**
 * SHA-256 (hex) de un url_token. Lo que se PERSISTE de un trigger 'url_token': si la base se filtra, el
 * hash no permite reconstruir el token ni firmar. Determinista: el entrante hashea el token presentado
 * y lo compara contra este valor.
 */
export function hashUrlToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparacion en TIEMPO CONSTANTE de dos cadenas hex de igual longitud (p.ej. dos SHA-256). Convierte a
 * Buffer y usa timingSafeEqual; el chequeo de longitud PREVIO evita que timingSafeEqual lance con
 * buffers de distinto tamano (y no filtra timing: la longitud de un hash es publica y fija).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/**
 * Verifica el token presentado (query o header) de un trigger 'url_token' contra el hash guardado, en
 * tiempo constante. Hashea el token presentado y compara SHA-256 vs SHA-256 (siempre 32 bytes, sin fuga
 * de longitud). Un token ausente/vacio -> hash de '' -> no coincide (false), sin ramas early-return que
 * distingan "ausente" de "incorrecto".
 */
export function verifyUrlToken(presentedToken: string | undefined | null, storedHash: string): boolean {
  const presented = typeof presentedToken === 'string' ? presentedToken : '';
  return timingSafeEqualHex(hashUrlToken(presented), storedHash);
}

export interface VerifyHmacParams {
  /** Cuerpo crudo tal cual llego (string), SIN parsear: la firma se calcula sobre estos bytes exactos. */
  rawBody: string;
  /** Valor del header de timestamp (Unix en segundos). string | string[] | undefined como llega de Fastify. */
  timestampHeader: string | string[] | undefined;
  /** Valor del header de firma (hex). string | string[] | undefined como llega de Fastify. */
  signatureHeader: string | string[] | undefined;
  /** Secreto HMAC YA descifrado (claro) del trigger. */
  secret: string;
  /** Ventana anti-replay en segundos (default 300, igual que verifyWebhookSignature). */
  toleranceSeconds?: number;
  /** Inyectable en tests para determinismo; default = ahora. */
  nowSeconds?: number;
}

/**
 * Autentica un POST entrante 'hmac': valida presencia y forma de los headers, y delega la verificacion
 * criptografica (HMAC-SHA256 en tiempo constante + ventana anti-replay) a verifyWebhookSignature. Un
 * header ausente/repetido/no numerico -> false (no lanza): el llamador responde 401 uniforme.
 */
export function verifyIncomingHmac(params: VerifyHmacParams): boolean {
  const { rawBody, timestampHeader, signatureHeader, secret } = params;
  if (typeof timestampHeader !== 'string' || typeof signatureHeader !== 'string') {
    return false;
  }
  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  // Acepta el mismo esquema que la firma SALIENTE de la plataforma (signed-tool-fetch: "v1=<hex>") y
  // tambien el hex a secas, para no forzar al integrador a un formato u otro.
  const signature = signatureHeader.startsWith('v1=') ? signatureHeader.slice(3) : signatureHeader;
  const tolerance = params.toleranceSeconds ?? 300;
  return params.nowSeconds === undefined
    ? verifyWebhookSignature(rawBody, timestampSeconds, signature, secret, tolerance)
    : verifyWebhookSignature(rawBody, timestampSeconds, signature, secret, tolerance, params.nowSeconds);
}
