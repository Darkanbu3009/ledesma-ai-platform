/**
 * CONTRATO de la VERIFICACION DETERMINISTA previa a ejecutar una accion que no se puede deshacer:
 * la POLITICA que el usuario configura una sola vez y la DETENCION que se reporta cuando la accion
 * no se ejecuta. Compartido por el worker (que aplica la politica y produce la detencion), el
 * backend (que persiste la politica y el last_error) y la consola (que configura la politica y
 * traduce la detencion a un texto para una persona no tecnica).
 *
 * Por que vive en shared y no duplicado en cada app: es una superficie de SEGURIDAD. Si el worker y
 * la consola divergieran en el prefijo o en los motivos, una detencion se mostraria como un fallo
 * generico ("La tarea no se pudo completar") y el usuario nunca sabria que su accion se detuvo por
 * no coincidir con lo que pidio. Una sola definicion, dos consumidores.
 *
 * FORMA: el mensaje ENTERO del error es `DETENIDA_VERIFICACION: {json}`. El JSON va al FINAL y es
 * todo lo que sigue al prefijo a proposito: el listado de jobs TRUNCA last_error por la derecha
 * (apps/backend/src/routes/jobs.ts), asi que cualquier texto tecnico agregado despues del JSON lo
 * romperia. El detalle tecnico viaja DENTRO del JSON (campo `detalle`) y la consola no lo muestra.
 *
 * El prefijo se busca con indexOf y no con startsWith porque el worker envuelve el mensaje en el
 * nombre de la clase de error (`PermanentExecutionError: ...`) al cerrar el job.
 */

/**
 * POLITICA DE EJECUCION del usuario (D3): los tres ajustes que configura UNA sola vez. Vive aca (y
 * no en el repositorio del backend) porque el worker la APLICA y la consola la EDITA: una sola
 * definicion de la forma y de los defaults evita que el limite que el usuario ve en pantalla y el
 * que el worker compara puedan divergir.
 */
export interface PoliticaDeEjecucion {
  /** false = ninguna accion irreversible se ejecuta; la tarea se detiene y lo reporta. */
  ejecutarAccionesIrreversibles: boolean;
  /** Monto MAXIMO en MXN que puede ejecutarse sin detenerse. */
  topeMontoSinConfirmacion: number;
  /** Dominios donde JAMAS se ejecutan acciones irreversibles. */
  sitiosExcluidos: string[];
}

/**
 * DEFAULTS cuando el usuario nunca configuro su politica (sin fila en V034). El tope 0 es deliberado
 * y conservador: mientras no declare un limite, ninguna accion con monto se ejecuta. Ejecutar el
 * resto de las acciones si es el default, porque el producto se opera en lenguaje natural y la
 * proteccion por defecto es la verificacion determinista, no una pregunta por accion.
 */
export const POLITICA_EJECUCION_DEFAULT: PoliticaDeEjecucion = {
  ejecutarAccionesIrreversibles: true,
  topeMontoSinConfirmacion: 0,
  sitiosExcluidos: [],
};

/** Prefijo ESTABLE que marca un last_error como detencion previa a ejecutar (nunca cambiar). */
export const DETENIDA_VERIFICACION_PREFIX = 'DETENIDA_VERIFICACION: ';

/**
 * Por que se detuvo la accion. Cada motivo tiene UN texto i18n propio en la consola:
 *  - noCoincide: lo que el objetivo pedia y lo que habia en el sitio no son lo mismo (o no se pudo
 *    leer del sitio el dato pedido).
 *  - faltaDato: la accion necesitaba un dato que el objetivo nunca declaro.
 *  - topeExcedido: el monto supera el limite que el usuario configuro una sola vez.
 *  - sitioExcluido: el usuario excluyo ese dominio de las acciones irreversibles.
 *  - accionesDesactivadas: el usuario apago las acciones que no se pueden deshacer.
 *  - otraAccion: tras ejecutar la accion verificada aparecio OTRA accion irreversible; no se
 *    encadenan verificaciones dentro de la misma corrida.
 *  - politicaNoDisponible: no se pudieron leer las preferencias del usuario. Se detiene (nunca se
 *    asume permiso) y se le pide reintentar.
 */
