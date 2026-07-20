import type { Job, Sql } from '@ledesma-platform/shared';
import { isRecipeJobPayload, isSitioJobPayload } from '@ledesma-platform/shared';
import type { Logger } from './logger.js';

/**
 * ALERTAS DE FALLO por correo (Fase 5, aditivo). Cuando el worker marca un job como FAILED de forma
 * DEFINITIVA (fallo permanente o reintentos agotados), avisamos por correo al DUENO del job. Hoy un
 * fallo solo es visible entrando a /actividad; esto lo empuja al email del owner, sobrio y sin spam.
 *
 * Diseno:
 *  - Todo es BEST-EFFORT: si falta la config (RESEND_API_KEY / remitente), si no se encuentra el email
 *    del owner, o si Resend falla/da timeout, se LOGUEA y se sigue. Una alerta JAMAS bloquea el cierre
 *    del job ni tumba el loop del worker (las alertas son una mejora, no una dependencia dura).
 *  - Envio via la API HTTP de Resend con un fetch (sin SDK nuevo) y timeout corto (5s).
 *  - ANTI-SPAM: cooldown en memoria por owner (max 1 correo cada 15 min); los demas se loguean. El
 *    worker es un solo proceso, asi que un Map en memoria basta (se resetea al redesplegar, aceptable
 *    para alertas best-effort).
 *  - NUNCA se incluye el `payload` del job (mensajes del usuario / pasos de receta): solo el nombre del
 *    agente, el tipo, la fecha, el error TRUNCADO y el enlace a /actividad.
 */

/** Tope de caracteres del error incluido en el correo (no volcamos el last_error entero). */
export const MAX_ERROR_CHARS = 300;

/** Ventana del cooldown anti-rafaga por owner (ms): max 1 correo de alerta por owner en este lapso. */
export const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

/** Endpoint de la API de Resend para enviar correos. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Timeout de pared del POST a Resend (ms). Best-effort: no bloquea el cierre del job. */
const RESEND_TIMEOUT_MS = 5_000;

/** Trunca el texto a `max` caracteres, agregando una elipsis si se corto. Tolerante a null/undefined. */
export function truncarError(texto: string | null | undefined, max = MAX_ERROR_CHARS): string {
  const s = (texto ?? '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

/** Tipo LEGIBLE del job para el correo, inferido del payload (sin exponerlo). */
export function tipoDeJobLegible(job: Job): 'receta' | 'mensaje' | 'conexion de sitio' {
  if (isSitioJobPayload(job.payload)) return 'conexion de sitio';
  return isRecipeJobPayload(job.payload) ? 'receta' : 'mensaje';
}

/** Escapa los caracteres especiales de HTML (el nombre del agente y el error son datos de usuario). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatea una fecha ISO a `YYYY-MM-DD HH:MM UTC` (estable, sin depender del locale). */
function formatearFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  );
}

/** Normaliza la base de la consola (quita barras finales) y arma el enlace a /actividad. */
function urlActividad(consoleBaseUrl: string): string {
  return `${consoleBaseUrl.replace(/\/+$/, '')}/actividad`;
}

export interface CorreoFallo {
  subject: string;
  text: string;
  html: string;
}

/**
 * Arma el correo SOBRIO de alerta de fallo (asunto + texto + html), en espanol. PURO y sin efectos:
 * testeable sin red. NUNCA incluye el payload del job; solo el nombre del agente, el tipo, la fecha, el
 * error TRUNCADO (300 chars) y, si hay CONSOLE_BASE_URL, el enlace a /actividad.
 */
