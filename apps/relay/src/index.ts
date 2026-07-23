import { parseEnv, type RelayEnv } from './env.js';
import { createLogger } from './logger.js';
import { crearServidorRelay } from './server.js';
import { AutoridadEnMemoria, type AutoridadRelay } from './autoridad.js';
import { AutoridadRemota } from './autoridad-remota.js';
import { LimitadorRelay } from './rate-limit.js';
import { ClienteCdp } from './cdp.js';
import { obtenerConnectUrl } from './browserbase.js';
import type { Logger } from './logger.js';

/**
 * Punto de entrada del SERVICIO RELAY de teclado movil (conocimiento minimo). Hace UNA cosa: aceptar el
 * upgrade WebSocket del relay y reenviar por CDP las pulsaciones cifradas hacia la sesion de navegador
 * viva del proveedor. No toca la base de datos, no tiene VAULT_SECRET ni ninguna otra llave de la
 * plataforma: solo BROWSERBASE_API_KEY/PROJECT_ID (para el connectUrl) y RELAY_TOKEN_SECRET (para
 * validar el token efimero). El texto plano de las pulsaciones vive solo en la memoria de este proceso,
 * el menor tiempo posible, y en ningun otro lugar.
 */
function loadConfig(): RelayEnv {
  try {
    return parseEnv();
  } catch (err) {
    console.error('Configuracion de entorno invalida:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

/**
 * Elige la AUTORIDAD de coordinacion (B-1): remota (backend, compartida) si hay URL; en memoria si no.
 * La opcion en memoria SOLO es admisible fuera de produccion: en produccion parseEnv ya obliga la URL
 * (refuse-to-start), asi que aca nunca se cae a memoria en prod.
 */
function elegirAutoridad(env: RelayEnv, logger: Logger): AutoridadRelay {
  if (env.consumoUrl !== undefined) {
    logger.info('relay_autoridad_remota', { url: env.consumoUrl });
    return new AutoridadRemota(env.consumoUrl, env.relayTokenSecret);
  }
  logger.warn('relay_autoridad_en_memoria', {
    aviso: 'uso unico del jti y lock por conexion son por proceso: valido SOLO con una unica instancia',
  });
  return new AutoridadEnMemoria();
}

function main(): void {
  const env = loadConfig();
  const logger = createLogger(env.logLevel);
  const autoridad = elegirAutoridad(env, logger);
  const limitador = new LimitadorRelay();
  const ref = { apiKey: env.browserbaseApiKey, projectId: env.browserbaseProjectId };

  const { server, sesiones } = crearServidorRelay({
    relayTokenSecret: env.relayTokenSecret,
    allowedOrigins: env.allowedOrigins,
    autoridad,
    limitador,
    logger,
    resolverConnectUrl: (sesionExternaId) => obtenerConnectUrl(ref, sesionExternaId),
    crearCdp: (connectUrl) => ClienteCdp.conectar(connectUrl),
  });

  server.listen(env.port, env.host, () => {
    logger.info('relay_escuchando', { port: env.port });
  });

  let apagando = false;
  const apagar = (senal: string): void => {
    if (apagando) return;
    apagando = true;
    logger.info('relay_apagando', { senal });
    // Cerrar toda sesion viva (garantiza el fin del canal y del CDP; sin sesiones huerfanas).
    for (const sesion of sesiones) sesion.cerrar('apagado');
    const watchdog = setTimeout(() => process.exit(0), 5_000);
    watchdog.unref();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}

main();
