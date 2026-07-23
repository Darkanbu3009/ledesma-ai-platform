import { parseEnv, type Env } from './config/env.js';
import { buildServer } from './server.js';
import { buildInternalServer } from './internal-server.js';

function loadConfig(): Env {
  try {
    return parseEnv();
  } catch (err) {
    console.error('Invalid environment configuration:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  try {
    const address = await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`servidor escuchando en ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // LISTENER INTERNO (B-1): autoridad de coordinacion del relay, en un puerto SEPARADO que Railway NO
  // expone publicamente (solo por la red privada). Solo arranca si el relay esta configurado
  // (RELAY_TOKEN_SECRET). Escucha en '::' para cubrir IPv6/IPv4 de la red privada de Railway.
  if (config.RELAY_TOKEN_SECRET !== undefined) {
    try {
      const internal = await buildInternalServer(config, config.RELAY_TOKEN_SECRET);
      const internalAddress = await internal.listen({ port: config.RELAY_INTERNAL_PORT, host: '::' });
      internal.log.info(`listener interno del relay escuchando en ${internalAddress}`);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  }
}

void main();
