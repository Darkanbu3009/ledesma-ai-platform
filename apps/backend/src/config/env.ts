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
  // SERVICE_ROLE_KEY de Supabase: llave del rol de servicio que BYPASEA RLS y habilita el ADMIN API de
  // auth (supabase.auth.admin.deleteUser), usado por el MOTOR DE BORRADO DE CUENTA para eliminar la fila
  // de auth.users tras borrar los datos de negocio. Es una llave MUY poderosa (acceso total, ignora RLS):
  // se trata como SECRETO DE BOVEDA -> NUNCA se loguea, ni se devuelve por HTTP, ni aparece en errores.
  // OPCIONAL a proposito (mismo patron que WEB_WORKER_* / RESEND_*): si falta, el borrado de DATOS
  // (Postgres, atomico) funciona igual, pero el borrado de auth.users queda DESACTIVADO y el motor lo
  // reporta como 'not_configured' (no rompe: el erasure ARCO por default no borra auth.users). En
  // produccion DEBE setearse para poder eliminar la identidad por completo (endpoint self-service, pieza
  // siguiente). Un valor presente pero vacio (min 1) falla al arrancar (error de config explicito).
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // URL base PUBLICA del backend, para construir la URL del webhook ENTRANTE de un trigger (Fase 5.4)
  // que se le muestra al usuario al crear/rotar (p.ej. https://api.ledesma-ai-labs.com). Opcional: si
  // falta, la ruta la deriva del request (protocolo + host). Setearla en prod es lo robusto cuando el
  // backend esta detras de un proxy/CDN (el host del request puede no ser el publico). Sin trailing
  // slash requerido: se normaliza al construir. NO expone secretos; es solo el origen para armar la URL.
  PUBLIC_BASE_URL: z.string().url().optional(),
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
  // RETENCION de trayectorias de tareas web (V030), en dias, OPCIONAL con default 30 (mismo patron
  // numerico que RUN_TIMEOUT_SECONDS). Es la UNICA ventana de retencion configurable por env porque
  // los pasos describen la actividad del usuario dentro de sus sitios (dato mas sensible que
  // agent_runs/jobs, cuyas ventanas siguen fijas en retention-policy.ts). Subirla retiene mas;
  // bajarla, menos. La purga la aplican el endpoint admin de retencion y la gemela SQL de V030.
  RETENTION_TRAYECTORIAS_WEB_DAYS: z.coerce.number().int().positive().default(30),
  // CORREO DE BIENVENIDA por Resend (onboarding, aditivo, best-effort). Las TRES son OPCIONALES: si
  // falta cualquiera, el registro funciona IGUAL y solo se loguea que no se envio la bienvenida (el
  // correo es una mejora de retencion, no una dependencia dura). Reusan el MISMO patron de fetch a
  // Resend que las alertas del worker; se agregan a mano al servicio del backend en Railway. Un valor
  // PRESENTE pero mal formado (email/url invalido) si lanza al arrancar (es error de config, no "falta
  // la feature"), igual que WEB_WORKER_URL.
  //   RESEND_API_KEY:            key de la API de Resend (la MISMA cuenta que las alertas del worker).
  //   RESEND_WELCOME_FROM_EMAIL: remitente verificado para la bienvenida (ej. hola@send.ledesma-ai-labs.com),
  //                              distinto del remitente de alertas del worker (alertas@...).
  //   CONSOLE_BASE_URL:          base de la consola para el enlace al panel del correo (ej. https://app.ledesma-ai-labs.com).
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WELCOME_FROM_EMAIL: z.string().email().optional(),
  CONSOLE_BASE_URL: z.string().url().optional(),
  // ALERTA DE NUEVAS SOLICITUDES DE UPGRADE por Resend (monetizacion, aditivo, best-effort): correo
  // del OPERADOR que recibe el aviso cuando POST /v1/upgrade-requests inserta una fila nueva (no en
  // reintentos deduplicados). OPCIONAL, mismo patron que la bienvenida: si falta, el endpoint funciona
  // IGUAL y solo se loguea (una vez) que la alerta esta desactivada. Reusa RESEND_API_KEY y el
  // remitente RESEND_WELCOME_FROM_EMAIL ya configurados; se agrega a mano al servicio del backend en
  // Railway (ver docs/despliegue-backend-alerta-upgrade.md). Un valor presente pero mal formado
  // (email invalido) si lanza al arrancar (error de config explicito), igual que las otras.
  UPGRADE_ALERTS_EMAIL: z.string().email().optional(),
  // RELAY DE TECLADO MOVIL (conocimiento minimo, aditivo, opcional). El backend NO releva pulsaciones
  // ni habla con Browserbase: SOLO ACUNA el token efimero de un solo uso (mintRelayToken) que autoriza
  // al servicio relay (apps/relay) a abrir el canal. Las DOS son opcionales con el patron de siempre:
  // si falta cualquiera, el endpoint POST /v1/sitios/:id/relay-token responde 'no configurado' y la UI
  // movil cae al aviso de "hazlo desde una computadora" (desktop no se entera). Un valor presente pero
  // mal formado (secreto corto / url invalida) si lanza al arrancar (error de config explicito).
  //   RELAY_TOKEN_SECRET: secreto COMPARTIDO con el servicio relay para acunar/verificar el token
  //                       efimero. SEPARADO de VAULT_SECRET y SESSION_TOKEN_SECRET a proposito: el
  //                       servicio relay recibe SOLO este secreto y ninguna otra llave de la plataforma.
  //   RELAY_PUBLIC_URL:   URL wss:// publica del servicio relay que el endpoint devuelve al cliente para
  //                       que sepa a donde conectar (asi el console DESCUBRE la URL sin una env propia).
  RELAY_TOKEN_SECRET: z.string().min(32).optional(),
  RELAY_PUBLIC_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith('wss://') || value.startsWith('ws://'), {
      message: 'RELAY_PUBLIC_URL debe ser una URL WebSocket (wss:// en produccion)',
    })
    .optional(),
  // KEY DE PLATAFORMA de OpenAI para la TRANSCRIPCION DE VOZ del Playground (POST /v1/voz/
  // transcribir -> whisper-1). Es una key del OPERADOR, no BYOK: el dictado es una capacidad de la
  // consola, no del agente del usuario. OPCIONAL con el patron de siempre: si falta, el endpoint
  // responde 501 VOZ_NO_DISPONIBLE y la consola oculta el boton de dictado. La key vive SOLO en el
  // backend: jamas viaja a la consola, ni a logs, ni a mensajes de error.
  OPENAI_API_KEY: z.string().min(1).optional(),
  // PUERTO del LISTENER INTERNO del backend para la AUTORIDAD DE COORDINACION del relay (B-1): uso unico
  // del jti y lock por conexion. Es un segundo listener, SEPARADO del publico (PORT), que Railway NO
  // mapea al dominio publico: solo es alcanzable por la RED PRIVADA (`backend.railway.internal:<puerto>`)
  // desde el servicio relay. Aditivo y opcional: si el relay no esta configurado (sin RELAY_TOKEN_SECRET)
  // este listener no arranca. Default 3001; se puede cambiar por env.
  RELAY_INTERNAL_PORT: z.coerce.number().int().positive().max(65535).default(3001),
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
