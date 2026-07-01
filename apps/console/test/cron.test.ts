import { describe, expect, it } from 'vitest';
import { isValidCronExpression, nextCronRun } from '../src/lib/cron';

describe('isValidCronExpression', () => {
  it('acepta expresiones estandar de 5 campos', () => {
    expect(isValidCronExpression('0 8 * * *')).toBe(true);
    expect(isValidCronExpression('30 * * * *')).toBe(true);
    expect(isValidCronExpression('0 8 * * 1')).toBe(true);
    expect(isValidCronExpression('0 8 15 * *')).toBe(true);
    expect(isValidCronExpression('*/15 * * * *')).toBe(true);
    expect(isValidCronExpression('0 9-17 * * 1-5')).toBe(true);
    expect(isValidCronExpression('0 0 * * 0,6')).toBe(true);
  });

  it('rechaza formatos malformados o fuera de rango', () => {
    expect(isValidCronExpression('')).toBe(false);
    expect(isValidCronExpression('0 8 * *')).toBe(false); // 4 campos
    expect(isValidCronExpression('0 8 * * * *')).toBe(false); // 6 campos
    expect(isValidCronExpression('60 8 * * *')).toBe(false); // minuto fuera de rango
    expect(isValidCronExpression('0 24 * * *')).toBe(false); // hora fuera de rango
    expect(isValidCronExpression('0 8 * * 8')).toBe(false); // dow fuera de rango (max 7)
    expect(isValidCronExpression('0 8 * * MON')).toBe(false); // nombres no soportados
    expect(isValidCronExpression('a b c d e')).toBe(false);
  });
});

describe('nextCronRun', () => {
  it('calcula el proximo run estrictamente posterior a `from` (UTC)', () => {
    // Miercoles 1 de julio de 2026, 06:00 UTC.
    const from = new Date('2026-07-01T06:00:00.000Z');
    const next = nextCronRun('0 8 * * *', from);
    expect(next?.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('salta al dia siguiente si la hora de hoy ya paso', () => {
    const from = new Date('2026-07-01T09:00:00.000Z');
    const next = nextCronRun('0 8 * * *', from);
    expect(next?.toISOString()).toBe('2026-07-02T08:00:00.000Z');
  });

  it('respeta el dia de la semana (weekly)', () => {
    // 1 de julio de 2026 es miercoles; el proximo lunes (dow=1) es el 6 de julio.
    const from = new Date('2026-07-01T00:00:00.000Z');
    const next = nextCronRun('0 8 * * 1', from);
    expect(next?.toISOString()).toBe('2026-07-06T08:00:00.000Z');
  });

  it('avanza al minuto siguiente cuando se lo llama justo en el match', () => {
    const from = new Date('2026-07-01T08:00:00.000Z');
    const next = nextCronRun('0 8 * * *', from);
    expect(next?.toISOString()).toBe('2026-07-02T08:00:00.000Z');
  });

  it('devuelve null para un cron imposible (30 de febrero)', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    expect(nextCronRun('0 0 30 2 *', from)).toBeNull();
  });
});
