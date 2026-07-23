import { describe, it, expect } from 'vitest';
import {
  mintRelayToken,
  verifyRelayToken,
  constantTimeEqualHex,
  RELAY_TOKEN_TTL_SECONDS,
} from '../src/relay/relay-token.js';

const SECRET = 'x'.repeat(48); // >= 32, como en produccion
const OTHER_SECRET = 'y'.repeat(48);

describe('token del relay: acunar y verificar', () => {
  it('un token recien acunado verifica y devuelve la terna ligada', () => {
    const { token, jti } = mintRelayToken(
      { ownerId: 'own_1', connectionId: 'con_1', sesionExternaId: 'ses_1' },
      SECRET,
    );
    const claims = verifyRelayToken(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.ownerId).toBe('own_1');
    expect(claims?.connectionId).toBe('con_1');
    expect(claims?.sesionExternaId).toBe('ses_1');
    expect(claims?.jti).toBe(jti);
  });

  it('cada token trae un jti distinto (uso unico posible)', () => {
    const a = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET);
    const b = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET);
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });

  it('un token con otro secreto NO verifica (devuelve null, sin oraculo)', () => {
    const { token } = mintRelayToken(
      { ownerId: 'o', connectionId: 'c', sesionExternaId: 's' },
      SECRET,
    );
    expect(verifyRelayToken(token, OTHER_SECRET)).toBeNull();
  });

  it('un token manipulado NO verifica (tag GCM)', () => {
    const { token } = mintRelayToken(
      { ownerId: 'o', connectionId: 'c', sesionExternaId: 's' },
      SECRET,
    );
    const bytes = Buffer.from(token, 'base64url');
    const ultimo = bytes.length - 1;
    bytes[ultimo] = (bytes[ultimo] ?? 0) ^ 0x01; // flip de un bit del ciphertext
    expect(verifyRelayToken(bytes.toString('base64url'), SECRET)).toBeNull();
  });

  it('un token expirado NO verifica', () => {
    const now = 1_000_000;
    const { token } = mintRelayToken(
      { ownerId: 'o', connectionId: 'c', sesionExternaId: 's', ttlSeconds: 60, nowSeconds: now },
      SECRET,
    );
    expect(verifyRelayToken(token, SECRET, now + 61)).toBeNull();
    expect(verifyRelayToken(token, SECRET, now + 59)).not.toBeNull();
  });

  it('el TTL se acota al maximo de la especificacion (15 min)', () => {
    const now = 1_000_000;
    const { expiresAt } = mintRelayToken(
      { ownerId: 'o', connectionId: 'c', sesionExternaId: 's', ttlSeconds: 9999, nowSeconds: now },
      SECRET,
    );
    const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
    expect(exp).toBe(now + RELAY_TOKEN_TTL_SECONDS);
  });

  it('basura no verifica y no truena', () => {
    expect(verifyRelayToken('no-es-un-token', SECRET)).toBeNull();
    expect(verifyRelayToken('', SECRET)).toBeNull();
  });
});

describe('constantTimeEqualHex', () => {
  it('cadenas hex iguales coinciden; distintas o de otra longitud no', () => {
    expect(constantTimeEqualHex('abcdef', 'abcdef')).toBe(true);
    expect(constantTimeEqualHex('abcdef', 'abcde0')).toBe(false);
    expect(constantTimeEqualHex('abcd', 'abcdef')).toBe(false);
    expect(constantTimeEqualHex('', '')).toBe(false);
  });
});
