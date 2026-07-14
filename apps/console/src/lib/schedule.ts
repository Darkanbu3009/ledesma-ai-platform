/**
 * Logica PURA del SELECTOR DE HORARIO amigable de las tareas programadas. El usuario elige un horario
 * comun (cada hora / dia / semana / mes) SIN ver cron, y aca se genera la expresion cron de 5 campos
 * que espera el backend. Tambien traduce un cron de vuelta a lenguaje legible para la lista y para la
 * vista previa del modo avanzado. Sin React ni red: se testea como funciones puras.
 *
 * ZONA HORARIA: el backend interpreta el cron en UTC (igual que su gemela SQL). Por eso el horario que
 * el usuario elige aca es UTC, y la UI lo rotula explicitamente. Asi lo generado, lo mostrado y lo que
 * ejecuta el servidor coinciden, sin sorpresas por horario de verano.
 */

import i18n, { currentLanguage } from '../i18n';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

/**
 * Estado del selector amigable. Un unico objeto cubre las 4 frecuencias; cada frecuencia usa solo los
 * campos que le aplican (el resto conserva su valor por defecto para no perder la eleccion al cambiar
 * de frecuencia). minute/hour en UTC.
 */
export interface FriendlySchedule {
  frequency: ScheduleFrequency;
  /** Minuto 0-59. Lo usan todas las frecuencias (es el 1er campo del cron). */
  minute: number;
  /** Hora 0-23 (UTC). La usan daily/weekly/monthly. */
  hour: number;
  /** Dia de la semana 0-6 (0 = domingo). Lo usa weekly. */
  weekday: number;
  /** Dia del mes 1-28. Lo usa monthly. Tope 28 para que caiga en todos los meses (nunca se saltea). */
  dayOfMonth: number;
}

/** Horario por defecto del selector: todos los dias a las 08:00 UTC. */
export const DEFAULT_SCHEDULE: FriendlySchedule = {
  frequency: 'daily',
  minute: 0,
  hour: 8,
  weekday: 1,
  dayOfMonth: 1,
};

/** Tope del dia del mes en el modo amigable: 28 garantiza que la tarea corra todos los meses. */
export const MAX_FRIENDLY_DAY_OF_MONTH = 28;

/** Claves de los nombres de los dias de la semana en plural (para "Todos los ..."). Indice 0 = domingo. */
const WEEKDAY_PLURAL_KEYS = [
  'tareas.cron.dias.domingos',
  'tareas.cron.dias.lunes',
  'tareas.cron.dias.martes',
  'tareas.cron.dias.miercoles',
  'tareas.cron.dias.jueves',
  'tareas.cron.dias.viernes',
  'tareas.cron.dias.sabados',
] as const;

/** Nombre en plural del dia de la semana. Acepta 0-7 (0 y 7 = domingo). */
export function weekdayName(day: number): string {
  const key = WEEKDAY_PLURAL_KEYS[day % 7];
  return key === undefined ? String(day) : i18n.t(key);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formatea una hora del dia (UTC) como HH:MM de 24 horas. */
export function formatTimeOfDay(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Genera la expresion cron de 5 campos (minuto hora dia-del-mes mes dia-de-semana) desde el selector
 * amigable. El mes siempre es '*'; el modo amigable no restringe meses.
 */
export function scheduleToCron(schedule: FriendlySchedule): string {
  const { frequency, minute, hour, weekday, dayOfMonth } = schedule;
  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${weekday}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

/** Un campo es un entero simple si es solo digitos. Devuelve el numero o null. */
function singleInt(field: string): number | null {
  return /^\d+$/.test(field) ? Number(field) : null;
}

/**
 * Traduce una expresion cron a lenguaje legible en espanol (p.ej. "Todos los dias a las 08:00").
 * Solo reconoce las formas COMUNES que produce el selector amigable; para un cron arbitrario del modo
 * avanzado devuelve null y el llamador muestra la expresion cruda. Nunca lanza.
 */
export function describeCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, domField, monthField, dowField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  // El modo amigable nunca restringe meses: si el mes no es comodin, es un cron avanzado -> null.
  if (monthField !== '*') return null;

  const minute = singleInt(minuteField);

  // "Cada minuto": todo comodin.
  if (
    minuteField === '*' &&
    hourField === '*' &&
    domField === '*' &&
    dowField === '*'
  ) {
    return i18n.t('tareas.cron.cadaMinuto');
  }

  if (minute === null || minute > 59) return null;

  // Cada hora (minuto fijo, resto comodin).
  if (hourField === '*' && domField === '*' && dowField === '*') {
    return minute === 0
      ? i18n.t('tareas.cron.cadaHoraEnPunto')
      : i18n.t('tareas.cron.cadaHoraAlMinuto', { minuto: pad2(minute) });
  }

  const hour = singleInt(hourField);
  if (hour === null || hour > 23) return null;
  const time = formatTimeOfDay(hour, minute);

  // Cada semana en un dia (dom comodin, dow fijo).
  if (domField === '*' && dowField !== '*') {
    const weekday = singleInt(dowField);
    if (weekday === null || weekday > 7) return null;
    return i18n.t('tareas.cron.cadaSemana', { dia: weekdayName(weekday), hora: time });
  }

  // Cada mes en un dia (dom fijo, dow comodin).
  if (domField !== '*' && dowField === '*') {
    const dom = singleInt(domField);
    if (dom === null || dom < 1 || dom > 31) return null;
    return i18n.t('tareas.cron.cadaMes', { dia: dom, hora: time });
  }

  // Cada dia (dom y dow comodin).
  if (domField === '*' && dowField === '*') {
    return i18n.t('tareas.cron.cadaDia', { hora: time });
  }

  // Cualquier otra combinacion (dom y dow ambos fijos, etc.) es avanzada.
  return null;
}

/** Descripcion legible del selector amigable (siempre reconocible, cae al cron si algo no matchea). */
export function describeSchedule(schedule: FriendlySchedule): string {
  const cron = scheduleToCron(schedule);
  return describeCron(cron) ?? cron;
}

/**
 * Formatea un timestamp ISO en UTC como "1 jul 2026, 08:00 UTC", para mostrar next_run_at/last_run_at
 * en la lista. Devuelve null si el valor es null o no parsea (el llamador decide el texto de vacio).
 */
export function formatRunAt(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = date.toLocaleString(currentLanguage(), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatted} UTC`;
}
