/**
 * Tipos y logica PURA de la GRABACION DE TAREAS en la consola: el usuario le ENSENA una tarea al
 * sistema haciendola el mismo una vez, y a partir de ahi el sistema la repite solo. Espeja la forma
 * camelCase de /v1/grabaciones (apps/backend/src/routes/grabaciones.ts). Sin React ni red: aqui viven
 * las derivaciones que la pagina y el dialogo usan, y se testean como funciones puras (igual que
 * sitios.ts y jobs.ts).
 *
 * PRINCIPIO NO NEGOCIABLE, tambien aqui: el login jamas se graba. Este modulo no tiene ningun campo ni
 * tipo de contrasena, y la unica entrada humana del flujo es lo que el usuario va a ensenar, escrito
 * en lenguaje llano.
 */

/** Ciclo de vida de una grabacion (mismos estados que el CHECK de V036). */
export type EstadoGrabacion = 'grabando' | 'terminada' | 'descartada';

/** Por que se descarto una grabacion. Solo 'contrasena' tiene un mensaje propio para el usuario. */
export type MotivoDescarte =
  | 'contrasena'
  | 'vencida'
  | 'demasiados_pasos'
  | 'no_repetible'
  | 'sitio_no_disponible';

/** Los tipos de dato que el usuario puede elegir al marcar que cambia cada vez. */
export type TipoDeDato = 'destinatario' | 'asunto' | 'cuerpo' | 'monto' | 'producto' | 'cantidad';

/**
 * Los seis tipos, en el orden en que se ofrecen. Son EXACTAMENTE los marcadores del contrato de
 * recetas: si la consola ofreciera otro, la sustitucion al ejecutar no encontraria ese dato.
 */
export const TIPOS_DE_DATO: readonly TipoDeDato[] = [
  'destinatario',
  'asunto',
  'cuerpo',
  'monto',
  'producto',
  'cantidad',
];

/** Un paso capturado, tal como vuelve del backend. */
export interface PasoGrabado {
  idx: number;
  accion: 'click' | 'escribir' | 'teclas' | 'navegar';
  valor: string | null;
}

/** Una grabacion tal como la devuelve GET /v1/grabaciones/:id. */
export interface Grabacion {
  id: string;
  connectionId: string;
  dominio: string;
  descripcion: string;
  estado: EstadoGrabacion;
  motivo: MotivoDescarte | null;
  /** URL de la vista en vivo donde el usuario hace la tarea. Solo poblada mientras 'grabando'. */
  vistaEnVivoUrl: string | null;
  pasos: PasoGrabado[];
  creadaEn: string;
  actualizadaEn: string;
}

/** Respuesta 202 de POST /v1/grabaciones. */
export interface GrabacionAceptada {
  status: string;
  jobId: string;
  grabacion: Grabacion;
}

/** Respuesta 202 de POST /v1/grabaciones/:id/confirmar. */
export interface GrabacionJobAceptado {
  status: string;
  jobId: string;
}

/** Intervalo de polling de UNA grabacion en curso (ms). */
export const GRABACION_REFETCH_MS = 2000;

/**
 * ¿Hay que seguir consultando esta grabacion? Mientras esta 'grabando' si (se espera la vista en vivo
 * primero y el cierre despues). En cuanto queda terminada o descartada, no.
 */
export function grabacionEnCurso(grabacion: Grabacion | undefined): boolean {
  return grabacion === undefined || grabacion.estado === 'grabando';
}

/**
 * Los pasos que el usuario tiene que revisar: SOLO los que escribio un dato. Los clics, las teclas y
 * la pagina de inicio no tienen nada que marcar, y mostrarlos convertiria la revision en una lista de
 * pasos tecnicos que el usuario final no tiene por que leer.
 */
export function pasosConDatos(grabacion: Grabacion | undefined): PasoGrabado[] {
  if (!grabacion) return [];
  return grabacion.pasos.filter((paso) => paso.accion === 'escribir' && paso.valor !== null);
}

/**
 * Convierte el marcado de la UI (idx -> tipo, o ausencia = dato fijo) al cuerpo que espera el backend.
 * Solo viajan indices y tipos: el valor que el usuario escribio NUNCA se manda de vuelta.
 */
export function variablesDesdeMarcado(
  marcado: Record<number, TipoDeDato | undefined>,
): Array<{ idx: number; marcador: TipoDeDato }> {
  return Object.entries(marcado)
    .flatMap(([idx, marcador]) =>
      marcador === undefined ? [] : [{ idx: Number(idx), marcador }],
    )
    .sort((a, b) => a.idx - b.idx);
}
