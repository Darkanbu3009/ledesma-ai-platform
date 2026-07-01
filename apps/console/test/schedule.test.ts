import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  describeCron,
  describeSchedule,
  formatRunAt,
  scheduleToCron,
  type FriendlySchedule,
} from '../src/lib/schedule';

const schedule = (overrides: Partial<FriendlySchedule>): FriendlySchedule => ({
  ...DEFAULT_SCHEDULE,
  ...overrides,
});

describe('scheduleToCron', () => {
  it('cada hora usa el minuto elegido y comodines en el resto', () => {
    expect(scheduleToCron(schedule({ frequency: 'hourly', minute: 0 }))).toBe('0 * * * *');
    expect(scheduleToCron(schedule({ frequency: 'hourly', minute: 30 }))).toBe('30 * * * *');
  });

  it('cada dia fija minuto y hora', () => {
    expect(scheduleToCron(schedule({ frequency: 'daily', hour: 8, minute: 0 }))).toBe('0 8 * * *');
    expect(scheduleToCron(schedule({ frequency: 'daily', hour: 18, minute: 45 }))).toBe(
      '45 18 * * *',
    );
  });

  it('cada semana agrega el dia de la semana', () => {
    expect(scheduleToCron(schedule({ frequency: 'weekly', hour: 9, minute: 0, weekday: 1 }))).toBe(
      '0 9 * * 1',
    );
    expect(scheduleToCron(schedule({ frequency: 'weekly', hour: 20, minute: 15, weekday: 0 }))).toBe(
      '15 20 * * 0',
    );
  });

  it('cada mes agrega el dia del mes', () => {
    expect(
      scheduleToCron(schedule({ frequency: 'monthly', hour: 7, minute: 0, dayOfMonth: 1 })),
    ).toBe('0 7 1 * *');
    expect(
      scheduleToCron(schedule({ frequency: 'monthly', hour: 23, minute: 30, dayOfMonth: 28 })),
    ).toBe('30 23 28 * *');
  });
});

describe('describeCron', () => {
  it('traduce las formas comunes a espanol legible', () => {
    expect(describeCron('0 8 * * *')).toBe('Todos los dias a las 08:00');
    expect(describeCron('45 18 * * *')).toBe('Todos los dias a las 18:45');
    expect(describeCron('0 * * * *')).toBe('Cada hora (en punto)');
    expect(describeCron('30 * * * *')).toBe('Cada hora, al minuto 30');
    expect(describeCron('0 9 * * 1')).toBe('Todos los lunes a las 09:00');
    expect(describeCron('15 20 * * 0')).toBe('Todos los domingos a las 20:15');
    expect(describeCron('0 8 * * 7')).toBe('Todos los domingos a las 08:00');
    expect(describeCron('0 7 1 * *')).toBe('El dia 1 de cada mes a las 07:00');
    expect(describeCron('* * * * *')).toBe('Cada minuto');
  });

  it('devuelve null para crones avanzados que el selector amigable no cubre', () => {
    expect(describeCron('*/15 * * * *')).toBeNull();
    expect(describeCron('0 9-17 * * 1-5')).toBeNull();
    expect(describeCron('0 8 1 1 *')).toBeNull(); // mes restringido
    expect(describeCron('0 8 15 * 1')).toBeNull(); // dom y dow ambos fijos
    expect(describeCron('no es cron')).toBeNull();
    expect(describeCron('0 8 * *')).toBeNull();
  });

  it('devuelve null para valores fuera de rango (no describe crones invalidos)', () => {
    expect(describeCron('60 8 * * *')).toBeNull(); // minuto > 59
    expect(describeCron('999 8 * * *')).toBeNull(); // minuto absurdo
    expect(describeCron('0 24 * * *')).toBeNull(); // hora > 23
    expect(describeCron('0 8 * * 8')).toBeNull(); // dia de semana > 7
    expect(describeCron('0 8 32 * *')).toBeNull(); // dia del mes > 31
  });
});

describe('describeSchedule (round-trip)', () => {
  it('cada frecuencia del selector produce una descripcion legible', () => {
    expect(describeSchedule(schedule({ frequency: 'hourly', minute: 0 }))).toBe(
      'Cada hora (en punto)',
    );
    expect(describeSchedule(schedule({ frequency: 'daily', hour: 8, minute: 0 }))).toBe(
      'Todos los dias a las 08:00',
    );
    expect(
      describeSchedule(schedule({ frequency: 'weekly', hour: 9, minute: 0, weekday: 3 })),
    ).toBe('Todos los miercoles a las 09:00');
    expect(
      describeSchedule(schedule({ frequency: 'monthly', hour: 7, minute: 0, dayOfMonth: 15 })),
    ).toBe('El dia 15 de cada mes a las 07:00');
  });
});

describe('formatRunAt', () => {
  it('devuelve null cuando no hay valor o no parsea', () => {
    expect(formatRunAt(null)).toBeNull();
    expect(formatRunAt('no-es-fecha')).toBeNull();
  });

  it('formatea un ISO en UTC con el sufijo UTC', () => {
    const formatted = formatRunAt('2026-07-01T08:00:00.000Z');
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('2026');
    expect(formatted).toContain('08:00');
    expect(formatted?.endsWith('UTC')).toBe(true);
  });
});
