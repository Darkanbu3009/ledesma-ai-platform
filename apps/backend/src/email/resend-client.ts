/**
 * CLIENTE COMPARTIDO de Resend del backend: el POST a la API HTTP de Resend con timeout de pared,
 * extraido de welcome-email.ts para que la ALERTA DE UPGRADE (upgrade-alert-email.ts) reuse el MISMO
 * envio en vez de replicarlo por tercera vez (la replica worker -> backend fue forzada porque el worker
 * no es importable; dentro del backend no hay excusa para duplicar). Sin SDK nuevo: fetch + AbortController.
 *
 * Contrato del emisor: NO lanza en el camino feliz ni ante un status no-2xx (loguea y retorna); una
 * excepcion de red/timeout SI se propaga, para que el try/catch best-effort del llamador la trague y
 * la loguee con su propio contexto. Mismo comportamiento que tenia enviarViaResend en welcome-email.ts.
 */

/** Endpoint de la API de Resend para enviar correos (mismo que usa el worker en sus alertas). */
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Timeout de pared del POST a Resend (ms). Best-effort: no bloquea ni demora la respuesta del endpoint. */
export const RESEND_TIMEOUT_MS = 5_000;

/**
 * Logger minimo que necesitan los emisores de correo (compatible con el logger de Fastify/pino:
 * `(meta, msg)`). Vive aca para no acoplar los modulos de email a los tipos de Fastify y poder
 * mockearlo en tests.
 */
export interface EmailLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
  error(meta: Record<string, unknown>, msg: string): void;
}

/** Un correo listo para enviar (asunto + cuerpo en texto y html). */
export interface CorreoSaliente {
  subject: string;
  text: string;
  html: string;
}

/** Trunca un texto a `max` caracteres (para no volcar respuestas largas de Resend en los logs). */
function truncar(texto: string, max = 200): string {
  const s = texto.trim();
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

/**
 * POST a la API de Resend con timeout de pared (AbortController + setTimeout). `descripcion` es el
 * nombre del correo para los logs (p.ej. 'el correo de bienvenida', 'la alerta de upgrade').
 */
export async function enviarViaResend(
  fetchImpl: typeof fetch,
  apiKey: string,
  from: string,
  to: string,
  correo: CorreoSaliente,
  logger: EmailLogger,
  descripcion: string,
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
      logger.error(
        { status: res.status, detalle: truncar(detalle) },
        `Resend respondio con error al enviar ${descripcion}`,
      );
      return;
    }
    // Consumir el cuerpo libera la conexion del pool de fetch de inmediato (simetrico con la rama de error).
    await res.text().catch(() => undefined);
    logger.info({}, `${descripcion} se envio correctamente`);
  } finally {
    clearTimeout(timer);
  }
}
