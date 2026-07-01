import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  generateHmacSecret,
  generateUrlToken,
  hashUrlToken,
  timingSafeEqualHex,
  verifyUrlToken,
  verifyIncomingHmac,
  HMAC_TIMESTAMP_HEADER,
  HMAC_SIGNATURE_HEADER,
} from '../src/triggers/trigger-auth.js';
import { signWebhookPayload } from '../src/tools/webhook-signature.js';

describe('generacion de secretos', () => {
  it('generateHmacSecret: hex de 64 chars (32 bytes) e impredecible', () => {
    const a = generateHmacSecret();
    const b = generateHmacSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b); // dos llamadas != (aleatorio)
  });

  it('generateUrlToken: base64url URL-safe (sin +/= ni /) e impredecible', () => {
    const a = generateUrlToken();
    const b = generateUrlToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes en base64url
    expect(a).not.toBe(b);
  });

  it('hashUrlToken: SHA-256 hex determinista del token', () => {
    const token = 'un-token-cualquiera';
    expect(hashUrlToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashUrlToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('timingSafeEqualHex', () => {
  it('true para hex iguales', () => {
    const h = hashUrlToken('x');
    expect(timingSafeEqualHex(h, h)).toBe(true);
  });
  it('false para hex distintos de igual longitud', () => {
    expect(timingSafeEqualHex(hashUrlToken('a'), hashUrlToken('b'))).toBe(false);
  });
  it('false (sin lanzar) para longitudes distintas', () => {
    expect(timingSafeEqualHex('00', hashUrlToken('a'))).toBe(false);
  });
  it('false para vacios (no compara buffers de longitud 0)', () => {
    expect(timingSafeEqualHex('', '')).toBe(false);
  });
});

describe('verifyUrlToken', () => {
  const token = generateUrlToken();
  const stored = hashUrlToken(token);

  it('true con el token correcto', () => {
    expect(verifyUrlToken(token, stored)).toBe(true);
  });
  it('false con token incorrecto', () => {
    expect(verifyUrlToken(generateUrlToken(), stored)).toBe(false);
  });
  it('false con token ausente (undefined/null/"")', () => {
    expect(verifyUrlToken(undefined, stored)).toBe(false);
    expect(verifyUrlToken(null, stored)).toBe(false);
    expect(verifyUrlToken('', stored)).toBe(false);
  });
});

describe('verifyIncomingHmac', () => {
  const secret = generateHmacSecret();
  const body = '{"evento":"pago","monto":100}';
  const now = 1_700_000_000;
  const sig = signWebhookPayload(body, now, secret);

  it('true con firma valida y timestamp dentro de la ventana', () => {
    expect(
      verifyIncomingHmac({
        rawBody: body,
        timestampHeader: String(now),
        signatureHeader: sig,
        secret,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('acepta la firma con prefijo "v1=" (mismo esquema que la saliente)', () => {
    expect(
      verifyIncomingHmac({
        rawBody: body,
        timestampHeader: String(now),
        signatureHeader: `v1=${sig}`,
        secret,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('false con firma invalida', () => {
    expect(
      verifyIncomingHmac({
        rawBody: body,
        timestampHeader: String(now),
        signatureHeader: 'deadbeef'.repeat(8),
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('false si el body cambio (la firma ya no corresponde)', () => {
    expect(
      verifyIncomingHmac({
        rawBody: body + ' ',
        timestampHeader: String(now),
        signatureHeader: sig,
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('false por replay: timestamp fuera de la ventana anti-replay (300s)', () => {
    expect(
      verifyIncomingHmac({
        rawBody: body,
        timestampHeader: String(now),
        signatureHeader: sig,
        secret,
        nowSeconds: now + 301, // 301s despues -> replay
      }),
    ).toBe(false);
  });

  it('false con headers ausentes o no numericos', () => {
    expect(verifyIncomingHmac({ rawBody: body, timestampHeader: undefined, signatureHeader: sig, secret, nowSeconds: now })).toBe(false);
    expect(verifyIncomingHmac({ rawBody: body, timestampHeader: String(now), signatureHeader: undefined, secret, nowSeconds: now })).toBe(false);
    expect(verifyIncomingHmac({ rawBody: body, timestampHeader: 'no-num', signatureHeader: sig, secret, nowSeconds: now })).toBe(false);
    // header repetido (array) -> false
    expect(verifyIncomingHmac({ rawBody: body, timestampHeader: [String(now)], signatureHeader: sig, secret, nowSeconds: now })).toBe(false);
  });

  it('los nombres de header exportados son los esperados', () => {
    expect(HMAC_TIMESTAMP_HEADER).toBe('x-ledesma-timestamp');
    expect(HMAC_SIGNATURE_HEADER).toBe('x-ledesma-signature');
  });
});

describe('comparaciones en tiempo constante (verificacion estructural)', () => {
  const authSource = readFileSync(fileURLToPath(new URL('../src/triggers/trigger-auth.ts', import.meta.url)), 'utf8');
  const sigSource = readFileSync(fileURLToPath(new URL('../src/tools/webhook-signature.ts', import.meta.url)), 'utf8');

  it('trigger-auth: el material de auth se compara con timingSafeEqual, no con ==', () => {
    expect(authSource).toContain('timingSafeEqual');
    // El url_token se verifica DELEGANDO en timingSafeEqualHex (no compara strings directamente).
    expect(authSource).toMatch(/verifyUrlToken[\s\S]*?timingSafeEqualHex/);
    // timingSafeEqualHex usa el primitivo de tiempo constante sobre Buffers.
    expect(authSource).toMatch(/timingSafeEqualHex[\s\S]*?timingSafeEqual\(/);
    // NUNCA se compara el hash del token con igualdad de strings (==, ===, !=, !==): esa es la
    // comparacion sensible al timing. Los unicos === del modulo son type-guards (typeof x === 'string')
    // y la comparacion de LONGITUD de buffers (publica), nunca del contenido del secreto.
    expect(authSource).not.toMatch(/\b(storedHash|urlTokenHash)\b\s*[!=]==/);
    expect(authSource).not.toMatch(/[!=]==\s*\b(storedHash|urlTokenHash)\b/);
  });

  it('webhook-signature (reusado para HMAC de entrada) compara la firma con timingSafeEqual', () => {
    expect(sigSource).toContain('timingSafeEqual');
    expect(sigSource).not.toMatch(/signatureHex\s*[!=]==/);
  });
});
