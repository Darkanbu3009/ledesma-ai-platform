// IMPORT DE TIPOS (type-only): el repositorio real (V027) se INYECTA; este modulo no carga en
// runtime el backend. Igual que sitios.ts / tarea-web.ts: los tests pasan fakes.
import type { AccionTipo, AprobacionWeb } from '@ledesma-platform/backend/aprobaciones';
import { MARCADOR_REQUIERE_APROBACION, construirSystemPromptTareaWeb } from './prompt-tarea-web.js';
import { enviarViaResend } from './alertas.js';
import type { Logger } from './logger.js';

/**
 * CHECKPOINTS DE APROBACION HUMANA (Fase 7.1e), lado worker: la logica PURA alrededor de
 * aprobaciones_web (V027). Cuando la tarea web (7.1d) detecta una accion irreversible o financiera,
 * el worker crea el checkpoint, PAUSA el job y MANTIENE VIVA la sesion de navegador; cuando el
 * humano decide, el worker re-reclama el job y este modulo arma el prompt de la reanudacion.
 *
 * RESTRICCION DURA (la razon de ser de este PR): NO existe forma de ejecutar una accion financiera
 * sin una aprobacion en estado 'aprobada'. La UNICA funcion que produce el prompt que autoriza
 * ejecutar la accion pendiente es construirReanudacionAprobada, y LANZA si la aprobacion no esta
 * 'aprobada'. No hay flag de config, env ni plan que la sortee: una pagina envenenada puede
 * instruir al agente a pagar o transferir, y la aprobacion humana es la unica mitigacion que no
 * depende de que el modelo acierte.
 */

/** Vida por defecto de una aprobacion pendiente (min). Corta a proposito: el estado del checkout
 *  no debe poder aprobarse sobre una pagina que ya no existe. Configurable via APROBACION_TTL_MINUTOS. */
export const APROBACION_TTL_MINUTOS_DEFAULT = 15;

/** Tope de la descripcion en una linea (la UI la muestra completa en el modal). */
const MAX_DESCRIPCION_CHARS = 300;

/** Descripcion de respaldo si el mensaje del agente no dejo una linea usable. */
const DESCRIPCION_FALLBACK = 'accion irreversible o financiera detectada (sin descripcion del agente)';

/**
 * Extrae la descripcion en UNA linea de la accion pendiente, del mensaje final del agente
 * (`REQUIERE_APROBACION: <tipo>: <linea>`). Tolerante: sin marcador o sin texto usable cae al
 * fallback (el checkpoint se crea igual: el bloqueo nunca depende del formato).
 */
export function extraerDescripcion(detalle: string): string {
  const idx = detalle.indexOf(MARCADOR_REQUIERE_APROBACION);
  let resto = idx >= 0 ? detalle.slice(idx + MARCADOR_REQUIERE_APROBACION.length) : detalle;
  // Quita separadores y la etiqueta de tipo si el agente la puso ("[:] financiera|irreversible [:]").
  resto = resto.replace(/^[\s:.-]+/, '').replace(/^(financiera|irreversible)\b[\s:.-]*/i, '');
  const linea = (resto.split('\n').find((l) => l.trim() !== '') ?? '').trim();
  if (linea === '') return DESCRIPCION_FALLBACK;
  return linea.length <= MAX_DESCRIPCION_CHARS ? linea : `${linea.slice(0, MAX_DESCRIPCION_CHARS)}...`;
}

/** Pistas de accion FINANCIERA en la descripcion (heuristica de respaldo si el agente no etiqueto). */
const PISTAS_FINANCIERAS =
  /\b(pag[aoue]|pago|pagar|transferencia|transferir|compra[rs]?|comprar|cobr[aoe]|tarjeta|checkout|factur|deposito|suscripcion)\b|\$|\bmxn\b|\busd\b|\beur\b/i;

/**
 * Clasifica el tipo de la accion pendiente. Primero la etiqueta EXPLICITA del agente (el prompt le
 * pide "financiera" o "irreversible" tras el marcador); si no hay, heuristica por pistas de dinero.
 * La clasificacion es INFORMATIVA para el humano: ambos tipos exigen exactamente el mismo checkpoint
 * (un error de tipo jamas debilita la garantia de aprobacion).
 */
