export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Orden numerico de severidad (estilo pino): mayor = mas severo. 'silent' nunca emite. */
const ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Logger minimo estructurado (una linea JSON por evento), filtrado por nivel. Suficiente para el
 * ESQUELETO del worker; cuando el worker ejecute agentes de verdad (PR 5.2) podra compartir el logger
 * del backend (pino) para uniformar el formato.
 */
export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];
  const emit = (lvl: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (ORDER[lvl] < threshold) return;
    const line = JSON.stringify({ level: lvl, msg, ...(meta ?? {}) });
    if (lvl === 'error' || lvl === 'fatal') console.error(line);
    else console.log(line);
  };
  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}
