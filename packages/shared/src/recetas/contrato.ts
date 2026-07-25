/**
 * CONTRATO de las RECETAS DE TAREA WEB (Fase F, paso 2): la forma de los pasos que se persisten en
 * `recetas_web.pasos` (jsonb, V035) y que el worker RE EJECUTA sin llamar al modelo.
 *
 * DESAMBIGUACION OBLIGATORIA: esto NO es la tabla `recipes` de V013. Aquella es una cadena lineal de
 * INSTRUCCIONES DE TEXTO para un agente conversacional (agent_id + credential_id + steps, encolada
 * con el payload { kind: 'recipe' }). Una RECETA WEB es otra cosa: la traza de LOCALIZACION Y ACCION
 * de una navegacion que ya salio bien, para repetirla sobre el DOM sin inferencia. Ni comparten
 * tabla, ni rutas, ni tipos; por eso el nombre y el namespace son distintos en todo el repo
 * (recetas_web / RecetaWeb / receta-web.ts frente a recipes / Recipe / recipe-payload.ts).
 *
 * POR QUE EL CONTRATO VIVE EN SHARED: los pasos los ESCRIBE el worker y los VALIDA el worker al
 * leerlos, pero el repositorio del backend los persiste y los devuelve como `unknown`. Una sola
 * definicion evita que el productor y el consumidor diverjan en silencio.
 *
 * POR QUE HAY UN PARSER Y NO UN CAST (revision adversarial): entre que la receta se escribe y que se
 * ejecuta hay una fila de base de datos. Una receta ENVENENADA (por una escritura directa, por una
 * restauracion de backup, por un bug futuro) no debe poder dirigir el navegador a donde quiera. Por
 * eso `parsearPasosDeReceta` valida campo por campo y RECHAZA LA RECETA ENTERA ante cualquier cosa
 * que no reconozca, en vez de saltarse el paso raro y ejecutar el resto: una receta a la que le
 * faltan pasos ejecuta una tarea DISTINTA a la aprendida, que es exactamente lo que hay que evitar.
 *
 * DOS INVARIANTES DE SEGURIDAD que el tipo mismo hace cumplir:
 *  1. Un paso de navegacion guarda una RUTA relativa, jamas una URL: el ejecutor la resuelve contra
 *     el dominio de la conexion, asi que ninguna receta puede sacar la sesion del usuario de su
 *     sitio (ni a otro dominio, ni a javascript:, ni a data:).
 *  2. Un paso de escritura guarda un MARCADOR de parametro o un literal, y el marcador se resuelve
 *     con los parametros del objetivo DE ESTA corrida (D8). Los valores sensibles no se guardan.
 *
 * Modulo PURO, sin dependencias (shared no tiene zod): la validacion es a mano, mismo estilo que
 * parsearDetencion en verificacion/contrato.ts.
 */

/**
 * Una forma de VOLVER A ENCONTRAR el elemento sobre el que actuo un paso. La receta guarda una LISTA
 * ORDENADA y el ejecutor las prueba en el orden de `ORDEN_DE_ESTRATEGIAS` (D1), de la mas estable a
 * la mas fragil:
 *  1. `atributo`: un atributo estable puesto por quien programo el sitio (id, name, data-*,
 *     aria-label). Sobrevive a rediseños y a reordenamientos del DOM.
 *  2. `rol`: rol accesible mas nombre accesible ("button" / "Enviar"). Sobrevive a cambios de
 *     maquetacion porque describe la funcion del control, no su posicion.
 *  3. `texto`: texto visible exacto. Sobrevive a cambios de estructura, no a cambios de copy.
 *  4. `xpath`: la ruta absoluta que resolvio el motor de navegacion. ULTIMO RECURSO a proposito: un
 *     xpath tipo /html[1]/body[1]/div[31]/... se rompe con que el sitio inserte un div arriba.
 */
export type EstrategiaLocalizacion =
  | { tipo: 'atributo'; atributo: string; valor: string }
  | { tipo: 'rol'; rol: string; nombre: string }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'xpath'; xpath: string };