export function clasificarTipoAccion(detalle: string): AccionTipo {
  const idx = detalle.indexOf(MARCADOR_REQUIERE_APROBACION);
  const resto = (idx >= 0 ? detalle.slice(idx + MARCADOR_REQUIERE_APROBACION.length) : detalle)
    .replace(/^[\s:.-]+/, '');
  if (/^financiera\b/i.test(resto)) return 'financiera';
  if (/^irreversible\b/i.test(resto)) return 'irreversible';
  return PISTAS_FINANCIERAS.test(detalle) ? 'financiera' : 'irreversible';
}

/** La reanudacion exigio una aprobacion 'aprobada' y no la habia. Nunca deberia alcanzarse: es la
 *  ultima linea de defensa de la restriccion dura (ver cabecera). */
export class AprobacionNoAprobadaError extends Error {
  constructor(estado: string) {
    super(
      `intento de ejecutar la accion pendiente con una aprobacion en estado '${estado}': ` +
        "solo una aprobacion 'aprobada' autoriza la ejecucion",
    );
    this.name = 'AprobacionNoAprobadaError';
  }
}

export interface PromptDeReanudacion {
  objetivo: string;
  systemPrompt: string;
}

/**
 * UNICO punto del worker (y de toda la plataforma) que produce el prompt que AUTORIZA ejecutar la
 * accion pendiente. Exige, releida de la base al reanudar, una aprobacion en estado 'aprobada';
 * cualquier otro estado LANZA AprobacionNoAprobadaError. La autorizacion es puntual: cualquier OTRA
 * accion irreversible o financiera de la misma tarea vuelve a exigir su propio checkpoint.
 */
export function construirReanudacionAprobada(
  aprobacion: AprobacionWeb,
  objetivoOriginal: string,
): PromptDeReanudacion {
  if (aprobacion.estado !== 'aprobada') {
    throw new AprobacionNoAprobadaError(aprobacion.estado);
  }
  const systemPrompt = [
    construirSystemPromptTareaWeb(),
    '',
    'REANUDACION CON APROBACION HUMANA:',
    `- El usuario APROBO explicitamente esta accion pendiente: "${aprobacion.descripcion}".`,
    '- Ejecuta ESA accion ahora, UNA sola vez, y continua la tarea hasta terminarla.',
    '- La aprobacion cubre SOLO esa accion: cualquier otra accion irreversible o financiera sigue',
    `  requiriendo el marcador ${MARCADOR_REQUIERE_APROBACION} como siempre.`,
  ].join('\n');
  const objetivo =
    `Tu tarea original era: ${objetivoOriginal}\n` +
    `Ya avanzaste hasta una accion que requeria aprobacion humana y el usuario la APROBO: ` +
    `"${aprobacion.descripcion}". La pagina sigue en el estado en que la dejaste. ` +
    'Ejecuta esa accion aprobada ahora y completa la tarea.';
  return { objetivo, systemPrompt };
}

/**
 * Prompt de la reanudacion tras un RECHAZO CON INSTRUCCION: la instruccion del humano entra como
 * ajuste del objetivo y la accion original queda PROHIBIDA. El system prompt es el MISMO de 7.1d:
 * las reglas de bloqueo siguen intactas (un nuevo intento de accion irreversible o financiera
 * crea un nuevo checkpoint).
 */
export function construirReanudacionRechazada(
  aprobacion: AprobacionWeb,
  objetivoOriginal: string,
  instruccion: string,
): PromptDeReanudacion {
  return {
    systemPrompt: construirSystemPromptTareaWeb(),
    objetivo:
      `Tu tarea original era: ${objetivoOriginal}\n` +
      `Llegaste a una accion que requeria aprobacion humana ("${aprobacion.descripcion}") y el ` +
      `usuario la RECHAZO con esta instruccion: ${instruccion}\n` +
      'NO ejecutes la accion rechazada. Continua la tarea siguiendo la instruccion del usuario; ' +
      'la pagina sigue en el estado en que la dejaste.',
  };
}

// --- NOTIFICACIONES por Resend (mismo canal que las alertas de fallo de alertas.ts) ----------------

