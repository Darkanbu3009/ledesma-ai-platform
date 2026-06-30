import { z } from 'zod';

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
  // Tools nativas de plataforma (web worker propio). Opcionales a proposito: si falta cualquiera
  // de las dos, la feature se desactiva (no se inyectan nativas) y el comportamiento es identico
  // al actual. WEB_WORKER_SECRET firma los POST al worker (no es el whsec_ por agente).
  WEB_WORKER_URL: z.string().url().optional(),
  WEB_WORKER_SECRET: z.string().min(32).optional(),
  // Modelo de PLATAFORMA del Configurador (cerebro). NO es la key BYOK del cliente: es una key
  // PROPIA de la plataforma, costeada por nosotros, que SOLO usa el endpoint del Configurador para
  // entrevistar al usuario y construir el AgentSpec. Opcional a proposito (mismo patron que
  // WEB_WORKER_*): si falta, el endpoint del Configurador responde un error claro (503) y el resto
  // de la plataforma sigue funcionando igual. Hoy el unico proveedor de plataforma es Anthropic.
  PLATFORM_ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Modelo que usa el Configurador sobre la key de plataforma. Trae un default valido para que la
  // feature funcione apenas se configure la key; afinarlo no requiere tocar codigo.
  PLATFORM_MODEL: z.string().min(1).default('claude-sonnet-4-6'),
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