/** Orden de INTENTO de las estrategias (D1). El ejecutor no admite otro orden. */
export const ORDEN_DE_ESTRATEGIAS: readonly EstrategiaLocalizacion['tipo'][] = [
  'atributo',
  'rol',
  'texto',
  'xpath',
];

/**
 * ATRIBUTOS admitidos como estrategia estable, en orden de preferencia. Lista CERRADA: un atributo
 * arbitrario podria ser un selector con inyeccion (`onclick`, `style`) o un dato personal (`value`).
 * `data-*` entra por prefijo porque es la convencion de los ganchos de prueba de casi todo framework.
 */
export const ATRIBUTOS_ESTABLES: readonly string[] = [
  'data-testid',
  'data-test',
  'data-qa',
  'data-cy',
  'id',
  'name',
  'aria-label',
];

/** ¿Es `atributo` uno de los admitidos (lista cerrada o prefijo data-)? */
export function esAtributoEstable(atributo: string): boolean {
  return ATRIBUTOS_ESTABLES.includes(atributo) || /^data-[a-z0-9-]{1,40}$/.test(atributo);
}

/**
 * Lo que un paso HACE. Deliberadamente corto: son las acciones que se pueden repetir sobre el DOM con
 * primitivas de bajo nivel, sin inferencia. Todo lo que el motor hace y no cabe aca (extract,
 * ariaTree, screenshot, think, done) NO es un paso de receta: no cambia la pagina y su unico
 * proposito era informar al modelo, que en la ejecucion determinista no participa.
 *
 * `verificar` no toca la pagina: marca el punto EXACTO del flujo en el que, cuando esta tarea se
 * aprendio, corrio la VERIFICACION DETERMINISTA previa a la accion irreversible. Es asi y no un
 * agregado del ejecutor porque de este modo la verificacion viaja DENTRO de la receta, en el mismo
 * lugar del flujo donde ocurrio, y el ejecutor no tiene que adivinar cual de los clicks es el que
 * compromete. La contrapartida (una receta manipulada a la que le quiten el paso) la cubre el
 * ejecutor: si el objetivo contiene un verbo de accion bloqueada y la receta NO trae un paso
 * `verificar`, la receta NO se usa y la tarea corre por el camino normal.
 */
export type AccionDeReceta = 'click' | 'escribir' | 'teclas' | 'navegar' | 'esperar' | 'verificar';

/**
 * PARAMETRO del objetivo que un paso de escritura teclea. Son los MISMOS que extrae
 * parametros-objetivo.ts (el extractor del PR anterior, D3): asi la firma del objetivo, la
 * verificacion determinista y la sustitucion de la receta hablan del mismo vocabulario. Divergir
 * permitiria promover una receta bajo una firma y ejecutarla sustituyendo otra cosa.
 */
export type MarcadorParametro =
  | 'destinatario'
  | 'monto'
  | 'producto'
  | 'cantidad'
  | 'asunto'
  | 'cuerpo';

const MARCADORES: readonly MarcadorParametro[] = [
  'destinatario',
  'monto',
  'producto',
  'cantidad',
  'asunto',
  'cuerpo',
];

/** ¿Es `valor` uno de los marcadores de parametro? */
export function esMarcadorParametro(valor: unknown): valor is MarcadorParametro {
  return typeof valor === 'string' && MARCADORES.includes(valor as MarcadorParametro);
}

/**
 * Lo que un paso de escritura teclea. `parametro` es el caso normal y el unico que puede llevar un
 * dato del usuario: el valor REAL no se guarda nunca (D8), se resuelve en cada corrida con los
 * parametros del objetivo de ESA corrida. `literal` queda para el texto fijo que no depende del
 * objetivo (un filtro, una etiqueta) y que la censura ya declaro no sensible.
 */
export type ValorDePaso =
  | { tipo: 'parametro'; parametro: MarcadorParametro }
  | { tipo: 'literal'; texto: string };

