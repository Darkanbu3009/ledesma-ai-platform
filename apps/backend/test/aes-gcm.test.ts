import { describe, it, expect } from 'vitest';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { encryptToToken, decryptFromToken, deriveKey } from '../src/crypto/aes-gcm.js';
import { createSessionToken, verifySessionToken } from '../src/auth/session-token.js';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_SECRET = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const AGENT_ID = '0b9f2c4e-5a1d-4f3b-9c8e-7d6a5b4c3f2e';
const KEY = 'sk-proveedor-secreta-roundtrip-77';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Reproduce EXACTAMENTE el esquema cripto original del session-token (codigo "viejo"), sin pasar
 * por el modulo nuevo: clave SHA-256(secret), iv = randomBytes(12), tag GCM(16) y empaquetado
 * base64url(iv | tag | ciphertext). Sirve para probar compatibilidad byte-por-byte: lo que cifra
 * el codigo viejo lo descifra el modulo nuevo y viceversa.
 */
function legacyEncrypt(plaintext: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/** Descifrado del esquema original (codigo "viejo"), igual que la inversa de legacyEncrypt. */
function legacyDecrypt(token: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const raw = Buffer.from(token, 'base64url');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

describe('crypto/aes-gcm', () => {
  describe('deriveKey', () => {
    it('deriva 32 bytes deterministas (clave aes-256) del secreto', () => {
      const k1 = deriveKey(SECRET);
      const k2 = deriveKey(SECRET);
      expect(k1).toHaveLength(32);
      expect(k1.equals(k2)).toBe(true);
      // Es exactamente SHA-256(secret): unica fuente de derivacion, sin sal ni iteraciones.
      expect(k1.equals(createHash('sha256').update(SECRET).digest())).toBe(true);
    });

    it('secretos distintos derivan claves distintas', () => {
      expect(deriveKey(SECRET).equals(deriveKey(OTHER_SECRET))).toBe(false);
    });
  });

  describe('encryptToToken / decryptFromToken roundtrip', () => {
    it.each([
      ['cadena vacia', ''],
      ['ascii corto', 'hola mundo'],
      ['json del payload', JSON.stringify({ a: AGENT_ID, k: KEY, e: 1893456000 })],
      ['unicode y emojis', 'cañón ﬂ 漢字 🔐🚀 — ünïcödé'],
      ['cadena larga', 'x'.repeat(100_000)],
    ])('recupera identico el plaintext: %s', (_label, plaintext) => {
      const token = encryptToToken(plaintext, SECRET);
      expect(decryptFromToken(token, SECRET)).toBe(plaintext);
    });

    it('el iv aleatorio hace que el mismo plaintext produzca tokens distintos, ambos descifrables', () => {
      const a = encryptToToken('mismo-mensaje', SECRET);
      const b = encryptToToken('mismo-mensaje', SECRET);
      expect(a).not.toBe(b);
      expect(decryptFromToken(a, SECRET)).toBe('mismo-mensaje');
      expect(decryptFromToken(b, SECRET)).toBe('mismo-mensaje');
    });

    it('el formato de bytes es base64url(iv[12] | tag[16] | ciphertext) con ciphertext del largo del plaintext', () => {
      const plaintext = 'hola'; // 4 bytes utf8; GCM no agrega padding al ciphertext
      const raw = Buffer.from(encryptToToken(plaintext, SECRET), 'base64url');
      expect(raw).toHaveLength(IV_LENGTH + AUTH_TAG_LENGTH + Buffer.byteLength(plaintext, 'utf8'));
    });
  });

  describe('decryptFromToken: fallos claros y sin fuga', () => {
    const FIXED_MESSAGE = 'Failed to decrypt: invalid token or secret';

    it('secreto incorrecto lanza un error claro y uniforme (no expone el secreto)', () => {
      const token = encryptToToken(KEY, SECRET);
      expect(() => decryptFromToken(token, OTHER_SECRET)).toThrow(FIXED_MESSAGE);
      try {
        decryptFromToken(token, OTHER_SECRET);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(SECRET);
        expect(message).not.toContain(OTHER_SECRET);
        expect(message).not.toContain(KEY);
      }
    });

    it('token manipulado (tag invalido) lanza el mismo error', () => {
      const token = encryptToToken(KEY, SECRET);
      const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
      expect(() => decryptFromToken(tampered, SECRET)).toThrow(FIXED_MESSAGE);
    });

    it('token truncado lanza el mismo error', () => {
      const token = encryptToToken(KEY, SECRET);
      expect(() => decryptFromToken(token.slice(0, 8), SECRET)).toThrow(FIXED_MESSAGE);
    });

    it('token vacio lanza el mismo error', () => {
      expect(() => decryptFromToken('', SECRET)).toThrow(FIXED_MESSAGE);
    });

    it('basura que no es base64url valido lanza el mismo error', () => {
      expect(() => decryptFromToken('@@@no-es-un-token@@@', SECRET)).toThrow(FIXED_MESSAGE);
    });
  });

  describe('compatibilidad byte-por-byte (codigo viejo <-> modulo nuevo)', () => {
    it('un token del esquema VIEJO se descifra con el modulo NUEVO', () => {
      const message = JSON.stringify({ a: AGENT_ID, k: KEY, e: 1893456000 });
      const legacyToken = legacyEncrypt(message, SECRET);
      expect(decryptFromToken(legacyToken, SECRET)).toBe(message);
    });

    it('un token del modulo NUEVO se descifra con el esquema VIEJO', () => {
      const message = JSON.stringify({ a: AGENT_ID, k: KEY, e: 1893456000 });
      const newToken = encryptToToken(message, SECRET);
      expect(legacyDecrypt(newToken, SECRET)).toBe(message);
    });
  });

  describe('cruce con el session-token (ambos caminos)', () => {
    it('un token de createSessionToken se descifra con decryptFromToken al payload {a,k,e}', () => {
      const { token } = createSessionToken({ agentId: AGENT_ID, providerKey: KEY }, SECRET);
      const payload = JSON.parse(decryptFromToken(token, SECRET)) as { a: string; k: string; e: number };
      expect(payload.a).toBe(AGENT_ID);
      expect(payload.k).toBe(KEY);
      expect(typeof payload.e).toBe('number');
    });

    it('un token cifrado con encryptToToken sobre el payload del session-token es verificable por verifySessionToken', () => {
      const exp = Math.floor(Date.now() / 1000) + 900;
      const token = encryptToToken(JSON.stringify({ a: AGENT_ID, k: KEY, e: exp }), SECRET);
      expect(verifySessionToken(token, AGENT_ID, SECRET)).toEqual({ providerKey: KEY });
    });
  });
});
