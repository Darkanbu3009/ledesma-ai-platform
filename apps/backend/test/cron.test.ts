import { describe, it, expect } from 'vitest';
import {
  isValidCronExpression,
  parseCronExpression,
  cronMatchesAt,
  nextCronRun,
} from '../src/scheduling/cron.js';

/** Helper: instante UTC desde componentes (mes 1-12). */
function utc(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));
}

describe('isValidCronExpression', () => {
  it.each([
    '0 8 * * *',
    '*/5 * * * *',
    '0 9 * * 1',
    '1,15,30 * * * *',
    '0 0 1-7 * 1',
    '0 0 * * 0',
    '0 0 * * 7',
    '0 0-12/2 * * *',
    '0 0 29 2 *',
    '* * * * *',
  ])('acepta cron valido: %s', (expr) => {
    expect(isValidCronExpression(expr)).toBe(true);
  });

  it.each([
    ['', 'vacio'],
    ['* * * *', '4 campos'],
    ['* * * * * *', '6 campos'],
    ['60 * * * *', 'minuto fuera de rango'],
    ['* 24 * * *', 'hora fuera de rango'],
    ['* * 0 * *', 'dia-del-mes 0'],
    ['* * 32 * *', 'dia-del-mes fuera de rango'],
    ['* * * 13 *', 'mes fuera de rango'],
    ['* * * * 8', 'dia-de-semana fuera de rango'],
    ['*/0 * * * *', 'paso 0'],
    ['JAN * * * *', 'nombre de mes no soportado'],
    ['5-1 * * * *', 'rango invertido'],
    ['a b c d e', 'no numerico'],
  ])('rechaza cron invalido (%s): %s', (expr) => {
    expect(isValidCronExpression(expr)).toBe(false);
  });
});

