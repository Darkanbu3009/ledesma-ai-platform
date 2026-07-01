import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { loggerRedaction, sanitizeLoggedUrl, loggerSerializers } from '../src/logger.js';

describe('logging redaction', () => {
  it('censura la cabecera authorization', () => {
    const lines: string[] = [];
    const logger = pino({ redact: loggerRedaction }, { write: (line: string) => lines.push(line) });
    logger.info({ req: { headers: { authorization: 'Bearer super-secret-key' } } }, 'request');
    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('super-secret-key');
  });

  it('censura una api key en el cuerpo', () => {
    const lines: string[] = [];
    const logger = pino({ redact: loggerRedaction }, { write: (line: string) => lines.push(line) });
    logger.info({ req: { body: { apiKey: 'sk-secret-123' } } }, 'request');
    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('sk-secret-123');
  });

  it('censura el header x-trigger-token', () => {
    const lines: string[] = [];
    const logger = pino({ redact: loggerRedaction }, { write: (line: string) => lines.push(line) });
    logger.info({ req: { headers: { 'x-trigger-token': 'tok-super-secreto-abc' } } }, 'request');
    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('tok-super-secreto-abc');
  });
});

describe('sanitizeLoggedUrl: el token del webhook entrante no se filtra en logs', () => {
  it('redacta el query param token conservando el resto', () => {
    const out = sanitizeLoggedUrl('/webhooks/triggers/abc?token=SECRETO-123&foo=bar');
    expect(out).not.toContain('SECRETO-123');
    expect(out).toContain('token=%5BREDACTED%5D'); // URLSearchParams url-encodea el censor
    expect(out).toContain('foo=bar');
  });

  it('deja la url intacta si no hay token', () => {
    expect(sanitizeLoggedUrl('/v1/triggers')).toBe('/v1/triggers');
    expect(sanitizeLoggedUrl('/webhooks/triggers/abc?foo=bar')).toBe('/webhooks/triggers/abc?foo=bar');
  });

  it('tolera un req sin url (logs manuales)', () => {
    expect(sanitizeLoggedUrl(undefined as unknown as string)).toBeUndefined();
  });

  it('el serializer req pasa la url por el saneador y NO incluye headers', () => {
    const serialized = loggerSerializers.req({
      method: 'POST',
      url: '/webhooks/triggers/abc?token=SECRETO-xyz',
      hostname: 'api.example.com',
      ip: '1.2.3.4',
      socket: { remotePort: 443 },
    });
    expect(JSON.stringify(serialized)).not.toContain('SECRETO-xyz');
    expect(serialized).not.toHaveProperty('headers');
    expect(serialized.method).toBe('POST');
  });
});
