import { parsearMarcadosDeVariables, type MarcadoDeVariable } from '../grabaciones/contrato.js';

/**
 * SHAPES de los payloads de los JOBS DE GRABACION DE TAREA (V036): la via COMPLEMENTARIA para sembrar
 * una receta cuando el agente falla de forma repetida en un sitio, o para arrancar el sistema de
 * recetas sin depender de una primera corrida exitosa del agente. La arquitectura principal NO cambia:
 * el agente sigue navegando libremente cualquier sitio donde el usuario ya inicio sesion.
 *
 * Son DOS kinds porque son dos momentos separados por una decision humana:
 *  - 'grabar_tarea': abre la sesion de navegador sobre un sitio YA ACTIVO, publica la vista en vivo y
 *    captura lo que el usuario hace, hasta que el usuario dice "ya termine". Cero llamadas al modelo.
 *  - 'promover_grabacion': despues de que el usuario marca que datos cambian cada vez, convierte la
 *    grabacion en una receta activa. Tampoco llama a ningun modelo.
 *
 * INVARIANTE INNEGOCIABLE: NINGUN payload de este modulo lleva (ni llevara) un campo de contrasena, y
 * 'grabar_tarea' no puede iniciar un login: exige una conexion en estado 'activo', cuya sesion la
 * establecio el flujo de login existente. Si durante la grabacion aparece un campo de contrasena, el
 * worker corta y descarta lo capturado.
 *
 * Vive en packages/shared (junto a sitio-payload.ts y tarea-web-payload.ts) porque lo consumen DOS
 * workspaces: el backend (que encola) y el worker (que ejecuta). Tipos PUROS con validadores SIN
 * dependencias (ni Zod), igual que el resto de los payloads.
 */

/** Discriminador del job que GRABA lo que el usuario hace en la vista en vivo. */
export const GRABAR_TAREA_JOB_KIND = 'grabar_tarea';
/** Discriminador del job que convierte una grabacion terminada en una receta activa. */
export const PROMOVER_GRABACION_JOB_KIND = 'promover_grabacion';

/** Los dos kinds de jobs de grabacion, para chequeos de pertenencia. */
export const GRABACION_JOB_KINDS = [
  GRABAR_TAREA_JOB_KIND,
  PROMOVER_GRABACION_JOB_KIND,
] as const;

export type GrabacionJobKind = (typeof GRABACION_JOB_KINDS)[number];

/** Payload del job que graba una tarea sobre la sesion activa de un sitio conectado. */
export interface GrabarTareaJobPayload {
  kind: typeof GRABAR_TAREA_JOB_KIND;
  /** Fila de sitios_conectados (V024) sobre cuya sesion activa se graba. */
  connectionId: string;
  /** Fila de grabaciones (V036) que el backend ya creo en estado 'grabando'. */
  grabacionId: string;
}

/** Payload del job que promueve una grabacion terminada a receta. */
export interface PromoverGrabacionJobPayload {
  kind: typeof PROMOVER_GRABACION_JOB_KIND;
  grabacionId: string;
  /**
   * Que pasos de escritura son DATOS VARIABLES y de que tipo. Viaja solo el indice y el marcador:
   * el VALOR que el usuario tecleo jamas entra a un payload de job (y se borra de la grabacion al
   * promover). Vacio = todos los valores son parte fija de la receta.
   */
  variables: MarcadoDeVariable[];
}

export type GrabacionJobPayload = GrabarTareaJobPayload | PromoverGrabacionJobPayload;

/** Resultado de validar un payload de grabacion (estilo safeParse, sin lanzar). */
export type GrabacionJobPayloadParseResult =
  | { success: true; data: GrabacionJobPayload }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * DISCRIMINADOR barato: ¿este payload AFIRMA ser de grabacion? No valida la forma completa (para eso
 * esta parseGrabacionJobPayload); es el check con el que el worker RAMIFICA, igual que
 * isSitioJobPayload. false para jobs simples, recetas, sitios, tareas web y basura.
 */
export function isGrabacionJobPayload(value: unknown): boolean {
  return isRecord(value) && (GRABACION_JOB_KINDS as readonly unknown[]).includes(value.kind);
}

/** ¿`value` es un id no vacio y acotado? Los ids son uuid; el tope es defensivo. */
function esId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

/** Valida COMPLETAMENTE un payload de grabacion segun su kind. */
export function parseGrabacionJobPayload(value: unknown): GrabacionJobPayloadParseResult {
  if (!isRecord(value)) {
    return { success: false, error: 'payload no es un objeto' };
  }
  const kind = value.kind;
  if (kind === GRABAR_TAREA_JOB_KIND) {
    if (!esId(value.connectionId)) {
      return { success: false, error: 'connectionId debe ser un string no vacio' };
    }
    if (!esId(value.grabacionId)) {
      return { success: false, error: 'grabacionId debe ser un string no vacio' };
    }
    return {
      success: true,
      data: { kind, connectionId: value.connectionId, grabacionId: value.grabacionId },
    };
  }
  if (kind === PROMOVER_GRABACION_JOB_KIND) {
    if (!esId(value.grabacionId)) {
      return { success: false, error: 'grabacionId debe ser un string no vacio' };
    }
    const variables = parsearMarcadosDeVariables(value.variables ?? []);
    if (variables === null) {
      return { success: false, error: 'variables no es una lista valida de datos marcados' };
    }
    return { success: true, data: { kind, grabacionId: value.grabacionId, variables } };
  }
  return { success: false, error: 'kind no corresponde a un job de grabacion' };
}
