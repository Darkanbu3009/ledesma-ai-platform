import {
  MAX_ESTRATEGIAS_POR_PASO,
  MAX_PASOS_RECETA,
  MAX_TEXTO_PASO_CHARS,
  esMarcadorParametro,
  ordenarEstrategias,
  parsearEstrategia,
  parsearRuta,
  type EstrategiaLocalizacion,
  type MarcadorParametro,
} from '../recetas/contrato.js';

/**
 * CONTRATO de las GRABACIONES DE TAREA: la forma de los pasos que el worker captura mientras el
 * usuario HACE la tarea el mismo en la vista en vivo, y que se persisten en `grabaciones.pasos`
 * (jsonb, V036).
 *
 * POR QUE EXISTE: la infraestructura de recetas (trayectorias V030, recetas_web V035, ejecutor
 * determinista, escalada selectiva y auto reparacion) ya sabe repetir una tarea sin modelo, pero solo
 * aprende de una corrida del agente que salio bien. La grabacion es la via COMPLEMENTARIA para SEMBRAR
 * una receta en los sitios donde el agente falla de forma repetida, y para arrancar el sistema sin
 * depender de una primera corrida exitosa. NO sustituye al agente: la arquitectura principal sigue
 * siendo la navegacion libre sobre cualquier sitio donde el usuario ya inicio sesion.
 *
 * POR QUE NO ES EL MISMO TIPO QUE `PasoDeReceta`: una grabacion es material CRUDO en revision. Guarda
 * el VALOR que el usuario tecleo (censurado) porque el paso siguiente del flujo es que el usuario mire
 * esos valores y diga cuales cambian cada vez; una receta, en cambio, JAMAS guarda un valor variable,
 * solo su marcador. La conversion de uno a otro (y el borrado de los valores marcados) es
 * `promoverGrabacion` en el worker.
 *
 * INVARIANTE INNEGOCIABLE, aqui en el tipo: NO existe ninguna accion, campo ni forma que pueda
 * representar un login. La grabacion solo se inicia sobre un sitio ya activo y se DETIENE en cuanto
 * aparece un campo de contrasena (el worker descarta lo capturado); ademas todo valor pasa por la
 * censura antes de llegar a este contrato, asi que una contrasena que llegara igual quedaria como
 * marcador y nunca en claro.
 *
 * Modulo PURO, sin dependencias (shared no tiene zod): validacion a mano, mismo estilo que
 * `parsearPasosDeReceta` y `parsearDetencion`.
 */

/**
 * Lo que UN paso grabado HACE. Es un subconjunto estricto de `AccionDeReceta`: no incluye 'esperar'
 * (nadie graba una espera) ni 'verificar' (la verificacion determinista no la graba el usuario: la
 * inserta la promocion, ver `promoverGrabacion`).
 */
export type AccionGrabada = 'click' | 'escribir' | 'teclas' | 'navegar';

const ACCIONES_GRABADAS: readonly AccionGrabada[] = ['click', 'escribir', 'teclas', 'navegar'];

/** UN paso capturado durante una grabacion. */
export interface PasoGrabado {
  /** Posicion en la grabacion, desde 0 y sin huecos. */
  idx: number;
  accion: AccionGrabada;
  /**
   * Formas de localizar el elemento sobre el que actuo el usuario, en el orden del contrato de
   * recetas. Vacia en 'navegar' y en 'teclas' sin elemento enfocado.
   */
  estrategias: EstrategiaLocalizacion[];
  /**
   * Solo 'escribir': lo que el usuario tecleo, YA CENSURADO por el worker. Es lo que el usuario ve
   * para decidir que datos cambian cada vez; los que marque como variables se borran al promover.
   */
  valor: string | null;
  /** Solo 'teclas': combinacion pulsada ('Enter', 'Tab'). */
  teclas: string | null;
  /**
   * Solo 'navegar': RUTA RELATIVA dentro del dominio de la conexion, jamas una URL. Mismo invariante
   * que la receta: una grabacion no puede llevar la sesion del usuario a otro dominio.
   */
  ruta: string | null;
}

/** Tope de pasos de una grabacion: el mismo de una receta (no tendria sentido grabar mas). */
export const MAX_PASOS_GRABACION = MAX_PASOS_RECETA;

/** Tope del texto de la descripcion que el usuario escribe ("que le vas a ensenar"). */
export const MAX_DESCRIPCION_GRABACION_CHARS = 500;

/** Texto no vacio y acotado, o null. */
function comoTextoAcotado(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (limpio === '' || limpio.length > MAX_TEXTO_PASO_CHARS) return null;
  return limpio;
}

/** Combinacion de teclas admitida: mismo patron cerrado que el contrato de recetas. */
const PATRON_TECLAS = /^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/;

