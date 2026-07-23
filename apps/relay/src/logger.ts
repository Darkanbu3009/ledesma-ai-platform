export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silent';

const ORDER: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

/**
 * Metadatos de auditoria del relay. DELIBERADAMENTE es un tipo cerrado de PRIMITIVAS NO SENSIBLES:
 * ids, timestamps, conteos, resultados y codigos. NO existe forma de pasarle el contenido de una
 * pulsacion porque el logger no acepta buffers ni objetos arbitrarios: la unica entrada es este
 * diccionario acotado. Auditoria SOLO de metadatos, por construccion del tipo.
 */
export type MetadatosAuditoria = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(evento: string, meta?: MetadatosAuditoria): void;
  info(evento: string, meta?: MetadatosAuditoria): void;
  warn(evento: string, meta?: MetadatosAuditoria): void;
  error(evento: string, meta?: MetadatosAuditoria): void;
}

/**
 * Logger minimo del servicio relay: una linea JSON por evento, filtrado por nivel. NO redacta ni
 * sanea porque NO recibe secretos: por contrato (MetadatosAuditoria) solo entran metadatos. Aun asi,
 * el codigo del relay JAMAS llama al logger con contenido de pulsaciones, connectUrl, tokens ni claves
 * -- ni completos, ni truncados, ni su longitud. Escribe a stdout/stderr propios del proceso relay.
 */
export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];
  const emit = (lvl: Exclude<LogLevel, 'silent'>, evento: string, meta?: MetadatosAuditoria): void => {
    if (ORDER[lvl] < threshold) return;
    const line = JSON.stringify({ level: lvl, evento, ...(meta ?? {}) });
    if (lvl === 'error') console.error(line);
    else console.log(line);
  };
  return {
    debug: (evento, meta) => emit('debug', evento, meta),
    info: (evento, meta) => emit('info', evento, meta),
    warn: (evento, meta) => emit('warn', evento, meta),
    error: (evento, meta) => emit('error', evento, meta),
  };
}