/** UN paso re-ejecutable de una receta web. */
export interface PasoDeReceta {
  /** Posicion en la receta, desde 0 y sin huecos. */
  idx: number;
  accion: AccionDeReceta;
  /**
   * Formas de localizar el elemento, ya ordenadas por `ORDEN_DE_ESTRATEGIAS`. Vacia SOLO en las
   * acciones que no tocan un elemento ('navegar', 'esperar', y 'teclas' sin foco previo).
   */
  estrategias: EstrategiaLocalizacion[];
  /** Solo 'escribir': que teclear. */
  valor: ValorDePaso | null;
  /** Solo 'teclas': combinacion a pulsar ('Enter', 'Tab', 'Control+a'). */
  teclas: string | null;
  /**
   * Solo 'navegar': RUTA RELATIVA (empieza con '/'), jamas una URL. El ejecutor la resuelve contra
   * el dominio de la conexion; una receta no puede sacar la sesion del usuario de su sitio.
   */
  ruta: string | null;
  /** Solo 'esperar': milisegundos, acotados por MAX_ESPERA_MS. */
  esperaMs: number | null;
}

/** Tope de pasos por receta. Muy por encima de una tarea real (la del incidente tenia 15). */
export const MAX_PASOS_RECETA = 80;
/** Tope de estrategias por paso: cuatro tipos, con margen para varios atributos estables. */
export const MAX_ESTRATEGIAS_POR_PASO = 8;
/** Tope de longitud de cualquier texto dentro de un paso (selector, nombre, texto visible, ruta). */
export const MAX_TEXTO_PASO_CHARS = 512;
/** Tope de una espera declarada por la receta: mas alla de esto es un cuelgue, no una espera. */
export const MAX_ESPERA_MS = 15_000;

/** Texto no vacio y acotado, o null. */
function comoTextoAcotado(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (limpio === '' || limpio.length > MAX_TEXTO_PASO_CHARS) return null;
  return limpio;
}

/**
 * Valida UNA estrategia. Devuelve null ante cualquier cosa que no sea exactamente una de las cuatro
 * formas con sus campos completos: el llamador rechaza la receta entera.
 */
export function parsearEstrategia(crudo: unknown): EstrategiaLocalizacion | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  switch (objeto.tipo) {
    case 'atributo': {
      const atributo = comoTextoAcotado(objeto.atributo)?.toLowerCase();
      const valor = comoTextoAcotado(objeto.valor);
      if (atributo === undefined || valor === null || !esAtributoEstable(atributo)) return null;
      return { tipo: 'atributo', atributo, valor };
    }
    case 'rol': {
      const rol = comoTextoAcotado(objeto.rol);
      const nombre = comoTextoAcotado(objeto.nombre);
      if (rol === null || nombre === null) return null;
      return { tipo: 'rol', rol, nombre };
    }
    case 'texto': {
      const texto = comoTextoAcotado(objeto.texto);
      return texto === null ? null : { tipo: 'texto', texto };
    }
    case 'xpath': {
      const xpath = comoTextoAcotado(objeto.xpath);
      // Un xpath que no empieza por / o ( no es una ruta: seria una expresion arbitraria.
      if (xpath === null || !/^[/(]/.test(xpath)) return null;
      return { tipo: 'xpath', xpath };
    }
    default:
      return null;
  }
}

/** Ordena las estrategias por ORDEN_DE_ESTRATEGIAS conservando el orden relativo dentro de un tipo. */
export function ordenarEstrategias(
  estrategias: EstrategiaLocalizacion[],
): EstrategiaLocalizacion[] {
  return [...estrategias].sort(
    (a, b) => ORDEN_DE_ESTRATEGIAS.indexOf(a.tipo) - ORDEN_DE_ESTRATEGIAS.indexOf(b.tipo),
  );
}

/**
 * RUTA de un paso de navegacion: relativa, que empieza con una sola barra y sin `//` inicial (que el
 * navegador interpretaria como otro origen). Devuelve null si no cumple; el llamador rechaza.
 */
export function parsearRuta(crudo: unknown): string | null {
  const ruta = comoTextoAcotado(crudo);
  if (ruta === null) return null;
  if (!ruta.startsWith('/') || ruta.startsWith('//')) return null;
  // Ni espacios ni caracteres de control (todo lo que va por debajo de '!'): una ruta real ya
  // viene percent-encoded, y un salto de linea colado ahi es la forma clasica de que el navegador
  // resuelva otro esquema al concatenarla.
  for (const caracter of ruta) {
    if (caracter.codePointAt(0) !== undefined && (caracter.codePointAt(0) as number) < 0x21) {
      return null;
    }
  }
  return ruta;
}

