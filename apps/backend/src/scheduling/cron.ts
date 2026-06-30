/**
 * Parser y calculadora de CRON ESTANDAR de 5 campos (minuto hora dia-del-mes mes dia-de-semana), SIN
 * dependencias externas. Vive en el backend porque es su unico consumidor (mismo criterio que el resto
 * de los modulos de apps/backend): las rutas de tareas programadas lo usan para (1) VALIDAR el formato
 * del cron antes de persistirlo y (2) CALCULAR next_run_at al crear/editar una tarea.
 *
 * DECISION DE DISENO (next_run_at): el avance de next_run_at en el disparo por horario lo hace una
 * funcion SQL gemela (apps/backend/migrations/V010__scheduler_pgcron.sql: scheduler_cron_next), que
 * implementa EXACTAMENTE esta misma gramatica y semantica. Aqui la logica es TESTEABLE en CI (sin
 * Postgres); alla corre dentro de pg_cron sin depender del backend. Ambas interpretan el cron en UTC.
 * No se agrega una libreria de cron a proposito: la gramatica soportada es chica y debe poder
 * espejarse en SQL, y el calculo del "proximo match" se hace por BARRIDO minuto a minuto (delegando
 * toda la aritmetica de calendario a Date/Postgres), que es robusto y no un parser fragil de saltos.
 *
 * GRAMATICA SOPORTADA (por campo): '*', '*' + paso ('*' + '/' + n), un valor 'a', un rango 'a-b',
 * un rango con paso 'a-b/n', un valor con paso 'a/n' (= 'a-max/n'), y listas separadas por coma de
 * cualquiera de los anteriores. NO se soportan nombres (JAN, MON) ni extensiones (L, W, '#', '?').
 * Rangos por campo: minuto 0-59, hora 0-23, dia-del-mes 1-31, mes 1-12, dia-de-semana 0-7 (0 y 7 =
 * domingo). Regla estandar de Vixie para dia-del-mes vs dia-de-semana: si AMBOS estan restringidos
 * (ninguno es '*'), un instante matchea cuando matchea UNO U OTRO (OR); si alguno es '*', se aplica
 * el otro normalmente (AND con el comodin, que siempre matchea).
 */

interface CronField {
  /** Conjunto de valores permitidos para el campo, ya expandido. */
  values: ReadonlySet<number>;
  /** true solo si el campo original era exactamente '*' (no '*' + paso): define la regla DOM/DOW. */
  wildcard: boolean;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface FieldBounds {
  min: number;
  max: number;
}

const MINUTE_BOUNDS: FieldBounds = { min: 0, max: 59 };
const HOUR_BOUNDS: FieldBounds = { min: 0, max: 23 };
const DOM_BOUNDS: FieldBounds = { min: 1, max: 31 };
const MONTH_BOUNDS: FieldBounds = { min: 1, max: 12 };
const DOW_BOUNDS: FieldBounds = { min: 0, max: 7 };

/**
 * Horizonte del barrido de "proximo match": 1461 dias (4 anios) en minutos. 366 dias bastarian para
 * crones anuales, pero un cron de 29 de febrero ('0 0 29 2 *') solo matchea en anios bisiestos: 4 anios
 * cubren el proximo bisiesto. Mas alla del horizonte, nextCronRun devuelve null (cron imposible, p.ej.
 * '0 0 30 2 *'). DEBE coincidir con el '1461 days' de la funcion SQL gemela scheduler_cron_next.
 */
const HORIZON_MINUTES = 1461 * 24 * 60;

const MINUTE_MS = 60_000;

/** Parsea un entero NO negativo estricto: solo digitos. Cualquier otra cosa lanza. */
function parseStrictInt(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`valor cron invalido: "${raw}"`);
  }
  return Number(raw);
}

/**
 * Expande UN token de un campo (sin comas) a la lista de valores que cubre. Maneja '*', '*' con paso,
 * valor simple, rango y rango/valor con paso. Valida los limites del campo y que el paso sea >= 1.
 */
