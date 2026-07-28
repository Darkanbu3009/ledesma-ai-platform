import type { AgentEvent } from './sse';

/**
 * SEGUIMIENTO de TAREAS WEB VIVAS en la conversacion del Playground. Logica PURA (sin React ni
 * red): observa los eventos del stream (tool_use / tool_result) y mantiene el conjunto de job_ids
 * de tareas web que la conversacion encolo y AUN no vio terminar.
 *
 * POR QUE EXISTE (evidencia de produccion): cuando el agente conversacional agota sus iteraciones
 * mientras una tarea web sigue corriendo, el aviso generico "se corto por el limite de iteraciones"
 * hacia creer que la TAREA fallo, y un usuario cancelo un job sano. Con este seguimiento, el corte
 * por max_iterations puede distinguir "quedo una tarea viva ejecutandose en segundo plano" (mensaje
 * tranquilizador que apunta a /actividad) del corte ordinario.
 *
 * Los nombres espejan las tools de sitios del backend (sitio-tools.ts). Todo el parseo es tolerante:
 * un content que no sea el JSON esperado simplemente no cambia el estado.
 */

/** Tool que ENCOLA una tarea web y devuelve un job_id (espejo de SITIO_TOOL_EJECUTAR). */
export const TOOL_EJECUTAR_TAREA_EN_SITIO = 'platform_ejecutar_tarea_en_sitio';
/** Tool que CONSULTA el resultado de una tarea encolada (espejo de SITIO_TOOL_REVISAR). */
export const TOOL_REVISAR_TAREA_EN_SITIO = 'platform_revisar_tarea_en_sitio';

export interface SeguimientoTareasWeb {
  /** tool_use en vuelo de las dos tools de interes: id del tool_use -> nombre y job_id pedido. */
  llamadas: Map<string, { name: string; jobId: string | null }>;
  /** job_ids de tareas web que la conversacion encolo o consulto y aun no vio terminar. */
  vivos: Set<string>;
  /**
   * job_ids que EN ESTE TURNO se vieron terminar con estado 'completada' (cierre veraz, 28 jul
   * 2026). Se vacia al arrancar cada turno (iniciarTurnoDeTareasWeb): decide solo sobre el
   * desenlace del turno en curso, no sobre exitos de turnos anteriores.
   */
  completadas: Set<string>;
}

export function crearSeguimientoTareasWeb(): SeguimientoTareasWeb {
  return { llamadas: new Map(), vivos: new Set(), completadas: new Set() };
}

/** true si la conversacion tiene al menos una tarea web encolada que aun no se vio terminar. */
export function hayTareaWebViva(seguimiento: SeguimientoTareasWeb): boolean {
  return seguimiento.vivos.size > 0;
}

/** true si ESTE turno vio terminar con exito al menos una tarea web. */
export function hayTareaWebCompletada(seguimiento: SeguimientoTareasWeb): boolean {
  return seguimiento.completadas.size > 0;
}

/** Arranque de un turno: los exitos vistos pertenecen al turno, las tareas vivas persisten. */
export function iniciarTurnoDeTareasWeb(seguimiento: SeguimientoTareasWeb): void {
  seguimiento.completadas.clear();
}

function stringDe(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

/** Parsea (tolerante) el content JSON de un tool_result de las tools de sitios. */
function parsearContenido(content: string): { estado: string | null; jobId: string | null } {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return { estado: null, jobId: null };
    const { estado, job_id: jobId } = parsed as { estado?: unknown; job_id?: unknown };
    return { estado: stringDe(estado), jobId: stringDe(jobId) };
  } catch {
    return { estado: null, jobId: null };
  }
}

/**
 * Registra UN evento del stream en el seguimiento. Reglas:
 *  - ejecutar con resultado sin error y job_id -> esa tarea queda VIVA.
 *  - revisar con estado en_proceso -> el job consultado queda (o sigue) VIVO; cubre tambien una
 *    tarea encolada en un turno anterior (el historial no se re-reproduce como eventos).
 *  - revisar con estado completada, o con isError (fallida / job inexistente) -> deja de estar viva.
 * Cualquier otro evento no cambia nada.
 */
export function registrarEventoDeTareaWeb(seguimiento: SeguimientoTareasWeb, event: AgentEvent): void {
  if (event.type === 'tool_use') {
    if (event.name !== TOOL_EJECUTAR_TAREA_EN_SITIO && event.name !== TOOL_REVISAR_TAREA_EN_SITIO) return;
    seguimiento.llamadas.set(event.id, {
      name: event.name,
      jobId: event.name === TOOL_REVISAR_TAREA_EN_SITIO ? stringDe(event.input['job_id']) : null,
    });
    return;
  }
  if (event.type !== 'tool_result') return;
  const llamada = seguimiento.llamadas.get(event.toolUseId);
  if (llamada === undefined) return;
  seguimiento.llamadas.delete(event.toolUseId);
  const contenido = parsearContenido(event.content);
  if (llamada.name === TOOL_EJECUTAR_TAREA_EN_SITIO) {
    if (!event.isError && contenido.jobId !== null) seguimiento.vivos.add(contenido.jobId);
    return;
  }
  const jobId = llamada.jobId;
  if (jobId === null) return;
  if (!event.isError && contenido.estado === 'en_proceso') {
    seguimiento.vivos.add(jobId);
    return;
  }
  if (event.isError || contenido.estado === 'completada') {
    seguimiento.vivos.delete(jobId);
    if (!event.isError && contenido.estado === 'completada') seguimiento.completadas.add(jobId);
  }
}