export type MotivoDetencion =
  | 'noCoincide'
  | 'faltaDato'
  | 'topeExcedido'
  | 'sitioExcluido'
  | 'accionesDesactivadas'
  | 'otraAccion'
  | 'politicaNoDisponible';

const MOTIVOS: readonly MotivoDetencion[] = [
  'noCoincide',
  'faltaDato',
  'topeExcedido',
  'sitioExcluido',
  'accionesDesactivadas',
  'otraAccion',
  'politicaNoDisponible',
];

/** Dato que la accion necesitaba y el objetivo no declaro. Nombres de NEGOCIO, no de campo del DOM. */
export type CampoFaltante = 'destinatario' | 'monto';

/** Detencion serializable. Todos los valores son texto ya CENSURADO por el worker. */
export interface DetencionDeVerificacion {
  motivo: MotivoDetencion;
  /** noCoincide: lo que el objetivo pedia. */
  pedido?: string;
  /** noCoincide: lo que habia en el sitio. Cadena vacia = no habia nada legible. */
  encontrado?: string;
  /** faltaDato: que dato falto. */
  campo?: CampoFaltante;
  /** topeExcedido: monto detectado y limite configurado, ya formateados. */
  monto?: string;
  tope?: string;
  /** sitioExcluido: dominio excluido por el usuario. */
  dominio?: string;
  /** Detalle interno para operacion (nunca se muestra al usuario). */
  detalle?: string;
}

/** Tope por valor: acota el JSON muy por debajo del truncado de last_error (500 chars). */
const MAX_VALOR_CHARS = 120;

function acotar(valor: string): string {
  const limpio = valor.replace(/\s+/g, ' ').trim();
  return limpio.length <= MAX_VALOR_CHARS ? limpio : `${limpio.slice(0, MAX_VALOR_CHARS)}...`;
}

/** Serializa la detencion como el mensaje de error COMPLETO del job. */
export function serializarDetencion(detencion: DetencionDeVerificacion): string {
  const cuerpo: Record<string, string> = { motivo: detencion.motivo };
  for (const clave of ['pedido', 'encontrado', 'campo', 'monto', 'tope', 'dominio', 'detalle'] as const) {
    const valor = detencion[clave];
    if (typeof valor === 'string') cuerpo[clave] = acotar(valor);
  }
  return `${DETENIDA_VERIFICACION_PREFIX}${JSON.stringify(cuerpo)}`;
}

/**
 * Lee una detencion de un last_error. Devuelve null si no es una detencion o si el JSON no se puede
 * interpretar (p.ej. porque el listado lo trunco): el llamador cae a su mensaje de fallo generico,
 * jamas muestra basura ni inventa un motivo.
 */
export function parsearDetencion(lastError: string | null | undefined): DetencionDeVerificacion | null {
  if (typeof lastError !== 'string') return null;
  const idx = lastError.indexOf(DETENIDA_VERIFICACION_PREFIX);
  if (idx < 0) return null;
  let crudo: unknown;
  try {
    crudo = JSON.parse(lastError.slice(idx + DETENIDA_VERIFICACION_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  const motivo = objeto.motivo;
  if (typeof motivo !== 'string' || !MOTIVOS.includes(motivo as MotivoDetencion)) return null;
  const detencion: DetencionDeVerificacion = { motivo: motivo as MotivoDetencion };
  for (const clave of ['pedido', 'encontrado', 'monto', 'tope', 'dominio', 'detalle'] as const) {
    const valor = objeto[clave];
    if (typeof valor === 'string') detencion[clave] = valor;
  }
  if (objeto.campo === 'destinatario' || objeto.campo === 'monto') detencion.campo = objeto.campo;
  return detencion;
}