export interface CorreoAprobacion {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function urlActividad(consoleBaseUrl: string): string {
  return `${consoleBaseUrl.replace(/\/+$/, '')}/actividad`;
}

/** Formatea una fecha ISO a `YYYY-MM-DD HH:MM UTC` (estable, sin locale; mismo criterio que alertas.ts). */
function formatearFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  );
}

/**
 * Correo SOBRIO de "tu agente necesita tu aprobacion": la descripcion en una linea (lo mismo que el
 * humano vera en el modal) + el enlace al console. Nunca incluye el objetivo de la tarea ni contenido
 * de la pagina; el screenshot solo se ve en la consola autenticada, jamas viaja por correo.
 */
export function construirCorreoAprobacionPendiente(params: {
  descripcion: string;
  dominio: string;
  expiraEnIso: string;
  consoleBaseUrl?: string;
}): CorreoAprobacion {
  const enlace = params.consoleBaseUrl ? urlActividad(params.consoleBaseUrl) : null;
  const subject = 'Tu agente necesita tu aprobacion para continuar';
  const text = [
    `Tu tarea web en ${params.dominio} llego a una accion que requiere tu aprobacion:`,
    '',
    params.descripcion,
    '',
    'La tarea esta en pausa con la pagina tal como quedo. Si no decides antes de que expire la',
    `aprobacion (${formatearFecha(params.expiraEnIso)}), la tarea se cancela sin ejecutar la accion.`,
    '',
    ...(enlace ? [`Aprobar o rechazar: ${enlace}`, ''] : []),
    'Este correo es automatico. No incluye el contenido de tus paginas.',
  ].join('\n');
  const descripcionHtml = escapeHtml(params.descripcion);
  const dominioHtml = escapeHtml(params.dominio);
  const enlaceHtml = enlace ? escapeHtml(enlace) : null;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;">',
    '<h2 style="font-size:18px;margin:0 0 12px;">Tu agente necesita tu aprobacion</h2>',
    `<p style="margin:0 0 12px;">Tu tarea web en <strong>${dominioHtml}</strong> llego a una accion que requiere tu aprobacion:</p>`,
    `<p style="margin:0 0 16px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">${descripcionHtml}</p>`,
    '<p style="margin:0 0 16px;">La tarea esta en pausa con la pagina tal como quedo. Si no decides a tiempo, se cancela sin ejecutar la accion.</p>',
    ...(enlaceHtml
      ? [`<p style="margin:0 0 16px;"><a href="${enlaceHtml}" style="color:#2563eb;">Aprobar o rechazar</a></p>`]
      : []),
    '<p style="color:#6b7280;font-size:12px;margin:0;">Este correo es automatico. No incluye el contenido de tus paginas.</p>',
    '</div>',
  ].join('');
  return { subject, text, html };
}

/** Correo de aprobacion EXPIRADA: la tarea se cancelo sin ejecutar la accion. */
export function construirCorreoAprobacionExpirada(params: {
  descripcion: string;
  consoleBaseUrl?: string;
}): CorreoAprobacion {
  const enlace = params.consoleBaseUrl ? urlActividad(params.consoleBaseUrl) : null;
  const subject = 'Una aprobacion expiro y la tarea se cancelo';
  const text = [
    'Una accion que requeria tu aprobacion expiro sin decision y la tarea se cancelo SIN ejecutarla:',
    '',
    params.descripcion,
    '',
    'Puedes volver a pedirle la tarea a tu agente cuando quieras.',
    '',
    ...(enlace ? [`Ver la actividad: ${enlace}`, ''] : []),
    'Este correo es automatico.',
  ].join('\n');
  const descripcionHtml = escapeHtml(params.descripcion);
  const enlaceHtml = enlace ? escapeHtml(enlace) : null;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;">',
    '<h2 style="font-size:18px;margin:0 0 12px;">Una aprobacion expiro</h2>',
    '<p style="margin:0 0 12px;">Una accion que requeria tu aprobacion expiro sin decision y la tarea se cancelo <strong>sin ejecutarla</strong>:</p>',
    `<p style="margin:0 0 16px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">${descripcionHtml}</p>`,
    ...(enlaceHtml
      ? [`<p style="margin:0 0 16px;"><a href="${enlaceHtml}" style="color:#2563eb;">Ver la actividad</a></p>`]
      : []),
    '<p style="color:#6b7280;font-size:12px;margin:0;">Este correo es automatico.</p>',
    '</div>',
  ].join('');
  return { subject, text, html };
}

