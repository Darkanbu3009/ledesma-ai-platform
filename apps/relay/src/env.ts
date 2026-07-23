import type { LogLevel } from './logger.js';

/**
 * Config del SERVICIO RELAY. Se parsea a mano (sin zod ni ninguna otra dependencia) a proposito: este
 * servicio tiene superficie minima y una sola dependencia externa (ws). Si algo no es indispensable
 * para relevar teclas, no entra.
 *
 * SECRETOS QUE TIENE (y solo estos):
 *  - BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID: para pedir el connectUrl de la sesion viva. El
 *    connectUrl embebe el signing key de la sesion; por eso este proceso es pequeno y auditable.
 *  - RELAY_TOKEN_SECRET: secreto COMPARTIDO con el backend para validar el token efimero.
 * SECRETOS QUE NO TIENE (por diseno): VAULT_SECRET, DATABASE_URL, llaves de Supabase ni ninguna otra.
 * El relay NO toca la base de datos: el token stateless trae todo lo necesario para validarlo.
 */
export interface RelayEnv {
  port: number;
  host: string;
  logLevel: LogLevel;
  browserbaseApiKey: string;
  browserbaseProjectId: string;
  relayTokenSecret: string;
  /** Origenes permitidos del upgrade WebSocket. '*' refleja cualquiera (solo para desarrollo). */
  allowedOrigins: '*' | string[];
}

function requireVar(source: NodeJS.ProcessEnv, name: string, minLength = 1): string {
  const value = source[name];
  if (typeof value !== 'string' || value.length < minLength) {
    throw new Error(
      `Environment validation failed: ${name} es obligatorio` +
        (minLength > 1 ? ` y debe tener al menos ${minLength} caracteres` : ''),
    );
  }
  return value;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const allowed: LogLevel[] = ['error', 'warn', 'info', 'debug', 'silent'];
  return allowed.includes(value as LogLevel) ? (value as LogLevel) : 'info';
}

function parseOrigins(value: string | undefined): '*' | string[] {
  if (value === undefined) return '*';
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 1 && origins[0] === '*') return '*';
  return origins;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3100;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Environment validation failed: PORT invalido (${value})`);
  }
  return port;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): RelayEnv {
  return {
    port: parsePort(source.PORT),
    host: source.HOST ?? '0.0.0.0',
    logLevel: parseLogLevel(source.LOG_LEVEL),
    browserbaseApiKey: requireVar(source, 'BROWSERBASE_API_KEY'),
    browserbaseProjectId: requireVar(source, 'BROWSERBASE_PROJECT_ID'),
    // Mismo piso de 32 caracteres que en el backend: los dos lados comparten este secreto exacto.
    relayTokenSecret: requireVar(source, 'RELAY_TOKEN_SECRET', 32),
    allowedOrigins: parseOrigins(source.RELAY_ALLOWED_ORIGINS),
  };
}
