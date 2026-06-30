import { z } from 'zod';

/**
 * Config del WORKER de ejecucion autonoma (Fase 5). Comparte env vars con el backend a proposito:
 * DATABASE_URL para conectarse a la misma base, VAULT_SECRET y WEB_WORKER_* para cuando ejecute
 * agentes de verdad (PR 5.2). En ESTE PR el worker solo CONSULTA la cola, asi que VAULT_SECRET y
 * WEB_WORKER_* se leen y validan pero todavia no se usan; quedan listas para el siguiente PR.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1),
  // Secreto maestro de la BOVEDA. El worker lo necesitara en PR 5.2 para resolver la credencial
  // guardada de cada job (por owner + credential) y ejecutar sin un humano presente. Mismo contrato
  // que el backend (32+ caracteres).
  VAULT_SECRET: z.string().min(32),
  // Worker nativo de plataforma (tools nativas). Opcionales con el mismo patron que el backend: si
  // faltan, en PR 5.2 el ensamblado no inyecta nativas. Aqui aun no se usan.
  WEB_WORKER_URL: z.string().url().optional(),
  WEB_WORKER_SECRET: z.string().min(32).optional(),
  // Cada cuanto el loop consulta la cola, en milisegundos.
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
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