function expandToken(token: string, bounds: FieldBounds): number[] {
  let rangePart = token;
  let step = 1;
  const slash = token.indexOf('/');
  const hasStep = slash !== -1;
  if (hasStep) {
    rangePart = token.slice(0, slash);
    step = parseStrictInt(token.slice(slash + 1));
    if (step < 1) {
      throw new Error(`paso cron invalido en "${token}"`);
    }
  }

  let low: number;
  let high: number;
  if (rangePart === '*') {
    low = bounds.min;
    high = bounds.max;
  } else {
    const dash = rangePart.indexOf('-');
    if (dash !== -1) {
      low = parseStrictInt(rangePart.slice(0, dash));
      high = parseStrictInt(rangePart.slice(dash + 1));
    } else {
      low = parseStrictInt(rangePart);
      // 'a/n' = 'a-max/n'; 'a' (sin paso) = solo a.
      high = hasStep ? bounds.max : low;
    }
  }

  if (low < bounds.min || high > bounds.max || low > high) {
    throw new Error(`rango cron fuera de limites [${bounds.min}-${bounds.max}] en "${token}"`);
  }

  const out: number[] = [];
  for (let v = low; v <= high; v += step) {
    out.push(v);
  }
  return out;
}

/** Parsea un campo completo (puede tener listas con coma) al conjunto de valores + flag de comodin. */
function parseField(field: string, bounds: FieldBounds): CronField {
  if (field === '') {
    throw new Error('campo cron vacio');
  }
  const values = new Set<number>();
  for (const token of field.split(',')) {
    for (const value of expandToken(token, bounds)) {
      values.add(value);
    }
  }
  return { values, wildcard: field === '*' };
}

/**
 * Parsea una expresion cron de 5 campos. Lanza Error con detalle si el formato es invalido (numero de
 * campos distinto de 5, token malformado o valor fuera de rango). El llamador la valida primero con
 * isValidCronExpression para devolver un 400, no un 500.
 */
export function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`la expresion cron debe tener 5 campos, tiene ${fields.length}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
  return {
    minute: parseField(minute, MINUTE_BOUNDS),
    hour: parseField(hour, HOUR_BOUNDS),
    dayOfMonth: parseField(dayOfMonth, DOM_BOUNDS),
    month: parseField(month, MONTH_BOUNDS),
    dayOfWeek: parseField(dayOfWeek, DOW_BOUNDS),
  };
}

/** True si la expresion cron es valida (formato soportado). No lanza: es el predicado para Zod. */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * True si el instante `date` (interpretado en UTC) matchea el cron. La aritmetica de calendario la
 * resuelve Date (getUTC*): nunca se calcula a mano un rollover de mes/anio. Aplica la regla estandar
 * de dia-del-mes vs dia-de-semana (OR cuando ambos estan restringidos).
 */
export function cronMatchesAt(parsed: ParsedCron, date: Date): boolean {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dow = date.getUTCDay(); // 0..6, 0 = domingo

  if (!parsed.minute.values.has(minute)) return false;
  if (!parsed.hour.values.has(hour)) return false;
  if (!parsed.month.values.has(month)) return false;

  const domMatch = parsed.dayOfMonth.values.has(dom);
  // Domingo es 0 desde Date; aceptamos tambien 7 en el spec (extension comun).
  const dowMatch = parsed.dayOfWeek.values.has(dow) || (dow === 0 && parsed.dayOfWeek.values.has(7));

  const dayMatch =
    !parsed.dayOfMonth.wildcard && !parsed.dayOfWeek.wildcard
      ? domMatch || dowMatch
      : domMatch && dowMatch;

  return dayMatch;
}

/**
 * Calcula el PROXIMO instante (en UTC, truncado al minuto) ESTRICTAMENTE POSTERIOR al minuto de
 * `from` que matchea el cron. Devuelve null si no hay match dentro del horizonte de 366 dias (cron
 * imposible, p.ej. '0 0 30 2 *' = 30 de febrero). El barrido minuto a minuto delega TODA la
 * aritmetica de calendario a Date; es la misma estrategia (robusta, no un parser de saltos) que la
 * funcion SQL gemela scheduler_cron_next.
 *
 * El "estrictamente posterior" garantiza avance: llamado en el momento del disparo (now dentro del
 * minuto que ya matcheo) devuelve el SIGUIENTE match, sin re-disparar el mismo minuto.
 */
export function nextCronRun(expression: string, from: Date): Date | null {
  const parsed = parseCronExpression(expression);
  // Trunca `from` al minuto (descarta segundos/ms) y arranca en el minuto siguiente.
  const startMinute = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    from.getUTCHours(),
    from.getUTCMinutes(),
  );
  let cursor = startMinute + MINUTE_MS;
  for (let i = 0; i < HORIZON_MINUTES; i += 1) {
    const candidate = new Date(cursor);
    if (cronMatchesAt(parsed, candidate)) {
      return candidate;
    }
    cursor += MINUTE_MS;
  }
  return null;
}
