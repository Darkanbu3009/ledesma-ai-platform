/**
 * CORREO DE BIENVENIDA (Fase 2, onboarding, aditivo). Cuando un usuario NUEVO completa su registro
 * (perfil + suscripcion free) se le envia UN correo calido que lo invita a volver y poner su primer
 * agente a funcionar, con un enlace a la consola (al panel donde vive el checklist de primeros pasos).
 * Es retencion: traerlo de vuelta al momento aha.
 *
 * Diseno (mismo patron que las ALERTAS DE FALLO del worker, apps/worker/src/alertas.ts, sin duplicarlo
 * ni tocarlo -- el worker no es importable desde el backend, asi que se REPLICA el patron minimo aca):
 *  - Todo es BEST-EFFORT: si falta la config (RESEND_API_KEY / remitente), si no hay email del usuario,
 *    o si Resend falla/da timeout, se LOGUEA y se sigue. El correo JAMAS bloquea ni condiciona el
 *    registro (la bienvenida es una mejora, no una dependencia dura). enviarBienvenida NUNCA lanza.
 *  - Envio via la API HTTP de Resend con un fetch (sin SDK nuevo) y timeout corto (5s).
 *  - Se dispara UNA sola vez, tras el registro EXITOSO (created=true). El route no lo llama en
 *    re-registro idempotente ni en login (ver routes/registration.ts).
 */

import { construirCorreoBienvenida } from './welcome-email-content.js';
import { enviarViaResend, type EmailLogger } from './resend-client.js';

/**
 * Logger minimo que necesita el emisor. Alias del EmailLogger compartido (resend-client.ts), que se
 * extrajo de aca cuando la alerta de upgrade paso a reusar el mismo envio; se conserva el nombre para
 * no tocar a los consumidores existentes.
 */
export type WelcomeLogger = EmailLogger;

export interface EmisorBienvenidaDeps {
  /** Key de la API de Resend. Si falta (undefined), no se puede enviar: se loguea y se omite. */
  resendApiKey?: string;
  /** Remitente verificado en Resend para la bienvenida (ej. hola@send.ledesma-ai-labs.com). Si falta, no se envia. */
  fromEmail?: string;
  /** Base de la consola para el enlace al panel. Opcional: sin ella el correo va sin enlace (best-effort). */
  consoleBaseUrl?: string;
  logger: WelcomeLogger;
  /** Inyectable para tests: implementacion de fetch. Default: fetch global. */
  fetchImpl?: typeof fetch;
}

export interface EnviarBienvenidaParams {
  /** Email del usuario recien registrado (viene del JWT en el contexto del registro). null/'' -> se omite. */
  email: string | null | undefined;
  /** Nombre del usuario (para personalizar el saludo). Opcional: sin el, el saludo es generico. */
  fullName?: string;
}

export interface EmisorBienvenida {
  /**
   * Envia (best-effort) el correo de bienvenida tras un registro exitoso. NUNCA lanza: cualquier fallo
   * (falta de config, email ausente, Resend caido o con timeout) se loguea y se traga. El registro
   * conserva su resultado y su respuesta pase lo que pase.
   */
  enviarBienvenida(params: EnviarBienvenidaParams): Promise<void>;
}

/**
 * Crea el emisor de la bienvenida. Sin estado (a diferencia del notificador de fallos del worker, que
 * lleva un cooldown por owner): la bienvenida se dispara una sola vez por registro, asi que el control
 * anti-duplicado vive en el llamador (solo se invoca cuando result.created === true).
 */
export function crearEmisorBienvenida(deps: EmisorBienvenidaDeps): EmisorBienvenida {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function enviarBienvenida(params: EnviarBienvenidaParams): Promise<void> {
    try {
      // 1. Config de email: sin key o sin remitente no se puede enviar. No es un error: se loguea.
      if (!deps.resendApiKey || !deps.fromEmail) {
        deps.logger.warn(
          {},
          'correo de bienvenida omitido: falta configuracion de email (RESEND_API_KEY / RESEND_WELCOME_FROM_EMAIL)',
        );
        return;
      }

      // 2. Destinatario: sin email no hay a quien darle la bienvenida (se loguea SIN el email, es PII).
      const email = params.email?.trim();
      if (!email) {
        deps.logger.warn({}, 'correo de bienvenida omitido: el usuario recien registrado no tiene email');
        return;
      }

      // 3. Armar el correo (puro, sin red) y enviarlo.
      const correo = construirCorreoBienvenida({
        ...(params.fullName !== undefined ? { fullName: params.fullName } : {}),
        ...(deps.consoleBaseUrl !== undefined ? { consoleBaseUrl: deps.consoleBaseUrl } : {}),
      });

      await enviarViaResend(
        fetchImpl,
        deps.resendApiKey,
        deps.fromEmail,
        email,
        correo,
        deps.logger,
        'el correo de bienvenida',
      );
    } catch (err) {
      // BEST-EFFORT TOTAL: cualquier fallo (red, Resend, armado) se loguea y se traga. El correo es un
      // efecto secundario; jamas debe romper el registro.
      deps.logger.error(
        { err: err instanceof Error ? err.message : 'desconocido' },
        'fallo al enviar el correo de bienvenida (se ignora, best-effort)',
      );
    }
  }

  return { enviarBienvenida };
}
