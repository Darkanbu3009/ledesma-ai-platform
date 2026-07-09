/**
 * ALERTA POR CORREO DE NUEVAS SOLICITUDES DE UPGRADE (monetizacion, aditivo). Cuando un usuario crea
 * una solicitud NUEVA por POST /v1/upgrade-requests (fila real insertada, no un reintento deduplicado),
 * se avisa al OPERADOR por correo via Resend para que se entere del lead sin tener que consultar la
 * tabla. Destinatario: UPGRADE_ALERTS_EMAIL (env var, NUNCA hardcodeado). Remitente: el mismo ya
 * configurado para el backend (RESEND_WELCOME_FROM_EMAIL).
 *
 * Mismo contrato best-effort que el correo de bienvenida (welcome-email.ts), cuyo envio compartido
 * reusa (resend-client.ts):
 *  - Todo es BEST-EFFORT: si falta config (UPGRADE_ALERTS_EMAIL / RESEND_API_KEY / remitente) o si
 *    Resend falla/da timeout, se LOGUEA y se sigue. La alerta JAMAS bloquea ni condiciona el registro
 *    del lead (que ya quedo en la tabla). enviarAlertaUpgrade NUNCA lanza.
 *  - Si UPGRADE_ALERTS_EMAIL no esta configurada, el aviso se loguea UNA sola vez (no en cada POST).
 *  - Se dispara solo tras un insert REAL (created=true): el route no la llama en el camino
 *    anti-duplicado (ver routes/upgrade-requests.ts).
 */

import { enviarViaResend, type EmailLogger, type CorreoSaliente } from './resend-client.js';

/** Escapa los caracteres especiales de HTML (el email del solicitante es un dato de usuario). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmisorAlertaUpgradeDeps {
  /** Key de la API de Resend. Si falta, no se puede enviar: se loguea y se omite. */
  resendApiKey?: string;
  /** Remitente ya configurado del backend (RESEND_WELCOME_FROM_EMAIL). Si falta, no se envia. */
  fromEmail?: string;
  /** Destinatario operador (UPGRADE_ALERTS_EMAIL). Si falta, no se envia y se avisa UNA sola vez. */
  alertsEmail?: string;
  logger: EmailLogger;
  /** Inyectable para tests: implementacion de fetch. Default: fetch global. */
  fetchImpl?: typeof fetch;
}

export interface AlertaUpgradeParams {
  /** Dueno de la solicitud (sub del JWT). Siempre presente: identifica al lead aunque no haya email. */
  ownerId: string;
  /** Email del solicitante, del JWT verificado (AuthenticatedUser.email). Puede ser null. */
  ownerEmail: string | null;
  /** Plan solicitado ('pro' | 'autonomous'). */
  requestedTier: string;
  /** Feature que disparo la solicitud, tal como quedo en la tabla. null = CTA generico. */
  featureContext: string | null;
  /** Fecha de creacion de la fila (ISO), tal como la devolvio el insert. */
  createdAt: string;
}

/**
 * Arma el correo de alerta (puro, sin efectos, testeable sin red). Asunto: "Nueva solicitud de
 * upgrade" + identificador del solicitante (su email si el token lo trae; si no, el owner_id).
 * Cuerpo: email del usuario, owner_id, plan solicitado, feature de origen y fecha -- lo que la
 * tabla ya guarda mas el email ya disponible en el request, sin queries nuevas.
 */
