import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { loggerRedaction } from '../src/logger.js';

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
});
