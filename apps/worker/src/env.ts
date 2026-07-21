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
  // ALERTAS DE FALLO por correo (aditivo, best-effort). Las TRES son OPCIONALES: si falta cualquiera, el
  // worker NO se cae ni cambia su comportamiento de ejecucion; simplemente no envia el correo de alerta y
  // lo loguea (las alertas son una mejora, no una dependencia dura). Se agregan a mano en Railway (ver
  // docs/despliegue-worker.md). Un valor PRESENTE pero mal formado (email/url invalido) si lanza al
  // arrancar, igual que WEB_WORKER_URL: es un error de config, no un "falta la feature".
  //   RESEND_API_KEY:    key de la API de Resend (emisor de los correos de alerta).
  //   RESEND_FROM_EMAIL: remitente verificado en Resend (ej. alertas@send.ledesma-ai-labs.com).
  //   CONSOLE_BASE_URL:  base de la consola para el enlace a /actividad del correo (ej. https://app.ejemplo.com).
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  CONSOLE_BASE_URL: z.string().url().optional(),
  // SITIOS CONECTADOS (Fase 7.1b, aditivo, best-effort como las alertas): credenciales de la API de
  // Browserbase para abrir la sesion de navegador del login manual. Las DOS son OPCIONALES: si falta
  // cualquiera, el worker arranca y ejecuta jobs normales igual; los jobs de sitios fallan permanente
  // con un mensaje claro (procesarJobDeSitio) y el barrido no corre. Se agregan a mano en Railway.
  BROWSERBASE_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_PROJECT_ID: z.string().min(1).optional(),
  // Proxy EXTERNO propio con IP estatica (OPCIONAL, recomendado en produccion): el pool gestionado
  // de Browserbase es best-effort y NO garantiza la misma IP entre sesiones; con un proxy propio la
  // salida pineada por dominio es verdaderamente fija. Si BROWSERBASE_PROXY_SERVER esta, las
  // conexiones NUEVAS salen por el (las existentes respetan su pin). USERNAME/PASSWORD opcionales.
  BROWSERBASE_PROXY_SERVER: z.string().min(1).optional(),
  BROWSERBASE_PROXY_USERNAME: z.string().min(1).optional(),
  BROWSERBASE_PROXY_PASSWORD: z.string().min(1).optional(),
  // CHECKPOINTS DE APROBACION HUMANA (7.1e). APROBACION_TTL_MINUTOS: cuanto vive una aprobacion
  // pendiente antes de expirar (y cancelar la tarea sin ejecutar la accion). Acotado a 1..20 min a
  // proposito: el techo de la sesion de tarea en Browserbase (TAREA_SESSION_TIMEOUT_SECONDS,
  // browserbase.ts) cubre corrida + TTL + reanudacion; un TTL mayor dejaria morir la sesion con la
  // aprobacion aun pendiente. NOTA: el TTL solo regula CUANTO espera el checkpoint, jamas SI existe:
  // no hay valor de env que permita ejecutar una accion financiera sin aprobacion.
  APROBACION_TTL_MINUTOS: z.coerce.number().int().min(1).max(20).default(15),
  // SUPABASE Storage para el SCREENSHOT del checkpoint (best-effort): base del proyecto + service
  // role key. OPCIONALES con el criterio de siempre: sin ellas, el checkpoint se crea SIN screenshot
  // (la descripcion en una linea basta para decidir) y nada mas cambia.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // MODELO de la TAREA WEB (7.1d): el que corre la navegacion por IA dentro de la sesion del
  // usuario. Mismo patron de modelo-por-env que la validacion e2e (scripts/validacion-e2e/lib/
  // env.mjs): configurable por despliegue, con REGLA DE PLATAFORMA dura: NUNCA Haiku para trabajo
  // de agente. Formato proveedor/modelo (lo consume Stagehand). Default: Claude Sonnet.
  TAREA_WEB_MODEL: z
    .string()
    .min(1)
    .default('anthropic/claude-sonnet-4-6')
    .refine((model) => !/haiku/i.test(model), {
      message: 'TAREA_WEB_MODEL no permite Haiku para trabajo de agente (regla de plataforma); usa p.ej. anthropic/claude-sonnet-4-6',
    }),
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
