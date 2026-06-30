import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado simetrico generico AES-256-GCM sobre cadenas arbitrarias. Este modulo NO conoce el
 * dominio (session-token, futura boveda de credenciales, etc.): solo cifra y descifra strings.
 *
 * La clave de 32 bytes se deriva del secreto via SHA-256, identico al esquema original del
 * session-token, para mantener compatibilidad byte-por-byte: un token emitido por el codigo
 * viejo se descifra con este modulo y viceversa.
 *
 * Formato del token de salida: base64url( iv[12] | authTag[16] | ciphertext ).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recomienda un nonce de 96 bits
const AUTH_TAG_LENGTH = 16; // tag de autenticacion GCM estandar
const IV_END = IV_LENGTH; // fin del iv dentro del buffer empaquetado (12)
const TAG_END = IV_LENGTH + AUTH_TAG_LENGTH; // fin del tag; inicio del ciphertext (28)

/** Deriva la clave AES-256 (32 bytes) del secreto. UNICA fuente de derivacion de clave. */
export function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest(); // 32 bytes para aes-256-gcm
}

/**
 * Cifra una cadena arbitraria. El iv es aleatorio por llamada (mismo plaintext produce salidas
 * distintas) y el auth tag GCM protege la integridad. La salida empaqueta iv | tag | ciphertext
 * en base64url y siempre se descifra con decryptFromToken usando el mismo secreto.
 */
export function encryptToToken(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * Operacion inversa de encryptToToken: parsea iv[0:12] | tag[12:28] | ciphertext[28:], verifica
 * el auth tag y devuelve el plaintext. Ante CUALQUIER fallo (formato invalido, token truncado,
 * tag que no autentica, secreto incorrecto) lanza un Error generico y uniforme: no distingue el
 * modo de fallo (evita un oraculo) ni expone el secreto ni el contenido descifrado.
 */
export function decryptFromToken(token: string, secret: string): string {
  try {
    const raw = Buffer.from(token, 'base64url');
    const iv = raw.subarray(0, IV_END);
    const tag = raw.subarray(IV_END, TAG_END);
    const ciphertext = raw.subarray(TAG_END);
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Failed to decrypt: invalid token or secret');
  }
}
