import { describe, it, expect } from 'vitest';
import { formatDurationMs, formatRunDate, formatTokens, statusLabel } from '../src/lib/usage';

describe('formatTokens', () => {
  it('deja los valores menores a mil tal cual', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
  });

  it('abrevia miles con k y coma decimal, sin decimal redundante', () => {
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(12400)).toBe('12,4k');
  });

  it('abrevia millones con M', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(3_200_000)).toBe('3,2M');
  });
});

describe('formatDurationMs', () => {
  it('muestra milisegundos por debajo de un segundo', () => {
    expect(formatDurationMs(850)).toBe('850 ms');
  });

  it('muestra segundos con coma decimal, sin decimal redundante', () => {
    expect(formatDurationMs(1500)).toBe('1,5 s');
    expect(formatDurationMs(2000)).toBe('2 s');
  });

  it('muestra minutos y omite los segundos cuando son cero', () => {
    expect(formatDurationMs(65000)).toBe('1 min 5 s');
    expect(formatDurationMs(120000)).toBe('2 min');
  });
});

describe('formatRunDate', () => {
  it('devuelve una fecha corta legible para un ISO valido', () => {
    const iso = '2026-06-10T14:32:00.000Z';
    const out = formatRunDate(iso);
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe(iso);
  });

  it('devuelve la entrada tal cual si no es una fecha valida', () => {
    expect(formatRunDate('basura')).toBe('basura');
  });
});

describe('statusLabel', () => {
  it('mapea los estados conocidos a etiqueta y tono', () => {
    expect(statusLabel('completed')).toEqual({ label: 'Completada', tone: 'ok' });
    expect(statusLabel('error')).toEqual({ label: 'Error', tone: 'error' });
    expect(statusLabel('aborted')).toEqual({ label: 'Detenida', tone: 'muted' });
  });

  it('devuelve el status crudo con tono muted si es desconocido', () => {
    expect(statusLabel('raro')).toEqual({ label: 'raro', tone: 'muted' });
  });
});