export function construirCorreoFallo(params: {
  agentName: string;
  tipo: 'receta' | 'mensaje' | 'conexion de sitio';
  reason: string;
  fechaISO: string;
  consoleBaseUrl?: string;
}): CorreoFallo {
  const { agentName, tipo, reason, fechaISO } = params;
  const errorTruncado = truncarError(reason);
  const fecha = formatearFecha(fechaISO);
  const enlace = params.consoleBaseUrl ? urlActividad(params.consoleBaseUrl) : null;

  const subject = `Fallo la ejecucion de tu agente ${agentName}`;

  const lineasTexto = [
    `Fallo la ejecucion de tu agente ${agentName}.`,
    '',
    'Una ejecucion autonoma termino con error (tras agotar los reintentos o por un fallo permanente).',
    '',
    `Agente: ${agentName}`,
    `Tipo: ${tipo}`,
    `Fecha: ${fecha}`,
    `Error: ${errorTruncado}`,
    '',
    ...(enlace ? [`Ver la actividad: ${enlace}`, ''] : []),
    'Este correo es automatico. No incluye el contenido de tus mensajes.',
  ];
  const text = lineasTexto.join('\n');

  const agentNameHtml = escapeHtml(agentName);
  const errorHtml = escapeHtml(errorTruncado);
  const enlaceHtml = enlace ? escapeHtml(enlace) : null;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;">',
    `<h2 style="font-size:18px;margin:0 0 12px;">Fallo la ejecucion de tu agente ${agentNameHtml}</h2>`,
    '<p style="margin:0 0 16px;">Una ejecucion autonoma termino con error tras agotar los reintentos o por un fallo permanente. Es un aviso: no hace falta que hagas nada.</p>',
    '<table style="border-collapse:collapse;font-size:14px;margin:0 0 16px;">',
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Agente</td><td style="padding:4px 0;">${agentNameHtml}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Tipo</td><td style="padding:4px 0;">${tipo}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Fecha</td><td style="padding:4px 0;">${fecha}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;">Error</td><td style="padding:4px 0;"><code style="white-space:pre-wrap;">${errorHtml}</code></td></tr>`,
    '</table>',
    ...(enlaceHtml
      ? [`<p style="margin:0 0 16px;"><a href="${enlaceHtml}" style="color:#2563eb;">Ver la actividad</a></p>`]
      : []),
    '<p style="color:#6b7280;font-size:12px;margin:0;">Este correo es automatico. No incluye el contenido de tus mensajes.</p>',
    '</div>',
  ].join('');

  return { subject, text, html };
}

export interface NotificadorFallosDeps {
  /** Key de la API de Resend. Si falta (undefined), no se puede notificar: se loguea y se omite. */
  resendApiKey?: string;
  /** Remitente verificado en Resend (ej. alertas@send.ledesma-ai-labs.com). Si falta, no se notifica. */
  fromEmail?: string;
  /** Base de la consola para el enlace a /actividad. Opcional: sin ella el correo va sin enlace. */
  consoleBaseUrl?: string;
  /** Lee el email del owner (auth.users). null si no hay / no se pudo. NO debe lanzar. */
  getOwnerEmail(ownerId: string): Promise<string | null>;
  /** Lee el nombre del agente (best-effort). null si no se pudo; el correo cae al agentId. NO debe lanzar. */
  getAgentName(agentId: string): Promise<string | null>;
  logger: Logger;
  /** Inyectable para tests: implementacion de fetch. Default: fetch global. */
  fetchImpl?: typeof fetch;
  /** Inyectable para tests: reloj en ms. Default: Date.now. */
  now?: () => number;
  /** Ventana del cooldown en ms. Default: ALERT_COOLDOWN_MS (15 min). */
  cooldownMs?: number;
}

export interface NotificadorFallos {
  /** Notifica (best-effort) un fallo DEFINITIVO del job. Nunca lanza. */
  notificarFallo(job: Job, reason: string): Promise<void>;
}

/**
 * Crea el notificador de fallos. Mantiene el estado del cooldown (Map por owner) en el closure, asi que
 * hay UNA instancia por proceso (se cablea en index.ts). En tests se construye una instancia fresca por
 * caso, con fetch/now inyectados.
 */
