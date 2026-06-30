import { z } from 'zod';
import { DEFAULT_RUN_TIMEOUT_SECONDS, DEFAULT_RUN_MAX_TOKENS } from '../agent/limits.js';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_TIME_WINDOW: z.string().default('1 minute'),
  DATABASE_URL: z.string().min(1),
  ADMIN_API_TOKEN: z.string().min(16),
  SUPABASE_URL: z.string().url(),
  SESSION_TOKEN_SECRET: z.string().min(32),
  // Secreto maestro de la BOVEDA DE CREDENCIALES: cifra y descifra (AES-256-GCM) las API keys que el
  // usuario guarda. REQUERIDO (no opcional): sin el, la boveda no puede cifrar al guardar ni descifrar
  // al usar, asi que arrancar sin VAULT_SECRET es un error de configuracion explicito. Es una env
  // SEPARADA de SESSION_TOKEN_SECRET a proposito, para poder rotar cada secreto de forma independiente
  // (rotar el de la boveda no invalida los session-tokens en vuelo y viceversa). Debe setearse en el
  // entorno con 32+ caracteres.
  VAULT_SECRET: z.string().min(32),
  // Tools nativas de plataforma (web worker propio). Opcionales a proposito: si falta cualquiera
  // de las dos, la feature se desactiva (no se inyectan nativas) y el comportamiento es identico
  // al actual. WEB_WORKER_SECRET firma los POST al worker (no es el whsec_ por agente).
  WEB_WORKER_URL: z.string().url().optional(),
  WEB_WORKER_SECRET: z.string().min(32).optional(),
  // Cortes de seguridad del MOTOR DE EJECUCION, opcionales con default (mismo patron WEB_WORKER_*):
  // si faltan, se usan los defaults de la plataforma (agent/limits.ts) y el comportamiento de un run
  // normal no cambia. RUN_TIMEOUT_SECONDS es el deadline de pared sobre la peticion completa;
  // RUN_MAX_TOKENS es el cap de tokens acumulados (input + output) a traves de las iteraciones del
  // run. Ambos numeros positivos (coercion de string como PORT).
  RUN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(DEFAULT_RUN_TIMEOUT_SECONDS),
  RUN_MAX_TOKENS: z.coerce.number().int().positive().default(DEFAULT_RUN_MAX_TOKENS),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}
