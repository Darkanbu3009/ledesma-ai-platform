import { AppError } from '../errors/app-error.js';
import { encryptToToken, decryptFromToken } from '../crypto/aes-gcm.js';

export const SESSION_TOKEN_LIMITS = { defaultTtlSeconds: 900, maxTtlSeconds: 3600 } as const;

/** Payload cifrado del token. Claves cortas para mantener el token compacto. */
interface SessionTokenPayload {
  a: string; // agentId al que queda atado el token
  k: string; // provider key (viaja cifrada dentro del token, jamas se almacena)
  e: number; // expiracion en epoch segundos
}

/**
 * Emite un token efimero stateless: la provider key del integrador viaja cifrada DENTRO del
 * token (AES-256-GCM, via el modulo cripto generico) y la plataforma no persiste nada. La
 * expiracion corta es la mitigacion ante fuga del token; no hay revocacion. El formato de bytes
 * del token lo define el modulo cripto (iv | tag | ciphertext, base64url, clave SHA-256).
 */
export function createSessionToken(
  params: { agentId: string; providerKey: string; ttlSeconds?: number },
  secret: string,
): { token: string; expiresAt: string } {
  const ttl = Math.min(params.ttlSeconds ?? SESSION_TOKEN_LIMITS.defaultTtlSeconds, SESSION_TOKEN_LIMITS.maxTtlSeconds);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload: SessionTokenPayload = { a: params.agentId, k: params.providerKey, e: exp };
  const token = encryptToToken(JSON.stringify(payload), secret);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Descifra y valida. Lanza AppError('AUTHENTICATION', 401, ...) generica en CUALQUIER fallo
 * (token corrupto, expirado o de otro agente) sin filtrar detalles ni contenido. */
export function verifySessionToken(token: string, agentId: string, secret: string): { providerKey: string } {
  try {
    const payload = JSON.parse(decryptFromToken(token, secret)) as SessionTokenPayload;
    if (typeof payload.k !== 'string' || payload.a !== agentId || payload.e <= Math.floor(Date.now() / 1000)) {
      throw new Error('invalid');
    }
    return { providerKey: payload.k };
  } catch {
    throw new AppError('AUTHENTICATION', 401, 'Invalid or expired session token');
  }
}