describe('parseCronExpression', () => {
  it('expande listas, rangos y pasos', () => {
    const parsed = parseCronExpression('0,30 */6 * * *');
    expect([...parsed.minute.values].sort((a, b) => a - b)).toEqual([0, 30]);
    expect([...parsed.hour.values].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
    expect(parsed.dayOfMonth.wildcard).toBe(true);
  });

  it("marca wildcard solo cuando el campo es exactamente '*' (no '*/n')", () => {
    const parsed = parseCronExpression('*/2 * 1 * *');
    expect(parsed.minute.wildcard).toBe(false); // '*/2' esta restringido
    expect(parsed.hour.wildcard).toBe(true);
    expect(parsed.dayOfMonth.wildcard).toBe(false); // '1'
  });
});

describe('cronMatchesAt', () => {
  it('matchea hora exacta en UTC', () => {
    const p = parseCronExpression('0 8 * * *');
    expect(cronMatchesAt(p, utc(2026, 6, 30, 8, 0))).toBe(true);
    expect(cronMatchesAt(p, utc(2026, 6, 30, 8, 1))).toBe(false);
    expect(cronMatchesAt(p, utc(2026, 6, 30, 9, 0))).toBe(false);
  });

  it('cada 15 minutos', () => {
    const p = parseCronExpression('*/15 * * * *');
    expect(cronMatchesAt(p, utc(2026, 6, 30, 9, 0))).toBe(true);
    expect(cronMatchesAt(p, utc(2026, 6, 30, 9, 15))).toBe(true);
    expect(cronMatchesAt(p, utc(2026, 6, 30, 9, 7))).toBe(false);
  });

  it('dia-de-semana: domingo matchea tanto con 0 como con 7', () => {
    // 2026-06-28 es domingo.
    const dom = utc(2026, 6, 28, 0, 0);
    expect(cronMatchesAt(parseCronExpression('0 0 * * 0'), dom)).toBe(true);
    expect(cronMatchesAt(parseCronExpression('0 0 * * 7'), dom)).toBe(true);
    // 2026-06-29 es lunes: no matchea domingo.
    expect(cronMatchesAt(parseCronExpression('0 0 * * 0'), utc(2026, 6, 29, 0, 0))).toBe(false);
  });

  it('regla DOM/DOW: ambos restringidos => OR', () => {
    // '0 0 13 * 5' = dia 13 O viernes.
    const p = parseCronExpression('0 0 13 * 5');
    // 2026-07-13 es lunes (dia 13, no viernes) -> matchea por DOM.
    expect(cronMatchesAt(p, utc(2026, 7, 13, 0, 0))).toBe(true);
    // 2026-07-03 es viernes (no dia 13) -> matchea por DOW.
    expect(cronMatchesAt(p, utc(2026, 7, 3, 0, 0))).toBe(true);
    // 2026-07-06 es lunes y no es dia 13 -> NO matchea.
    expect(cronMatchesAt(p, utc(2026, 7, 6, 0, 0))).toBe(false);
  });

  it('regla DOM/DOW: uno comodin => se aplica el otro (AND)', () => {
    // '0 0 13 * *' = solo dia 13 (dow comodin).
    const p = parseCronExpression('0 0 13 * *');
    expect(cronMatchesAt(p, utc(2026, 7, 13, 0, 0))).toBe(true);
    expect(cronMatchesAt(p, utc(2026, 7, 3, 0, 0))).toBe(false); // viernes pero no dia 13
  });
});

describe('nextCronRun', () => {
  it('diario a las 08:00 UTC: salta al dia siguiente si ya paso', () => {
    expect(nextCronRun('0 8 * * *', utc(2026, 6, 30, 9, 0))).toEqual(utc(2026, 7, 1, 8, 0));
  });

  it('diario a las 08:00 UTC: mismo dia si aun no llego', () => {
    expect(nextCronRun('0 8 * * *', utc(2026, 6, 30, 7, 0))).toEqual(utc(2026, 6, 30, 8, 0));
  });

  it('estrictamente posterior al minuto actual (no re-dispara el mismo minuto)', () => {
    // 09:00 matchea '*/15', pero el proximo debe ser 09:15, no 09:00.
    expect(nextCronRun('*/15 * * * *', utc(2026, 6, 30, 9, 0))).toEqual(utc(2026, 6, 30, 9, 15));
  });

  it('cada 15 minutos desde un minuto intermedio', () => {
    expect(nextCronRun('*/15 * * * *', utc(2026, 6, 30, 9, 7))).toEqual(utc(2026, 6, 30, 9, 15));
  });

  it('ignora segundos: trunca al minuto antes de avanzar', () => {
    const from = new Date(Date.UTC(2026, 5, 30, 9, 7, 45));
    expect(nextCronRun('*/15 * * * *', from)).toEqual(utc(2026, 6, 30, 9, 15));
  });

  it('semanal: lunes 09:00 UTC', () => {
    const next = nextCronRun('0 9 * * 1', utc(2026, 6, 30, 12, 0));
    expect(next).not.toBeNull();
    expect(next?.getUTCDay()).toBe(1); // lunes
    expect(next?.getUTCHours()).toBe(9);
    expect(next?.getUTCMinutes()).toBe(0);
    expect(next!.getTime()).toBeGreaterThan(utc(2026, 6, 30, 12, 0).getTime());
  });

  it('mensual: primero de mes a medianoche', () => {
    expect(nextCronRun('0 0 1 * *', utc(2026, 6, 15, 10, 0))).toEqual(utc(2026, 7, 1, 0, 0));
  });

  it('29 de febrero: salta al proximo anio bisiesto (2028)', () => {
    expect(nextCronRun('0 0 29 2 *', utc(2026, 3, 1, 0, 0))).toEqual(utc(2028, 2, 29, 0, 0));
  });

  it('cron imposible (30 de febrero) => null', () => {
    expect(nextCronRun('0 0 30 2 *', utc(2026, 1, 1, 0, 0))).toBeNull();
  });
});
