/**
 * CIERRE VERAZ DEL TURNO en el Playground (caso real de produccion, 28 jul 2026): tras completarse
 * con exito una tarea web (job completed, correo enviado), el stream SSE murio sin llegar el evento
 * `done` (corte de red o del proxy durante una ventana de silencio del long-poll) y el catch-all de
 * sendText pintaba un recuadro "UNKNOWN / Revisa tu key o el identificador del modelo". El error
 * era real pero POSTERIOR e irrelevante al desenlace, y el copy culpaba a la credencial.
 *
 * Dos reglas, ambas puras y testeables sin DOM:
 *  1. Si el turno ya vio terminar con exito su tarea web, el fallo del cierre se SUPRIME y el turno
 *     cierra con el resumen del exito (lo narrado se conserva en el historial).
 *  2. El copy "Revisa tu key o el identificador del modelo" queda RESERVADO a los errores reales de
 *     autenticacion o de modelo del proveedor, verificados por su codigo (401/403 -> AUTHENTICATION,
 *     404 de modelo -> MODEL_NOT_FOUND, clasificados en el backend); cualquier otro error muestra su
 *     mensaje propio o, sin mensaje, el copy veraz de conexion.
 */

/**
 * Codigos de ProviderError (backend, providers/errors.ts) que SI son un problema de credencial o de
 * identificador de modelo. Solo estos muestran el copy que invita a revisar la key.
 */
const CODIGOS_DE_CREDENCIAL_O_MODELO: ReadonlySet<string> = new Set([
  'AUTHENTICATION',
  'MODEL_NOT_FOUND',
]);

/** ¿El codigo de error corresponde a un fallo real de credencial o de modelo del proveedor? */
export function esErrorDeCredencialOModelo(code: string): boolean {
  return CODIGOS_DE_CREDENCIAL_O_MODELO.has(code);
}

/** Como termina un turno cuyo stream fallo sin `done`: con el resumen del exito, o con un error. */
export type CierreTrasFalloDeStream =
  | { tipo: 'exito' }
  | { tipo: 'error'; code: string };

/**
 * Decide el cierre cuando el stream del turno LANZA sin haber recibido `done` ni `error` del
 * backend. Con una tarea web del turno ya completada, el fallo es posterior al desenlace y se
 * suprime; sin desenlace exitoso, el turno cierra con un error de CONEXION (jamas UNKNOWN con el
 * copy de credencial: nada verifico la key en este camino).
 */
export function cierreTrasFalloDeStream(tareaWebCompletada: boolean): CierreTrasFalloDeStream {
  return tareaWebCompletada ? { tipo: 'exito' } : { tipo: 'error', code: 'CONNECTION' };
}
