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
 * Prefijos ESTABLES de last_error de los dos cierres nuevos del cupo de accion irreversible
 * (evidencia de produccion del 27 jul 2026). El worker los produce como `name` de la clase de error
 * (describeError arma `${name}: ${message}`) y la consola los detecta con startsWith para mostrar un
 * texto veraz en vez del fallo generico. Nunca cambiar: son contrato entre worker y consola.
 *
 *  - ACCION_SIN_EFECTO_CONFIRMADO: la accion irreversible se ejecuto (una vez, o su unico reintento)
 *    y el sitio no mostro que surtiera efecto; puede haber quedado un borrador o un estado a medias.
 *  - GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES: la guardia agoto el reintento autorizado y el agente
 *    insistio; el worker corto la corrida en vez de dejarla ciclar contra la guardia.
 */
export const ACCION_SIN_EFECTO_CONFIRMADO_PREFIX = 'ACCION_SIN_EFECTO_CONFIRMADO:';
export const GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES_PREFIX =
  'GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES:';

/**
 * Prefijo ESTABLE de last_error cuando la corrida se corto porque la LLAVE DEL MODELO no tiene saldo
 * o no es valida (evidencia de produccion del 31 jul 2026: creditos agotados en el proveedor). Mismo
 * mecanismo que los dos anteriores: el worker lo produce como `name` de su clase de error
 * (fallo-modelo.ts) y la consola lo detecta con startsWith para decir que paso y que hacer, en vez
 * del generico "La tarea no se pudo completar" con un detalle tecnico que no orienta. Nunca cambiar.
 */
export const MODELO_SIN_ACCESO_PREFIX = 'MODELO_SIN_ACCESO:';

/**
 * Por que se detuvo la accion. Cada motivo tiene UN texto i18n propio en la consola:
 *  - noCoincide: lo que el objetivo pedia y lo que habia en el sitio no son lo mismo.
 *  - noLeible: el dato pedido no se pudo LEER del sitio para comprobarlo (el campo existe pero su
 *    valor no se pudo determinar, o la pagina entera no se pudo leer). Distinto de "esta vacio":
 *    vacio significa que falta escribir el dato y la tarea sigue; no leible detiene y lo dice.
 *  - faltaDato: la accion necesitaba un dato que el objetivo nunca declaro.
 *  - topeExcedido: el monto supera el limite que el usuario configuro una sola vez.
 *  - sitioExcluido: el usuario excluyo ese dominio de las acciones irreversibles.
 *  - accionesDesactivadas: el usuario apago las acciones que no se pueden deshacer.
 *  - otraAccion: tras ejecutar la accion verificada aparecio OTRA accion irreversible; no se
 *    encadenan verificaciones dentro de la misma corrida.
 *  - politicaNoDisponible: no se pudieron leer las preferencias del usuario. Se detiene (nunca se
 *    asume permiso) y se le pide reintentar.
 *  - sinEvidenciaParaComparar: la accion NO es de solo lectura y el sistema no pudo comparar NI UN
 *    dato contra la pagina, porque el objetivo no declaro ninguno que se pueda leer del sitio. Es la
 *    inversion del default: antes, cero comparaciones se leia como "todo en orden" y la accion
 *    pasaba; hoy una accion sobre la que no se comparo nada no se ejecuta.
 */
export type MotivoDetencion =
  | 'noCoincide'
  | 'noLeible'
  | 'faltaDato'
  | 'topeExcedido'
  | 'sitioExcluido'
  | 'accionesDesactivadas'
  | 'otraAccion'
  | 'politicaNoDisponible'
  | 'sinEvidenciaParaComparar';

const MOTIVOS: readonly MotivoDetencion[] = [
  'noCoincide',
  'noLeible',
  'faltaDato',
  'topeExcedido',
  'sitioExcluido',
  'accionesDesactivadas',
  'otraAccion',
  'politicaNoDisponible',
  'sinEvidenciaParaComparar',
];

/** Dato que la accion necesitaba y el objetivo no declaro. Nombres de NEGOCIO, no de campo del DOM. */
export type CampoFaltante = 'destinatario' | 'monto';

/**
 * Dato al que refiere una detencion (faltaDato usa solo los dos de CampoFaltante; noLeible puede
 * referir a cualquiera de los que la verificacion compara). Nombres de NEGOCIO, no del DOM.
 */
export type CampoDeDetencion =
  | CampoFaltante
  | 'producto'
  | 'cantidad'
  | 'asunto'
  | 'cuerpo';

const CAMPOS: readonly CampoDeDetencion[] = [
  'destinatario',
  'monto',
  'producto',
  'cantidad',
  'asunto',
  'cuerpo',
];

/** Detencion serializable. Todos los valores son texto ya CENSURADO por el worker. */
export interface DetencionDeVerificacion {
  motivo: MotivoDetencion;
  /** noCoincide: lo que el objetivo pedia. */
  pedido?: string;
  /** noCoincide: lo que habia en el sitio. Cadena vacia = no habia nada legible. */
  encontrado?: string;
  /** faltaDato: que dato falto en el objetivo. noLeible: que dato no se pudo leer del sitio. */
  campo?: CampoDeDetencion;
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
  if (typeof objeto.campo === 'string' && CAMPOS.includes(objeto.campo as CampoDeDetencion)) {
    detencion.campo = objeto.campo as CampoDeDetencion;
  }
  return detencion;
}
