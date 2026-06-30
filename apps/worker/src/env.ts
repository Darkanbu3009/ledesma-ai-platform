import { z } from 'zod';

/**
 * Config del WORKER de ejecucion autonoma (Fase 5). Comparte env vars con el backend a proposito:
 * DATABASE_URL para conectarse a la misma base, VAULT_SECRET para resolver la credencial guardada de
 * cada job (por owner + credential), WEB_WORKER_* para inyectar las tools nativas al ensamblar, y
 * RUN_TIMEOUT_SECONDS / RUN_MAX_TOKENS para los cortes del motor (timeout de pared propio del worker
 * y cap de tokens del run). Mismo contrato que el backend para poder correr el MISMO motor.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1),
  // Secreto maestro de la BOVEDA. El worker lo usa para resolver la credencial guardada de cada job
  // (por owner + credential) y ejecutar sin un humano presente. Mismo contrato que el backend (32+).
  VAULT_SECRET: z.string().min(32),
  // Worker nativo de plataforma (tools nativas). Opcionales con el mismo patron que el backend: si
  // falta cualquiera de las dos, el ensamblado no inyecta nativas (mismo comportamiento que un run
  // sin nativas). WEB_WORKER_SECRET firma los POST al worker nativo.
  WEB_WORKER_URL: z.string().url().optional(),
  WEB_WORKER_SECRET: z.string().min(32).optional(),
  // Cada cuanto el loop consulta la cola, en milisegundos.
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // Cortes del MOTOR DE EJECUCION (mismo contrato y defaults que el backend, ver apps/backend/src/
  // agent/limits.ts: DEFAULT_RUN_TIMEOUT_SECONDS=600, DEFAULT_RUN_MAX_TOKENS=1_000_000). Se hardcodean
  // los defaults aca (en vez de importarlos del backend) para no acoplar el parseo de env al build del
  // backend en los tests. RUN_TIMEOUT_SECONDS es el deadline de pared que el worker aplica por su
  // cuenta (runAgent no lo aplica); RUN_MAX_TOKENS es el cap de tokens acumulados del run.
  RUN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),
  RUN_MAX_TOKENS: z.coerce.number().int().positive().default(1_000_000),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}