export interface NotificadorAprobacionesDeps {
  resendApiKey?: string;
  fromEmail?: string;
  consoleBaseUrl?: string;
  /** Lee el email del owner (auth.users). null si no hay / no se pudo. NO debe lanzar. */
  getOwnerEmail(ownerId: string): Promise<string | null>;
  logger: Logger;
  /** Inyectable para tests. Default: fetch global. */
  fetchImpl?: typeof fetch;
}

export interface NotificadorAprobaciones {
  /** Avisa (best-effort) que hay una aprobacion pendiente. Nunca lanza. */
  notificarPendiente(params: {
    ownerId: string;
    jobId: string;
    dominio: string;
    descripcion: string;
    expiraEnIso: string;
  }): Promise<void>;
  /** Avisa (best-effort) que una aprobacion expiro y la tarea se cancelo. Nunca lanza. */
  notificarExpirada(params: { ownerId: string; jobId: string; descripcion: string }): Promise<void>;
}

/**
 * Notificador de aprobaciones por Resend. Mismo canal y manejo de errores que las alertas de fallo
 * (enviarViaResend de alertas.ts), pero SIN cooldown a proposito: cada checkpoint es un evento
 * unico y URGENTE (la aprobacion expira en minutos); suprimirlo por una rafaga previa de fallos
 * dejaria la tarea morir sin que el humano se entere. El volumen esta acotado por naturaleza: una
 * tarea pausada no genera mas checkpoints hasta que alguien decide.
 */
export function crearNotificadorAprobaciones(deps: NotificadorAprobacionesDeps): NotificadorAprobaciones {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function enviar(ownerId: string, jobId: string, correo: CorreoAprobacion): Promise<void> {
    try {
      if (!deps.resendApiKey || !deps.fromEmail) {
        deps.logger.warn(
          'notificacion de aprobacion omitida: falta configuracion de email (RESEND_API_KEY / RESEND_FROM_EMAIL)',
          { jobId },
        );
        return;
      }
      const email = await deps.getOwnerEmail(ownerId);
      if (!email) {
        deps.logger.warn('notificacion de aprobacion omitida: no se encontro el email del owner', {
          jobId,
          ownerId,
        });
        return;
      }
      await enviarViaResend(fetchImpl, deps.resendApiKey, deps.fromEmail, email, correo, deps.logger, jobId);
    } catch (err) {
      deps.logger.error('fallo al notificar la aprobacion (se ignora, best-effort)', {
        jobId,
        err: err instanceof Error ? err.message : 'desconocido',
      });
    }
  }

  return {
    notificarPendiente: (params) =>
      enviar(
        params.ownerId,
        params.jobId,
        construirCorreoAprobacionPendiente({
          descripcion: params.descripcion,
          dominio: params.dominio,
          expiraEnIso: params.expiraEnIso,
          ...(deps.consoleBaseUrl !== undefined ? { consoleBaseUrl: deps.consoleBaseUrl } : {}),
        }),
      ),
    notificarExpirada: (params) =>
      enviar(
        params.ownerId,
        params.jobId,
        construirCorreoAprobacionExpirada({
          descripcion: params.descripcion,
          ...(deps.consoleBaseUrl !== undefined ? { consoleBaseUrl: deps.consoleBaseUrl } : {}),
        }),
      ),
  };
}

// --- BARRIDO de aprobaciones vencidas (mismo patron throttled que barrerLoginsVencidos) ------------

