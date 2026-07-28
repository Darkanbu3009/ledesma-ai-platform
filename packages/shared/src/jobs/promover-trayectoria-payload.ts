/**
 * SHAPE del payload del job que GUARDA COMO TAREA APRENDIDA una tarea web exitosa del motor libre
 * (Fase F): la promocion trayectoria (V030) -> receta web (V035) CON CONSENTIMIENTO del usuario.
 *
 * POR QUE ES UN JOB Y NO UNA CONVERSION INLINE EN EL BACKEND: la conversion reusa las mismas piezas
 * que la promocion automatica y que la grabacion (firma del objetivo, sustitucion de parametros,
 * deteccion de verbos bloqueados), y todas viven en el worker. Encolar mantiene UNA sola
 * implementacion de ese vocabulario, igual que 'promover_grabacion' (grabacion-payload.ts). El
 * backend solo valida pertenencia y estado, y encola; el worker convierte. Cero llamadas al modelo.
 *
 * ESTO NO ES LA PROMOCION AUTOMATICA (tarea-web.ts, CAMBIO 3): aquella corre al cierre de la corrida
 * con las estrategias observadas EN MEMORIA. Este job parte de la trayectoria PERSISTIDA (que no
 * conserva esas observaciones) y existe para que el usuario guarde, de forma explicita, un exito que
 * la promocion automatica no dejo aprendido.
 *
 * Vive en packages/shared (junto a grabacion-payload.ts) porque lo consumen DOS workspaces: el
 * backend (que encola) y el worker (que ejecuta). Tipos PUROS con validadores SIN dependencias.
 */

/** Discriminador del job que promueve una trayectoria persistida a receta con consentimiento. */
export const PROMOVER_TRAYECTORIA_JOB_KIND = 'promover_trayectoria';

/**
 * Prefijo ESTABLE del last_error cuando la conversion es IMPOSIBLE con lo que quedo registrado (un
 * fallo permanente que reintentar no cambia). Mismo mecanismo que CANCELADO_POR_USUARIO_PREFIX: la
 * consola lo detecta para mostrar el motivo real ("incluye un paso que no se puede convertir en
 * repetible todavia") en vez del generico que invita a reintentar. Lo que sigue al prefijo es el
 * motivo tecnico interno del conversor (sin datos del usuario: la trayectoria ya viene censurada).
 */
export const PROMOCION_NO_REPETIBLE_PREFIX = 'PROMOCION_NO_REPETIBLE: ';

/** Payload del job. El owner NUNCA viaja aqui: sale del propio job (jobs.owner_id). */
export interface PromoverTrayectoriaJobPayload {
  kind: typeof PROMOVER_TRAYECTORIA_JOB_KIND;
  /**
   * Job de TAREA WEB (V008) cuyo exito se guarda. Las trayectorias se resuelven por (job, owner) en
   * el worker: pasar el id del job y no el de la trayectoria evita que un payload manipulado apunte
   * a una trayectoria suelta, y cubre los jobs con mas de una corrida (checkpoint de aprobacion).
   */
  jobId: string;
}

/** Resultado de validar el payload (estilo safeParse, sin lanzar). */
export type PromoverTrayectoriaJobPayloadParseResult =
  | { success: true; data: PromoverTrayectoriaJobPayload }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** ¿`value` es un id no vacio y acotado? Los ids son uuid; el tope es defensivo. */
function esId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

/**
 * DISCRIMINADOR barato: ¿este payload AFIRMA ser de promocion de trayectoria? Es el check con el que
 * el worker RAMIFICA, igual que isGrabacionJobPayload. false para todo lo demas.
 */
export function isPromoverTrayectoriaJobPayload(value: unknown): boolean {
  return isRecord(value) && value.kind === PROMOVER_TRAYECTORIA_JOB_KIND;
}

/** Valida COMPLETAMENTE el payload. */
export function parsePromoverTrayectoriaJobPayload(
  value: unknown,
): PromoverTrayectoriaJobPayloadParseResult {
  if (!isRecord(value)) {
    return { success: false, error: 'payload no es un objeto' };
  }
  if (value.kind !== PROMOVER_TRAYECTORIA_JOB_KIND) {
    return { success: false, error: 'kind no corresponde a un job de promocion de trayectoria' };
  }
  if (!esId(value.jobId)) {
    return { success: false, error: 'jobId debe ser un string no vacio' };
  }
  return { success: true, data: { kind: PROMOVER_TRAYECTORIA_JOB_KIND, jobId: value.jobId } };
}