const ACCIONES: readonly AccionDeReceta[] = [
  'click',
  'escribir',
  'teclas',
  'navegar',
  'esperar',
  'verificar',
];

/** ¿La receta declara donde corre la verificacion determinista previa a la accion irreversible? */
export function tienePasoDeVerificacion(pasos: PasoDeReceta[]): boolean {
  return pasos.some((paso) => paso.accion === 'verificar');
}

/** Valida el `valor` de un paso de escritura (marcador de parametro o literal acotado). */
function parsearValor(crudo: unknown): ValorDePaso | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  if (objeto.tipo === 'parametro' && esMarcadorParametro(objeto.parametro)) {
    return { tipo: 'parametro', parametro: objeto.parametro };
  }
  if (objeto.tipo === 'literal') {
    const texto = comoTextoAcotado(objeto.texto);
    return texto === null ? null : { tipo: 'literal', texto };
  }
  return null;
}

/** Combinacion de teclas admitida: nombres de tecla y modificadores separados por '+'. */
const PATRON_TECLAS = /^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/;

/** Valida UN paso completo, con las exigencias propias de cada accion. */
function parsearPaso(crudo: unknown, idxEsperado: number): PasoDeReceta | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  if (objeto.idx !== idxEsperado) return null;
  const accion = objeto.accion;
  if (typeof accion !== 'string' || !ACCIONES.includes(accion as AccionDeReceta)) return null;

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

  const paso: PasoDeReceta = {
    idx: idxEsperado,
    accion: accion as AccionDeReceta,
    estrategias: ordenarEstrategias(estrategias),
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
  };

  switch (paso.accion) {
    case 'click':
      // Un click sin ninguna forma de encontrar su elemento no es re-ejecutable.
      if (estrategias.length === 0) return null;
      return paso;
    case 'escribir': {
      if (estrategias.length === 0) return null;
      const valor = parsearValor(objeto.valor);
      if (valor === null) return null;
      return { ...paso, valor };
    }
    case 'teclas': {
      const teclas = comoTextoAcotado(objeto.teclas);
      if (teclas === null || !PATRON_TECLAS.test(teclas)) return null;
      return { ...paso, teclas };
    }
    case 'navegar': {
      const ruta = parsearRuta(objeto.ruta);
      if (ruta === null) return null;
      // Navegar no actua sobre un elemento: las estrategias sobran y se descartan.
      return { ...paso, estrategias: [], ruta };
    }
    case 'esperar': {
      const ms = objeto.esperaMs;
      if (typeof ms !== 'number' || !Number.isInteger(ms) || ms <= 0 || ms > MAX_ESPERA_MS) {
        return null;
      }
      return { ...paso, estrategias: [], esperaMs: ms };
    }
    case 'verificar':
      // No lleva ningun dato: lo que se verifica sale del objetivo de la corrida y del DOM de ese
      // momento, jamas de la receta. Una receta no puede influir en su propia verificacion.
      return { ...paso, estrategias: [] };
  }
}

/**
 * Lee los pasos de una receta tal como vuelven del jsonb. Devuelve null (RECETA INVALIDA, no se
 * ejecuta) si no es un arreglo, si excede el tope, si esta vacio, o si CUALQUIER paso no valida.
 *
 * El rechazo es TOTAL a proposito (ver cabecera): ejecutar una receta a la que se le saltaron los
 * pasos que no validaron seria ejecutar una tarea distinta de la que el usuario aprobo en su dia.
 */
export function parsearPasosDeReceta(crudo: unknown): PasoDeReceta[] | null {
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > MAX_PASOS_RECETA) return null;
  const pasos: PasoDeReceta[] = [];
  for (let idx = 0; idx < crudo.length; idx++) {
    const paso = parsearPaso(crudo[idx], idx);
    if (paso === null) return null;
    pasos.push(paso);
  }
  return pasos;
}
