import { z } from 'zod';
import {
  HISTORIAL_PASOS_DEFAULT,
  HISTORIAL_PASOS_MAX,
  HISTORIAL_PASOS_MIN,
} from './costo-modelo.js';

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
  // PRESUPUESTO DE LA TAREA WEB (pasos y tiempo), separado de las corridas de agente simple y de
  // receta (que siguen con RUN_TIMEOUT_SECONDS). Mismo patron que WORKER_POLL_INTERVAL_MS: numerica
  // opcional con default; un valor fuera de rango hace fallar el arranque como cualquier variable
  // mal formada.
  //   TAREA_WEB_MAX_STEPS: cap duro de pasos del agente de navegacion (Stagehand maxSteps). Acotado
  //   a 10..300: menos de 10 no completa ni una tarea trivial y mas de 300 excede lo que cabe en el
  //   deadline de pared.
  TAREA_WEB_MAX_STEPS: z.coerce.number().int().min(10).max(300).default(120),
  //   TAREA_WEB_TIMEOUT_SECONDS: deadline de pared SOLO para jobs de tipo tarea_web. El maximo es
  //   el timeout de la sesion de tarea en Browserbase (TAREA_SESSION_TIMEOUT_SECONDS = 2700 s,
  //   browserbase.ts) menos un margen de 120 s: la sesion remota jamas debe morir antes que nuestro
  //   deadline.
  TAREA_WEB_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(2580).default(1500),
  //   TAREA_WEB_TOOL_TIMEOUT_SECONDS: techo por LLAMADA DE TOOL del agente de navegacion
  //   (Stagehand toolTimeout). Sin el, una tool colgada (un act que no resuelve, un extract sobre
  //   una pagina enorme) se come el deadline de pared entero sin que el agente pueda corregir.
  //   Acotado a 30..300 s: menos de 30 corta acciones legitimas de un sitio lento y mas de 300 ya
  //   no deja margen para que el agente reaccione dentro del deadline.
  TAREA_WEB_TOOL_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(300).default(90),
  //   TAREA_WEB_OBSERVADOR_PASOS: enciende el OBSERVADOR de pasos (lee del DOM las estrategias de
  //   localizacion mientras el motor corre) Y con el la PROMOCION AUTOMATICA A RECETAS, que es una
  //   decision de producto distinta y de radio mayor. APAGADO por defecto. El costo es una conexion
  //   CDP por ACCION CON ELEMENTO RESUELTO, no por paso (goto, screenshot, extract o think no abren
  //   ninguna), y desde la percepcion (27 jul 2026) esa conexion ya se paga de forma incondicional
  //   despues de cada paso que toca la pagina: encenderlo DUPLICA una lectura que ya existe. El
  //   ATLAS DE SITIOS no depende de este flag (lo alimenta la percepcion). Ver README del worker.
  TAREA_WEB_OBSERVADOR_PASOS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
  //   TAREA_WEB_SCREENSHOTS: CUANDO se toma una captura de pantalla durante la corrida. Una imagen
  //   es lo mas caro que entra al contexto del modelo y, paso a paso, suele ser la MISMA pagina.
  //     'cambios' (default): solo si la URL o el titulo cambiaron desde la observacion anterior.
  //     'minimo':  solo la primera de la corrida y las que preceden a una accion irreversible.
  //     'siempre': cada vez que el agente la pide (comportamiento historico, sin intervencion).
  TAREA_WEB_SCREENSHOTS: z.enum(['siempre', 'cambios', 'minimo']).default('cambios'),
  //   TAREA_WEB_BARRERA_IDENTIDAD: la BARRERA DE IDENTIDAD DEL ELEMENTO (barrera-identidad.ts), que
  //   responde lo que verificarAccion nunca se pregunta: ¿el elemento que se va a accionar es el que
  //   corresponde? Se interpone antes de que un paso de receta actue sobre el DOM y, en el motor
  //   libre, en la guardia de accion, antes de que la accion irreversible salga al navegador.
  //     'observacion' (default): EVALUA y REGISTRA su veredicto en la trayectoria
  //       (identidad:permitida / identidad:habria_bloqueado + motivo), y NO BLOQUEA NADA. El paso
  //       sigue su camino exactamente como sin la barrera: es telemetria, no control. Es el modo con
  //       el que se MIDE cuantos pasos reales bloquearia antes de encenderla.
  //     'activa': un veredicto de bloqueo ABANDONA la receta y la tarea la termina el motor; en el
  //       motor libre se traduce al veredicto 'bloquear' que la guardia YA tiene (la accion no sale
  //       al navegador y la corrida cierra con DETENIDA_VERIFICACION, sin un cierre nuevo).
  //     'apagada': la barrera ni se evalua (cero lecturas extra, cero pasos sinteticos).
  //   COSTO en observacion y en activa: una conexion CDP por CORRIDA, no por paso. La comprobacion de
  //   la clase del elemento es pura (las clases corroboradas del dominio ya se leyeron al arrancar la
  //   tarea) y el nombre accesible se lee SOLO en la accion irreversible.
  TAREA_WEB_BARRERA_IDENTIDAD: z.enum(['apagada', 'observacion', 'activa']).default('observacion'),
  //   TAREA_WEB_GUARDIA_SIN_INTENCION: la GUARDIA CON CRITERIO GENERICO (verificacion.ts), que cierra
  //   la INVERSION DEL DEFAULT: hasta ahora, un objetivo cuya intencion no cae en el vocabulario
  //   cerrado de ocho verbos dejaba pasar TODAS las acciones sin comparar nada (tarea-web.ts, el
  //   `return permitir` sin verbo), y una intencion reconocida que no exige parametros (borrar,
  //   publicar) resolvia 'ejecutar' con CERO comparaciones. Las dos cosas tratan como reversible algo
  //   que el sistema no entendio.
  //     'observacion' (default): EVALUA y REGISTRA cuantas acciones HABRIAN sido detenidas (paso
  //       guardia_generica:habria_detenido en la trayectoria y el escalar del que /actividad deriva
  //       su aviso), y NO DETIENE NINGUNA. Es el modo con el que se MIDE el cambio antes de aplicarlo.
  //     'activa': la detencion por cero comparaciones corta la corrida como cualquier otra
  //       (DETENIDA_VERIFICACION con motivo sinEvidenciaParaComparar).
  //     'apagada': ni se evalua; el comportamiento es el anterior a este cambio, caracter por caracter.
  //   QUE NO CAMBIA EN NINGUN MODO: la navegacion y la lectura reconocidas (esNavegacionDeSoloLectura)
  //   quedan exentas, y el camino de `enviar` no se toca -- ese verbo exige destinatario, asi que
  //   siempre hay al menos una comparacion y esta regla no puede dispararse sobre el.
  TAREA_WEB_GUARDIA_SIN_INTENCION: z
    .enum(['apagada', 'observacion', 'activa'])
    .default('observacion'),
  //   TAREA_WEB_HISTORIAL_PASOS: cuantos pasos de ida y vuelta se reenvian al modelo en cada
  //   llamada. El objetivo original va SIEMPRE, este numero acota solo la conversacion posterior.
  //   Sin la ventana, el bucle reenvia la corrida entera en cada paso y el costo crece con el
  //   cuadrado de los pasos. Acotado a 3..40: con menos de 3 el agente pierde el hilo de lo que
  //   acaba de hacer y con mas de 40 la ventana ya no acota nada dentro de TAREA_WEB_MAX_STEPS.
  TAREA_WEB_HISTORIAL_PASOS: z.coerce
    .number()
    .int()
    .min(HISTORIAL_PASOS_MIN)
    .max(HISTORIAL_PASOS_MAX)
    .default(HISTORIAL_PASOS_DEFAULT),
  // ATLAS DE SITIOS (V040): secreto con el que el worker calcula el HMAC del ORIGEN de cada
  // observacion, lo unico que permite contar cuantos usuarios DISTINTOS produjeron una estructura sin
  // saber quienes son. OPCIONAL a proposito: el atlas queda ACTIVO desde el merge, sin flags, asi que
  // un despliegue que no agregue nada tiene que poder contar igual. Sin esta variable la clave se
  // DERIVA de VAULT_SECRET con una etiqueta de separacion de dominio (claveDelAtlas, atlas-sitios.ts):
  // derivacion de una sola via, la clave del atlas jamas permite reconstruir el secreto de la boveda.
  // Configurarla despues solo hace que los origenes se vuelvan a contar desde cero.
  ATLAS_SITIOS_SECRET: z.string().min(32).optional(),
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
