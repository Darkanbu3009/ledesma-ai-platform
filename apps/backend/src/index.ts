import { parseEnv, type Env } from './config/env.js';
import { buildServer } from './server.js';

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
}

void main();
