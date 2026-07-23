import type { LogLevel } from './logger.js';

/**
 * Config del SERVICIO RELAY. Se parsea a mano (sin zod ni ninguna otra dependencia) a proposito: este
 * servicio tiene superficie minima y una sola dependencia externa (ws). Si algo no es indispensable
 * para relevar teclas, no entra.
 *
 * SECRETOS QUE TIENE (y solo estos):
 *  - BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID: para pedir el connectUrl de la sesion viva. El
 *    connectUrl embebe el signing key de la sesion; por eso este proceso es pequeno y auditable.
 *  - RELAY_TOKEN_SECRET: secreto COMPARTIDO con el backend para validar el token efimero Y para firmar
 *    (HMAC) las llamadas a la autoridad de coordinacion (mismo secreto, no se crea uno nuevo).
 * SECRETOS QUE NO TIENE (por diseno): VAULT_SECRET, DATABASE_URL, llaves de Supabase ni ninguna otra.
 * El relay NO toca la base de datos: el token stateless trae todo lo necesario para validarlo, y el
 * estado compartido (uso unico del jti + lock por conexion) lo media el backend por su endpoint interno.
 */
export interface RelayEnv {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: LogLevel;
  browserbaseApiKey: string;
  browserbaseProjectId: string;
  relayTokenSecret: string;
  /**
   * URL base de la AUTORIDAD DE COORDINACION (endpoint interno del backend) para el uso unico del jti y
   * el lock por conexion (B-1). Debe apuntar a la RED PRIVADA de Railway (p.ej.
   * `http://backend.railway.internal:3001`), no a internet. OBLIGATORIA en produccion: sin ella el relay
   * SE NIEGA A ARRANCAR (invariante multi-instancia). En dev/tests puede faltar (autoridad en memoria).
   */
  consumoUrl: string | undefined;
  /**
   * Origenes permitidos del upgrade WebSocket (C-4). OBLIGATORIA: sin ella el relay SE NIEGA A ARRANCAR
   * (refuse-to-start), en vez de caer a un default que aceptaba cualquier origen. '*' es admisible pero
   * SOLO como opt-in explicito para desarrollo; en produccion se configura la lista real de origenes.
   */
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
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // REFUSE-TO-START (C-4): sin origenes configurados el relay NO arranca. Antes el default era '*' y un
  // despliegue sin configurar aceptaba cualquier origen en silencio. Preferimos fallar ruidosamente.
  if (origins.length === 0) {
    throw new Error(
      'Environment validation failed: RELAY_ALLOWED_ORIGINS es obligatorio ' +
        '(lista de origenes permitidos del upgrade WebSocket, separada por comas; ' +
        "usar '*' SOLO en desarrollo). Ver docs/despliegue-relay.md.",
    );
  }
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
  const nodeEnv = source.NODE_ENV ?? 'production';
  const consumoUrl = normalizarUrlConsumo(source.RELAY_CONSUMO_URL);
  // REFUSE-TO-START: en produccion la autoridad de coordinacion es OBLIGATORIA. Sin ella el uso unico y
  // el lock por conexion volverian a ser por proceso y un rolling deploy abriria la ventana multi
  // instancia SIN AVISO. Preferimos no arrancar antes que operar con estado dividido en silencio.
  if (nodeEnv === 'production' && consumoUrl === undefined) {
    throw new Error(
      'Environment validation failed: RELAY_CONSUMO_URL es obligatorio en produccion ' +
        '(autoridad de coordinacion para uso unico del jti y lock por conexion). Ver docs/despliegue-relay.md.',
    );
  }
  return {
    port: parsePort(source.PORT),
    host: source.HOST ?? '0.0.0.0',
    nodeEnv,
    logLevel: parseLogLevel(source.LOG_LEVEL),
    browserbaseApiKey: requireVar(source, 'BROWSERBASE_API_KEY'),
    browserbaseProjectId: requireVar(source, 'BROWSERBASE_PROJECT_ID'),
    // Mismo piso de 32 caracteres que en el backend: los dos lados comparten este secreto exacto.
    relayTokenSecret: requireVar(source, 'RELAY_TOKEN_SECRET', 32),
    consumoUrl,
    allowedOrigins: parseOrigins(source.RELAY_ALLOWED_ORIGINS),
  };
}

/** Normaliza la URL de la autoridad: recorta espacios y devuelve undefined si viene vacia/ausente. */
function normalizarUrlConsumo(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
