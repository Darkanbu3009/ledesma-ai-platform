import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../errors/app-error.js';

export const SESSION_TOKEN_LIMITS = { defaultTtlSeconds: 900, maxTtlSeconds: 3600 } as const;

/** Payload cifrado del token. Claves cortas para mantener el token compacto. */
interface SessionTokenPayload {
  a: string; // agentId al que queda atado el token
  k: string; // provider key (viaja cifrada dentro del token, jamas se almacena)
  e: number; // expiracion en epoch segundos
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest(); // 32 bytes para aes-256-gcm
}

/**
 * Emite un token efimero stateless: la provider key del integrador viaja cifrada DENTRO del
 * token (AES-256-GCM) y la plataforma no persiste nada. La expiracion corta es la mitigacion
 * ante fuga del token; no hay revocacion.
 */
export function createSessionToken(
  params: { agentId: string; providerKey: string; ttlSeconds?: number },
  secret: string,
): { token: string; expiresAt: string } {
  const ttl = Math.min(params.ttlSeconds ?? SESSION_TOKEN_LIMITS.defaultTtlSeconds, SESSION_TOKEN_LIMITS.maxTtlSeconds);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload: SessionTokenPayload = { a: params.agentId, k: params.providerKey, e: exp };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const token = Buffer.concat([iv, tag, ciphertext]).toString('base64url');
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Descifra y valida. Lanza AppError('AUTHENTICATION', 401, ...) generica en CUALQUIER fallo
 * (token corrupto, expirado o de otro agente) sin filtrar detalles ni contenido. */
export function verifySessionToken(token: string, agentId: string, secret: string): { providerKey: string } {
  try {
    const raw = Buffer.from(token, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    ) as SessionTokenPayload;
    if (typeof payload.k !== 'string' || payload.a !== agentId || payload.e <= Math.floor(Date.now() / 1000)) {
      throw new Error('invalid');
    }
    return { providerKey: payload.k };
  } catch {
    throw new AppError('AUTHENTICATION', 401, 'Invalid or expired session token');
  }
}
