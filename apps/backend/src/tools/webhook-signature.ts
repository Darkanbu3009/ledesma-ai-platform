import { createHmac, timingSafeEqual } from 'node:crypto';

/** Firma HMAC-SHA256 de "{timestamp}.{body}" con el secreto del agente. */
export function signWebhookPayload(body: string, timestampSeconds: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

/** Verificacion (de referencia para docs y tests; el cliente implementa su equivalente). */
export function verifyWebhookSignature(
  body: string,
  timestampSeconds: number,
  signatureHex: string,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;
  const expected = signWebhookPayload(body, timestampSeconds, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
