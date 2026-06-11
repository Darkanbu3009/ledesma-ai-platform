import { describe, it, expect } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature } from '../src/tools/webhook-signature.js';

const SECRET = 'whsec_secreto_de_prueba_0123456789abcdef';
const BODY = JSON.stringify({ tool: 'cotizar', input: { piezas: 2 } });
const TS = 1_750_000_000;

describe('signWebhookPayload', () => {
  it('produce un hex sha256 estable para el mismo body, timestamp y secreto', () => {
    const signature = signWebhookPayload(BODY, TS, SECRET);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signWebhookPayload(BODY, TS, SECRET)).toBe(signature);
  });

  it('cambia si cambia cualquier parte de "{timestamp}.{body}" o el secreto', () => {
    const signature = signWebhookPayload(BODY, TS, SECRET);
    expect(signWebhookPayload(`${BODY} `, TS, SECRET)).not.toBe(signature);
    expect(signWebhookPayload(BODY, TS + 1, SECRET)).not.toBe(signature);
    expect(signWebhookPayload(BODY, TS, 'whsec_otro_secreto')).not.toBe(signature);
  });
});

describe('verifyWebhookSignature', () => {
  it('roundtrip: una firma recien generada verifica true dentro de la tolerancia', () => {
    const signature = signWebhookPayload(BODY, TS, SECRET);
    expect(verifyWebhookSignature(BODY, TS, signature, SECRET, 300, TS + 10)).toBe(true);
  });

  it('body alterado -> false', () => {
    const signature = signWebhookPayload(BODY, TS, SECRET);
    const tampered = JSON.stringify({ tool: 'cotizar', input: { piezas: 999 } });
    expect(verifyWebhookSignature(tampered, TS, signature, SECRET, 300, TS)).toBe(false);
  });

  it('firma alterada -> false', () => {
    const signature = signWebhookPayload(BODY, TS, SECRET);
    const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
    expect(verifyWebhookSignature(BODY, TS, flipped, SECRET, 300, TS)).toBe(false);
  });

  it('timestamp fuera de tolerancia (nowSeconds inyectado) -> false aunque la firma sea valida', () => {
    const signature = signWebhookPayload(BODY, TS, SECRET);
    expect(verifyWebhookSignature(BODY, TS, signature, SECRET, 300, TS + 301)).toBe(false);
    expect(verifyWebhookSignature(BODY, TS, signature, SECRET, 300, TS - 301)).toBe(false);
    // En el borde exacto de la ventana sigue siendo valida.
    expect(verifyWebhookSignature(BODY, TS, signature, SECRET, 300, TS + 300)).toBe(true);
  });

  it('firmas de longitud distinta no lanzan: regresan false', () => {
    expect(verifyWebhookSignature(BODY, TS, 'abcd', SECRET, 300, TS)).toBe(false);
    expect(() => verifyWebhookSignature(BODY, TS, '', SECRET, 300, TS)).not.toThrow();
  });
});