export function crearNotificadorFallos(deps: NotificadorFallosDeps): NotificadorFallos {
  const ultimoEnvioPorOwner = new Map<string, number>();
  const cooldownMs = deps.cooldownMs ?? ALERT_COOLDOWN_MS;
  const now = deps.now ?? ((): number => Date.now());
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function notificarFallo(job: Job, reason: string): Promise<void> {
    try {
      // 1. Config de email: sin key o sin remitente no se puede notificar. No es un error: se loguea.
      if (!deps.resendApiKey || !deps.fromEmail) {
        deps.logger.warn(
          'alerta de fallo omitida: falta configuracion de email (RESEND_API_KEY / RESEND_FROM_EMAIL)',
          { jobId: job.id },
        );
        return;
      }

      // 2. Cooldown anti-rafaga por owner: si ya se le envio dentro de la ventana, se loguea y se omite.
      const t = now();
      const ultimo = ultimoEnvioPorOwner.get(job.ownerId);
      if (ultimo !== undefined && t - ultimo < cooldownMs) {
        deps.logger.info('alerta de fallo omitida por cooldown (rafaga del mismo owner)', {
          jobId: job.id,
          ownerId: job.ownerId,
        });
        return;
      }

      // 3. Email del owner (best-effort). Sin destinatario no hay a quien avisar.
      const email = await deps.getOwnerEmail(job.ownerId);
      if (!email) {
        deps.logger.warn('alerta de fallo omitida: no se encontro el email del owner', {
          jobId: job.id,
          ownerId: job.ownerId,
        });
        return;
      }

      // 4. Nombre del agente (best-effort; cae al id si no se pudo leer). Un job de sitios (V026) no
      //    tiene agente: se etiqueta con un nombre fijo legible en vez de consultar la base.
      const agentName =
        job.agentId === null
          ? 'Sitios conectados'
          : ((await deps.getAgentName(job.agentId)) ?? job.agentId);

      // 5. Armar el correo (nunca incluye el payload) y enviarlo.
      const correo = construirCorreoFallo({
        agentName,
        tipo: tipoDeJobLegible(job),
        reason,
        fechaISO: new Date(t).toISOString(),
        ...(deps.consoleBaseUrl !== undefined ? { consoleBaseUrl: deps.consoleBaseUrl } : {}),
      });

      // Marca el cooldown AL COMPROMETERSE a enviar (antes del POST): aunque Resend falle, no reintentamos
      // en rafaga (anti-spam). Solo se marca cuando de verdad hay config + email (si faltaban, no cuenta).
      ultimoEnvioPorOwner.set(job.ownerId, t);

      await enviarViaResend(fetchImpl, deps.resendApiKey, deps.fromEmail, email, correo, deps.logger, job.id);
    } catch (err) {
      // BEST-EFFORT TOTAL: cualquier fallo (red, Resend, lectura del email) se loguea y se traga. El job
      // ya quedo 'failed'; una alerta jamas debe romper el cierre del job ni el loop del worker.
      deps.logger.error('fallo al enviar la alerta de fallo del job (se ignora, best-effort)', {
        jobId: job.id,
        err: err instanceof Error ? err.message : 'desconocido',
      });
    }
  }

  return { notificarFallo };
}

/**
 * POST a la API de Resend con timeout de pared (AbortController + setTimeout). No lanza en el camino
 * feliz ni ante un status no-2xx (loguea); una excepcion de red se propaga al try/catch de notificarFallo.
 */
async function enviarViaResend(
  fetchImpl: typeof fetch,
  apiKey: string,
  from: string,
  to: string,
  correo: CorreoFallo,
  logger: Logger,
  jobId: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: correo.subject,
        text: correo.text,
        html: correo.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      logger.error('Resend respondio con error al enviar la alerta de fallo', {
        jobId,
        status: res.status,
        detalle: truncarError(detalle, 200),
      });
      return;
    }
    // Consumir el cuerpo (aunque no lo usemos) libera la conexion del pool de fetch de inmediato, en vez
    // de retenerla hasta el GC de la Response. Simetrico con la rama de error de arriba.
    await res.text().catch(() => undefined);
    logger.info('alerta de fallo enviada al owner', { jobId });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lee el email del owner desde `auth.users` (Supabase). owner_id (sub del JWT) = auth.users.id; la tabla
 * `profiles` NO tiene columna email. Best-effort: si el rol del pooler (DATABASE_URL) no puede leer el
 * esquema `auth`, o no hay fila, devuelve null (se loguea) y la alerta se omite SIN tumbar el worker.
 * Requiere que el rol de DATABASE_URL tenga SELECT sobre auth.users (ver docs/despliegue-worker.md).
 */
export async function leerEmailOwner(sql: Sql, ownerId: string, logger: Logger): Promise<string | null> {
  try {
    const rows = await sql<{ email: string | null }[]>`
      select email from auth.users where id = ${ownerId}
    `;
    return rows[0]?.email ?? null;
  } catch (err) {
    logger.warn('no se pudo leer el email del owner (auth.users); no se notificara este fallo', {
      ownerId,
      err: err instanceof Error ? err.message : 'desconocido',
    });
    return null;
  }
}

/**
 * Lee el nombre del agente (best-effort). Devuelve null si no existe o no se pudo leer (el correo usara
 * el agentId como fallback). No lanza.
 */
export async function leerNombreAgente(sql: Sql, agentId: string, logger: Logger): Promise<string | null> {
  try {
    const rows = await sql<{ name: string }[]>`
      select name from agents where id = ${agentId}
    `;
    return rows[0]?.name ?? null;
  } catch (err) {
    logger.warn('no se pudo leer el nombre del agente; el correo de alerta usara el id', {
      agentId,
      err: err instanceof Error ? err.message : 'desconocido',
    });
    return null;
  }
}