export function construirCorreoAlertaUpgrade(params: AlertaUpgradeParams): CorreoSaliente {
  const identificador = params.ownerEmail?.trim() || params.ownerId;
  const email = params.ownerEmail?.trim() || 'sin email en el token';
  const feature = params.featureContext ?? 'sin feature especifica (CTA generico)';

  const subject = `Nueva solicitud de upgrade: ${identificador}`;

  const text = [
    'Un usuario solicito acceso a un plan superior.',
    '',
    `Email del usuario: ${email}`,
    `Owner ID: ${params.ownerId}`,
    `Plan solicitado: ${params.requestedTier}`,
    `Origen (feature): ${feature}`,
    `Fecha: ${params.createdAt}`,
    '',
    'La solicitud quedo registrada como pending en upgrade_requests (panel de admin).',
  ].join('\n');

  const filas: Array<[string, string]> = [
    ['Email del usuario', email],
    ['Owner ID', params.ownerId],
    ['Plan solicitado', params.requestedTier],
    ['Origen (feature)', feature],
    ['Fecha', params.createdAt],
  ];
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;">',
    '<h2 style="font-size:18px;margin:0 0 12px;">Nueva solicitud de upgrade</h2>',
    '<p style="margin:0 0 16px;">Un usuario solicito acceso a un plan superior.</p>',
    '<table style="border-collapse:collapse;font-size:14px;">',
    ...filas.map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;">${escapeHtml(k)}</td><td style="padding:2px 0;">${escapeHtml(v)}</td></tr>`,
    ),
    '</table>',
    '<p style="color:#6b7280;font-size:13px;margin:16px 0 0;">La solicitud quedo registrada como pending en upgrade_requests (panel de admin).</p>',
    '</div>',
  ].join('');

  return { subject, text, html };
}

export interface EmisorAlertaUpgrade {
  /**
   * Envia (best-effort) la alerta al operador tras un insert real. NUNCA lanza: cualquier fallo
   * (falta de config, Resend caido o con timeout) se loguea y se traga. El registro del lead
   * conserva su resultado y su respuesta pase lo que pase.
   */
  enviarAlertaUpgrade(params: AlertaUpgradeParams): Promise<void>;
}

/**
 * Crea el emisor de la alerta de upgrade. Con estado minimo: recuerda si ya aviso que falta
 * UPGRADE_ALERTS_EMAIL para loguearlo UNA sola vez (y no en cada solicitud).
 */
export function crearEmisorAlertaUpgrade(deps: EmisorAlertaUpgradeDeps): EmisorAlertaUpgrade {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let avisoDestinoFaltante = false;

  async function enviarAlertaUpgrade(params: AlertaUpgradeParams): Promise<void> {
    try {
      // 1. Destinatario operador: sin UPGRADE_ALERTS_EMAIL la feature esta apagada. Se avisa UNA vez.
      if (!deps.alertsEmail) {
        if (!avisoDestinoFaltante) {
          avisoDestinoFaltante = true;
          deps.logger.warn(
            {},
            'alerta de upgrade desactivada: falta UPGRADE_ALERTS_EMAIL (se avisa una sola vez)',
          );
        }
        return;
      }

      // 2. Config de Resend: sin key o sin remitente no se puede enviar. No es un error: se loguea.
      if (!deps.resendApiKey || !deps.fromEmail) {
        deps.logger.warn(
          {},
          'alerta de upgrade omitida: falta configuracion de email (RESEND_API_KEY / RESEND_WELCOME_FROM_EMAIL)',
        );
        return;
      }

      // 3. Armar el correo (puro, sin red) y enviarlo con el envio compartido de Resend.
      const correo = construirCorreoAlertaUpgrade(params);
      await enviarViaResend(
        fetchImpl,
        deps.resendApiKey,
        deps.fromEmail,
        deps.alertsEmail,
        correo,
        deps.logger,
        'la alerta de upgrade',
      );
    } catch (err) {
      // BEST-EFFORT TOTAL: cualquier fallo (red, Resend, armado) se loguea y se traga. La alerta es
      // un efecto secundario; jamas debe romper el registro del lead (que ya quedo en la tabla).
      deps.logger.error(
        { err: err instanceof Error ? err.message : 'desconocido' },
        'fallo al enviar la alerta de upgrade (se ignora, best-effort)',
      );
    }
  }

  return { enviarAlertaUpgrade };
}