/** Valida UN paso grabado con las exigencias propias de cada accion. */
function parsearPaso(crudo: unknown, idxEsperado: number): PasoGrabado | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  if (objeto.idx !== idxEsperado) return null;
  const accion = objeto.accion;
  if (typeof accion !== 'string' || !ACCIONES_GRABADAS.includes(accion as AccionGrabada)) return null;

  const estrategiasCrudas = objeto.estrategias;
  if (!Array.isArray(estrategiasCrudas) || estrategiasCrudas.length > MAX_ESTRATEGIAS_POR_PASO) {
    return null;
  }
  const estrategias: EstrategiaLocalizacion[] = [];
  for (const estrategiaCruda of estrategiasCrudas) {
    const estrategia = parsearEstrategia(estrategiaCruda);
    if (estrategia === null) return null;
    estrategias.push(estrategia);
  }

  const base: PasoGrabado = {
    idx: idxEsperado,
    accion: accion as AccionGrabada,
    estrategias: ordenarEstrategias(estrategias),
    valor: null,
    teclas: null,
    ruta: null,
  };

  switch (base.accion) {
    case 'click':
      // Un click sin ninguna forma de encontrar su elemento no se puede repetir.
      return estrategias.length === 0 ? null : base;
    case 'escribir': {
      if (estrategias.length === 0) return null;
      const valor = comoTextoAcotado(objeto.valor);
      return valor === null ? null : { ...base, valor };
    }
    case 'teclas': {
      const teclas = comoTextoAcotado(objeto.teclas);
      if (teclas === null || !PATRON_TECLAS.test(teclas)) return null;
      return { ...base, teclas };
    }
    case 'navegar': {
      const ruta = parsearRuta(objeto.ruta);
      if (ruta === null) return null;
      // Navegar no actua sobre un elemento: las estrategias sobran y se descartan.
      return { ...base, estrategias: [], ruta };
    }
  }
}

/**
 * Lee los pasos de una grabacion tal como vuelven del jsonb. Devuelve null si no es un arreglo, si
 * excede el tope o si CUALQUIER paso no valida: igual que en las recetas, el rechazo es TOTAL, porque
 * promover una grabacion a la que se le saltaron pasos ensenaria una tarea distinta de la grabada.
 *
 * Un arreglo VACIO si es valido (una grabacion recien creada no tiene pasos todavia); quien promueve
 * es el que exige que haya al menos uno.
 */
export function parsearPasosGrabados(crudo: unknown): PasoGrabado[] | null {
  if (!Array.isArray(crudo) || crudo.length > MAX_PASOS_GRABACION) return null;
  const pasos: PasoGrabado[] = [];
  for (let idx = 0; idx < crudo.length; idx++) {
    const paso = parsearPaso(crudo[idx], idx);
    if (paso === null) return null;
    pasos.push(paso);
  }
  return pasos;
}

/**
 * UN dato que el usuario marco como VARIABLE: el paso de escritura y el tipo de dato que es. Los
 * tipos son EXACTAMENTE los marcadores del contrato de recetas (`MarcadorParametro`): si divergieran,
 * la sustitucion al ejecutar buscaria un parametro que la firma del objetivo nunca produce.
 */
export interface MarcadoDeVariable {
  idx: number;
  marcador: MarcadorParametro;
}

/**
 * Valida la lista de marcados que manda la consola. Devuelve null ante cualquier cosa que no sea una
 * lista de { idx entero >= 0, marcador conocido } sin idx repetidos: un marcado ambiguo decidiria dos
 * cosas distintas para el mismo paso.
 */
export function parsearMarcadosDeVariables(crudo: unknown): MarcadoDeVariable[] | null {
  if (!Array.isArray(crudo) || crudo.length > MAX_PASOS_GRABACION) return null;
  const marcados: MarcadoDeVariable[] = [];
  const vistos = new Set<number>();
  for (const item of crudo) {
    if (typeof item !== 'object' || item === null) return null;
    const objeto = item as Record<string, unknown>;
    const idx = objeto.idx;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= MAX_PASOS_GRABACION) {
      return null;
    }
    if (!esMarcadorParametro(objeto.marcador)) return null;
    if (vistos.has(idx)) return null;
    vistos.add(idx);
    marcados.push({ idx, marcador: objeto.marcador });
  }
  return marcados;
}

/** Estados de una grabacion (mismos literales que el CHECK de V036). */
export type EstadoGrabacion = 'grabando' | 'terminada' | 'descartada';

/**
 * Por que una grabacion quedo DESCARTADA. Los tres son deterministas y ninguno depende de un modelo:
 *  - 'contrasena': aparecio un campo de contrasena (el invariante innegociable). Lo capturado se tira.
 *  - 'vencida': el usuario nunca dijo "ya termine" dentro del plazo de la grabacion.
 *  - 'demasiados_pasos': la grabacion supero el tope de pasos, asi que ya no describe una tarea
 *    repetible; guardar los primeros ensenaria una tarea a medias.
 *  - 'no_repetible': algo de lo que el usuario hizo no dejo ninguna forma estable de volver a
 *    encontrar su elemento. Guardar el resto ensenaria una tarea a la que le falta un paso.
 *  - 'sitio_no_disponible': la conexion dejo de estar en condiciones entre que el usuario pidio
 *    grabar y que el worker tomo el job (se desconecto, caduco, o el contexto ya no se puede leer).
 *    La grabacion nunca llego a empezar.
 */
export type MotivoDescarte =
  | 'contrasena'
  | 'vencida'
  | 'demasiados_pasos'
  | 'no_repetible'
  | 'sitio_no_disponible';

const MOTIVOS: readonly MotivoDescarte[] = [
  'contrasena',
  'vencida',
  'demasiados_pasos',
  'no_repetible',
  'sitio_no_disponible',
];

/** ¿`valor` es uno de los motivos de descarte conocidos? */
export function esMotivoDescarte(valor: unknown): valor is MotivoDescarte {
  return typeof valor === 'string' && MOTIVOS.includes(valor as MotivoDescarte);
}