/** Subconjunto del AprobacionesWebRepository que el worker usa (facil de mockear). */
export interface RepositorioAprobacionesParaWorker {
  crear(input: {
    ownerId: string;
    jobId: string;
    connectionId: string;
    sesionExternaId: string;
    accionTipo: AccionTipo;
    descripcion: string;
    screenshotPath?: string | null;
    expiraEn: Date | string;
  }): Promise<AprobacionWeb>;
  guardarScreenshotPath(id: string, path: string): Promise<void>;
  obtenerVigentePorJob(jobId: string, ownerId: string): Promise<AprobacionWeb | null>;
  listarPendientesVencidas(ahora: Date): Promise<AprobacionWeb[]>;
  expirar(id: string): Promise<boolean>;
  registrarIntervencion(input: {
    ownerId: string;
    aprobacionId: string;
    decision: 'aprobada' | 'rechazada' | 'expirada';
    decididaPor?: string | null;
    descripcion: string;
    screenshotPath?: string | null;
    instruccion?: string | null;
  }): Promise<void>;
}

export interface BarridoAprobacionesDeps {
  aprobaciones: RepositorioAprobacionesParaWorker;
  /** Cierra (libera) la sesion en el proveedor. */
  cerrarSesion(sesionExternaId: string): Promise<void>;
  /** Cierra el job pausado como 'failed' (JobsRepository.marcarPausadoFallido). */
  marcarJobFallido(jobId: string, error: string): Promise<void>;
  notificador?: NotificadorAprobaciones;
  logger: Logger;
}

/**
 * BARRIDO de aprobaciones VENCIDAS: las 'pendiente' cuyo expira_en ya paso. Para cada una, en orden:
 * (1) CAS 'pendiente' -> 'expirada' (si una decision humana gano la carrera, no se toca nada),
 * (2) constancia Art.22 de que NADIE intervino y la accion NO se ejecuto,
 * (3) cerrar la sesion de navegador (recien aqui: mientras estuvo pendiente se mantuvo VIVA),
 * (4) cerrar el job 'pausado' como 'failed' con mensaje accionable,
 * (5) notificar al owner (best-effort).
 * Best-effort por fila: un fallo se loguea y el proximo ciclo reintenta (el CAS hace el reintento
 * inocuo). Corre en el loop del worker con el mismo patron throttled que el reaper.
 */
export async function barrerAprobacionesVencidas(
  deps: BarridoAprobacionesDeps,
  ahora: Date,
): Promise<void> {
  let vencidas: AprobacionWeb[];
  try {
    vencidas = await deps.aprobaciones.listarPendientesVencidas(ahora);
  } catch (error) {
    deps.logger.error('barrido de aprobaciones: fallo al listar (se reintenta en el proximo ciclo)', {
      err: error instanceof Error ? error.message : 'desconocido',
    });
    return;
  }
  for (const aprobacion of vencidas) {
    try {
      const expiro = await deps.aprobaciones.expirar(aprobacion.id);
      if (!expiro) continue; // una decision humana llego en el mismo instante: gana la decision.

      await deps.aprobaciones.registrarIntervencion({
        ownerId: aprobacion.ownerId,
        aprobacionId: aprobacion.id,
        decision: 'expirada',
        decididaPor: null,
        descripcion: aprobacion.descripcion,
        screenshotPath: aprobacion.screenshotPath,
      });

      try {
        await deps.cerrarSesion(aprobacion.sesionExternaId);
      } catch (error) {
        deps.logger.warn('barrido de aprobaciones: no se pudo cerrar la sesion (el timeout del proveedor es la red de seguridad)', {
          aprobacionId: aprobacion.id,
          err: error instanceof Error ? error.message : 'desconocido',
        });
      }

      await deps.marcarJobFallido(
        aprobacion.jobId,
        'la aprobacion del checkpoint expiro sin decision; la tarea se cancelo sin ejecutar la accion pendiente',
      );

      if (deps.notificador) {
        await deps.notificador.notificarExpirada({
          ownerId: aprobacion.ownerId,
          jobId: aprobacion.jobId,
          descripcion: aprobacion.descripcion,
        });
      }

      deps.logger.warn('aprobacion expirada: tarea cancelada sin ejecutar la accion, sesion cerrada', {
        aprobacionId: aprobacion.id,
        jobId: aprobacion.jobId,
      });
    } catch (error) {
      deps.logger.error('barrido de aprobaciones: fallo al expirar (se reintenta en el proximo ciclo)', {
        aprobacionId: aprobacion.id,
        err: error instanceof Error ? error.message : 'desconocido',
      });
    }
  }
}
