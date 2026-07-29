import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { sanearEstrategias } from './localizacion.js';
import type { CampoDeLaPagina } from './verificacion.js';
import type { Logger } from './logger.js';

/**
 * PERCEPCION DE EFECTO Y DE CAMPOS (FIX A y B). Modulo PURO (sin SDK, sin navegador): la unica
 * entrada al DOM es la expresion que construye `construirExpresionPercepcion`, y quien la evalua es
 * el adaptador de Browserbase. Todo lo demas se testea con fakes.
 *
 * POR QUE EXISTE (evidencia de produccion del 27 jul 2026, grabaciones cuadro por cuadro): el motor
 * marco como exitoso un click sobre Redactar que NUNCA abrio el compose de Gmail, y todo el texto
 * tecleado despues aterrizo en la BARRA DE BUSQUEDA, que es un input normal y acepta el tecleo sin
 * error. El agente no percibia ni el foco ni donde quedaba lo que tecleaba, asi que reporto exito
 * paso a paso con cero borradores creados. Este modulo cierra ese hueco:
 *
 *  - Tras cada CLICK (act con method click, o la tool nativa `click`) se compara una HUELLA ligera
 *    de la pagina (URL, titulo, conteo de nodos, campos) antes y despues. Si nada cambio, el paso se
 *    reporta al agente como "click ejecutado SIN efecto visible", no como exito.
 *  - Tras cada ESCRITURA (act con method fill/type, o la tool nativa `type`) se lee con el MISMO
 *    lector de campos de browserbase.ts (el que distingue chips, tokens y pills) DONDE aterrizo el
 *    texto y que elemento tiene el foco. Si aterrizo en un elemento distinto al que el agente
 *    declaro como objetivo, la linea lo dice explicitamente para que corrija.
 *
 * LECTURA FUSIONADA PARA EL ATLAS: la conexion CDP que la percepcion ya abre despues de cada paso
 * lee, en la MISMA evaluacion, las estrategias de localizacion del elemento que el paso toco (rol,
 * nombre accesible, aria-label, data-*), leidas del DOM real y nunca derivadas del texto del modelo.
 * Es lo que le permite al motor libre alimentar el aprendizaje comun sin abrir ni una conexion mas,
 * sin un token mas y sin cambiar una sola linea de lo que el agente ve.
 *
 * PRESUPUESTO DE CONTEXTO: las lineas pendientes se entregan por turno con un tope duro
 * (MAX_LINEAS_POR_TURNO); el costo por corrida importa y este canal no puede crecer sin cota. El
 * dato del atlas NO viaja por esa cola: no es una linea, no ocupa una ranura y el modelo no lo ve.
 *
 * PRIVACIDAD: las lineas citan el CONTEXTO de un campo (name, id, aria-label...), nunca vuelcan la
 * pagina; el texto tecleado ya lo conoce el modelo (el lo escribio) y no se repite en los logs.
 */

/** Un campo percibido: lo mismo que lee la verificacion, mas si el valor salio de CHIPS. */
export interface CampoPercibido extends CampoDeLaPagina {
  /** true si el valor NO estaba en el input sino en chips confirmados de su contenedor. */
  porChips?: boolean;
}

/** Foto ligera de la pagina: la huella de efecto mas el estado de foco y de campos. */
export interface PercepcionDePagina {
  url: string;
  titulo: string;
  /** Conteo de nodos del documento: el detector mas barato de "aparecio algo". */
  nodos: number;
  /** Descriptor textual del elemento con foco (tag, type, name, id, placeholder, aria-label). */
  foco: string | null;
  campos: CampoPercibido[];
  /**
   * ATLAS DE SITIOS: las estrategias de localizacion del elemento que el paso TOCO, leidas del DOM
   * real en ESTA MISMA evaluacion (ver `construirExpresionPercepcion`). Solo viene cuando el
   * llamador pidio un objetivo de lectura; ausente = la percepcion corrio como siempre. NO participa
   * de la huella ni de ninguna linea que vea el modelo: es un dato para el aprendizaje comun.
   */
  estrategias?: EstrategiaLocalizacion[];
}

/**
 * QUE ELEMENTO tiene que leer la percepcion para alimentar el atlas de sitios. Es la unica entrada
 * nueva a la expresion y solo decide DE DONDE se leen las estrategias; nada de lo que la percepcion
 * ya reportaba depende de ella.
 *
 *  - `xpath`: el selector que el motor resolvio para el paso (el elemento exacto sobre el que actuo).
 *  - `campo`: tras una ESCRITURA, el campo donde aterrizo el texto (mismo criterio que
 *    `campoDondeAterrizo`, aplicado dentro de la pagina); sin coincidencia, el elemento enfocado.
 *  - `foco`: el elemento enfocado, que es lo unico que queda de un click resuelto por VISION (no
 *    deja selector) o de un click por coordenadas.
 */
export type ObjetivoDeLectura =
  | { tipo: 'foco' }
  | { tipo: 'xpath'; xpath: string }
  | { tipo: 'campo'; texto: string };

/**
 * PUERTO de lectura: lo implementa el handler sobre browserbase.percibirPagina. Nunca lanza.
 *
 * `objetivo` (ATLAS DE SITIOS) pide que la MISMA evaluacion devuelva ademas las estrategias del
 * elemento tocado. Es opcional de punta a punta: sin el, la lectura es exactamente la de siempre.
 */
export interface PerceptorDePagina {
  percibir(objetivo?: ObjetivoDeLectura | undefined): Promise<PercepcionDePagina | null>;
}

/** Tope DURO de lineas de percepcion que se adjuntan al contexto del agente por turno. */
export const MAX_LINEAS_POR_TURNO = 10;

/** Tope del descriptor de un campo o una accion dentro de una linea (el contexto ya viene acotado). */
const MAX_DESCRIPTOR_CHARS = 90;

/** Prefijo de TODAS las lineas: el agente debe distinguirlas del contenido de la pagina. */
export const PREFIJO_PERCEPCION = 'PERCEPCION DEL SISTEMA';

/** Tope del texto tecleado que viaja dentro de la expresion para ubicar el campo donde aterrizo. */
const MAX_TEXTO_A_UBICAR = 200;

/**
 * LECTURA FUSIONADA de las estrategias del elemento tocado (ATLAS DE SITIOS): que elemento leer y con
 * que ayudantes de DOM. `ayudantes` es AYUDANTES_DOM de localizacion.ts y llega por parametro con el
 * mismo criterio que el lector de campos (que quien compone sea el adaptador del navegador).
 */
export interface LecturaDeEstrategias {
  ayudantes: string;
  objetivo: ObjetivoDeLectura;
}

/**
 * El BLOQUE que lee las estrategias del elemento tocado, para inyectarlo DENTRO de la evaluacion de
 * percepcion. Cadena vacia si nadie pidio la lectura, y entonces la expresion resultante es byte a
 * byte la de siempre.
 *
 * Va en su propio IIFE con su propio try/catch: si algo de aqui adentro falla (el elemento ya no
 * esta, el sitio rompio una API que los ayudantes usan), devuelve null y la percepcion sigue
 * entregando exactamente lo que entregaba antes. Degradar aqui cuesta un dato del atlas, nunca una
 * linea de percepcion ni el desenlace del job.
 *
 * El texto tecleado viaja DENTRO de la expresion para poder ubicar el campo donde aterrizo con el
 * mismo criterio que `campoDondeAterrizo` (exacta primero, contenida despues). Es un dato que ya
 * vive en esa misma pagina porque el agente lo acaba de escribir ahi, se evalua en el mundo aislado
 * y no se persiste en ningun lado.
 */
function bloqueDeEstrategias(lectura: LecturaDeEstrategias | undefined): string {
  if (lectura === undefined) return '';
  const objetivo = lectura.objetivo;
  const elemento =
    objetivo.tipo === 'xpath'
      ? // Sin respaldo al foco a proposito: si el elemento del selector ya no esta (un click que
        // cerro el compose), el foco quedo en OTRA cosa y guardarla seria atribuirle al paso un
        // elemento que nunca toco.
        `porXpath(${JSON.stringify(objetivo.xpath)})`
      : objetivo.tipo === 'campo'
        ? `campoConElTexto(${JSON.stringify(objetivo.texto.slice(0, MAX_TEXTO_A_UBICAR))}) || enfocado()`
        : 'enfocado()';
  return String.raw`  const estrategias = (() => {
    try {
${lectura.ayudantes}
      const enfocado = () => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        return !el || el === document.body || el === document.documentElement ? null : el;
      };
      const plano = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
      const campoConElTexto = (buscado) => {
        const objetivo = plano(buscado);
        if (objetivo === '') return null;
        let contiene = null;
        for (const nodo of document.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) {
          const tag = String(nodo.tagName || '').toLowerCase();
          if (plano(nodo.getAttribute && nodo.getAttribute('type')) === 'password') continue;
          let valor = '';
          if (tag === 'select') {
            const opcion = nodo.selectedOptions && nodo.selectedOptions[0];
            valor = opcion ? (opcion.textContent || opcion.value || '') : (nodo.value || '');
          } else if (tag === 'input' || tag === 'textarea') {
            valor = nodo.value || '';
          } else {
            valor = nodo.innerText || nodo.textContent || '';
          }
          const actual = plano(valor);
          if (actual === '') continue;
          if (actual === objetivo) return nodo;
          if (contiene === null && actual.indexOf(objetivo) !== -1) contiene = nodo;
        }
        return contiene;
      };
      const el = ${elemento};
      if (!el || el.nodeType !== 1) return null;
      return estrategiasDe(el);
    } catch (e) { return null; }
  })();
`;
}

/**
 * Construye la expresion de percepcion COMPONIENDO el lector de campos existente (EXPRESION_LEER_CAMPOS
 * de browserbase.ts, que llega por parametro para no crear un ciclo de imports): mismos campos, mismos
 * chips, mas la huella (URL, titulo, nodos) y el descriptor del elemento con foco. Solo lectura.
 *
 * `lectura` (ATLAS DE SITIOS) FUSIONA en esta misma evaluacion la lectura de las estrategias del
 * elemento que el paso toco. Es lo que permite que el motor libre alimente el atlas sin abrir ni una
 * conexion CDP mas: el dato ya estaba en la pagina que la percepcion abre despues de cada paso, y
 * hasta ahora se descartaba. SIN el parametro la expresion es la de siempre, caracter por caracter.
 */
export function construirExpresionPercepcion(
  expresionCampos: string,
  lectura?: LecturaDeEstrategias,
): string {
  const estrategias = bloqueDeEstrategias(lectura);
  return String.raw`(() => {
  const camposCrudo = ${expresionCampos};
  let campos = [];
  try { campos = JSON.parse(camposCrudo); } catch (e) { campos = []; }
  const foco = (() => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const atributo = (nombre) => (el.getAttribute ? (el.getAttribute(nombre) || '') : '');
    const partes = [
      String(el.tagName || '').toLowerCase(),
      atributo('type'),
      atributo('name'),
      atributo('id'),
      atributo('placeholder'),
      atributo('aria-label'),
      atributo('role') ? 'role=' + atributo('role') : '',
    ];
    const texto = partes.join(' ').replace(/\s+/g, ' ').trim();
    return texto === '' ? null : texto.slice(0, 200);
  })();
${estrategias}  return JSON.stringify({
    url: String(location.href || '').slice(0, 500),
    titulo: String(document.title || '').slice(0, 200),
    nodos: document.querySelectorAll('*').length,
    foco: foco,
    campos: campos,${estrategias === '' ? '' : '\n    estrategias: estrategias,'}
  });
})()`;
}

/** Parsea (tolerante) lo que la expresion devolvio. null = no se pudo leer; jamas lanza. */
export function parsearPercepcion(crudo: string | null): PercepcionDePagina | null {
  if (crudo === null || crudo === '') return null;
  try {
    const parsed: unknown = JSON.parse(crudo);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { url, titulo, nodos, foco, campos, estrategias } = parsed as {
      url?: unknown;
      titulo?: unknown;
      nodos?: unknown;
      foco?: unknown;
      campos?: unknown;
      estrategias?: unknown;
    };
    if (typeof url !== 'string' || typeof titulo !== 'string' || typeof nodos !== 'number') {
      return null;
    }
    const listaCampos: CampoPercibido[] = Array.isArray(campos)
      ? campos.flatMap((item): CampoPercibido[] => {
          if (typeof item !== 'object' || item === null) return [];
          const campo = item as { contexto?: unknown; valor?: unknown; noLeible?: unknown; porChips?: unknown };
          if (typeof campo.contexto !== 'string' || typeof campo.valor !== 'string') return [];
          return [
            {
              contexto: campo.contexto,
              valor: campo.valor,
              ...(campo.noLeible === true ? { noLeible: true } : {}),
              ...(campo.porChips === true ? { porChips: true } : {}),
            },
          ];
        })
      : [];
    // Las estrategias pasan por el MISMO saneo que las de la trayectoria (sanearEstrategias): valida
    // contra el contrato, DESCARTA lo que la censura toca y acota. Lo que llegue mal (o no llegue)
    // deja la percepcion intacta y sin dato para el atlas.
    const leidas = Array.isArray(estrategias) ? sanearEstrategias(JSON.stringify(estrategias)) : [];
    return {
      url,
      titulo,
      nodos,
      foco: typeof foco === 'string' && foco !== '' ? foco : null,
      campos: listaCampos,
      ...(leidas.length > 0 ? { estrategias: leidas } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * HUELLA de efecto: dos percepciones son "la misma pagina" si nada observable cambio (URL, titulo,
 * conteo de nodos y campos con sus valores). El FOCO queda FUERA a proposito: un click siempre mueve
 * el foco al elemento clickeado, con o sin efecto, y contarlo daria por efectivo cualquier click.
 */
export function mismaHuella(a: PercepcionDePagina, b: PercepcionDePagina): boolean {
  return (
    a.url === b.url &&
    a.titulo === b.titulo &&
    a.nodos === b.nodos &&
    JSON.stringify(a.campos) === JSON.stringify(b.campos)
  );
}

function truncar(texto: string, max: number): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length <= max ? plano : `${plano.slice(0, max)}...`;
}

/** Normaliza para comparar texto tecleado contra valores de campos (espacios y mayusculas). */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** El campo cuyo valor CONTIENE el texto tecleado, o null. Prefiere la coincidencia exacta. */
export function campoDondeAterrizo(
  percepcion: PercepcionDePagina,
  texto: string,
): CampoPercibido | null {
  const buscado = normalizar(texto);
  if (buscado === '') return null;
  let contiene: CampoPercibido | null = null;
  for (const campo of percepcion.campos) {
    const valor = normalizar(campo.valor);
    if (valor === buscado) return campo;
    if (contiene === null && valor.includes(buscado)) contiene = campo;
  }
  return contiene;
}

/** Palabras de relleno de una descripcion de accion, que no identifican al campo objetivo. */
const PALABRAS_DE_RELLENO = new Set([
  'type',
  'types',
  'typing',
  'into',
  'the',
  'field',
  'input',
  'box',
  'text',
  'textbox',
  'enter',
  'write',
  'fill',
  'with',
  'and',
  'escribe',
  'escribir',
  'teclea',
  'teclear',
  'campo',
  'casilla',
  'cuadro',
  'texto',
  'del',
  'las',
  'los',
  'una',
  'uno',
  'que',
  'con',
]);

/**
 * Tokens de la DESCRIPCION de la accion que pueden identificar al campo objetivo ("To", "Para",
 * "subject"...). Se retira el texto tecleado (va entre comillas o tal cual) y las palabras de
 * relleno; una palabra corta solo cuenta si venia capitalizada ("To", "Cc"), que es como los sitios
 * nombran sus campos.
 */
export function tokensDelObjetivoDeclarado(descripcion: string, textoTecleado: string): string[] {
  const sinTexto = textoTecleado === '' ? descripcion : descripcion.split(textoTecleado).join(' ');
  const palabras = sinTexto.replace(/["'`]/g, ' ').split(/[^\p{L}\p{N}@.-]+/u);
  const tokens: string[] = [];
  for (const palabra of palabras) {
    if (palabra === '') continue;
    const minuscula = palabra.toLowerCase();
    if (PALABRAS_DE_RELLENO.has(minuscula)) continue;
    const capitalizada = palabra[0] !== undefined && palabra[0] === palabra[0].toUpperCase();
    if (palabra.length < 3 && !capitalizada) continue;
    if (!tokens.includes(minuscula)) tokens.push(minuscula);
  }
  return tokens;
}

/**
 * EQUIVALENCIAS MINIMAS entre nombres del MISMO campo de formulario en distintos idiomas o
 * variantes (evidencia de produccion: el texto aterrizo en "Destinatarios en Para" y el objetivo
 * declarado decia "the To field"; el matcher literal no lo reconocia y sugeria deshacer un tecleo
 * correcto). Se usa SOLO para SUPRIMIR el aviso de discrepancia cuando el campo real y el declarado
 * son equivalentes; jamas para afirmar una discrepancia nueva. La linea "texto aterrizo en" se
 * conserva siempre, con o sin equivalencia.
 */
const CAMPOS_EQUIVALENTES: readonly (readonly string[])[] = [
  ['to', 'para', 'destinatarios', 'recipients'],
  ['subject', 'asunto'],
  ['body', 'cuerpo', 'mensaje', 'message'],
];

/** Grupos de CAMPOS_EQUIVALENTES que una descripcion nombra COMO PALABRA COMPLETA. */
function gruposDeCampoNombrados(descripcion: string): number[] {
  const palabras = descripcion
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((palabra) => palabra !== '');
  const grupos: number[] = [];
  CAMPOS_EQUIVALENTES.forEach((grupo, indice) => {
    if (palabras.some((palabra) => grupo.includes(palabra))) grupos.push(indice);
  });
  return grupos;
}

/**
 * ¿Las dos descripciones nombran el MISMO campo de formulario? Usa la tabla CAMPOS_EQUIVALENTES con
 * el mismo criterio del matcher de arriba (palabra completa, no substring). La usa la promocion
 * (receta-web.ts, derivacion cruzada): un paso de escritura sin localizacion solo puede adoptar el
 * localizador de un paso adyacente cuando ambos hablan del mismo campo. Devuelve false si alguna
 * descripcion falta o no nombra ningun campo conocido: sin evidencia no se adopta nada.
 */
export function describenElMismoCampo(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const gruposDeA = gruposDeCampoNombrados(a);
  if (gruposDeA.length === 0) return false;
  const gruposDeB = new Set(gruposDeCampoNombrados(b));
  return gruposDeA.some((grupo) => gruposDeB.has(grupo));
}

/**
 * ¿El contexto del campo donde aterrizo el texto corresponde al objetivo que el agente declaro?
 * Best-effort deliberado: sin tokens utiles no se afirma discrepancia (la linea de aterrizaje ya
 * le muestra al agente donde quedo el texto, que es la informacion que importa). Un token que no
 * aparece literal en el contexto todavia cuenta como coincidencia si el contexto contiene, COMO
 * PALABRA, un sinonimo del mismo campo (tabla CAMPOS_EQUIVALENTES): por palabra completa y no por
 * substring, para que un "to" dentro de "editor" no suprima un aviso legitimo.
 */
export function coincideConObjetivoDeclarado(
  descripcion: string,
  textoTecleado: string,
  contextoDelCampo: string,
): boolean | null {
  const tokens = tokensDelObjetivoDeclarado(descripcion, textoTecleado);
  if (tokens.length === 0) return null;
  const contexto = contextoDelCampo.toLowerCase();
  if (tokens.some((token) => contexto.includes(token))) return true;
  const palabrasDelContexto = contexto.split(/[^\p{L}\p{N}]+/u).filter((palabra) => palabra !== '');
  return tokens.some((token) =>
    CAMPOS_EQUIVALENTES.some(
      (grupo) => grupo.includes(token) && palabrasDelContexto.some((palabra) => grupo.includes(palabra)),
    ),
  );
}

/** Linea del click ejecutado sin efecto observable. */
export function lineaDeClickSinEfecto(descripcion: string): string {
  return (
    `${PREFIJO_PERCEPCION}: el click "${truncar(descripcion, MAX_DESCRIPTOR_CHARS)}" se ejecuto ` +
    'SIN efecto visible en la pagina (misma URL, mismo titulo, mismos nodos y mismos campos). NO lo ' +
    'des por hecho: localiza el elemento por su funcion (rol o aria-label) y vuelve a intentarlo.'
  );
}

/** Lineas del aterrizaje de un texto tecleado (1 a 2 lineas, segun haya discrepancia). */
export function lineasDeAterrizaje(params: {
  percepcion: PercepcionDePagina;
  texto: string;
  descripcion: string;
}): string[] {
  const campo = campoDondeAterrizo(params.percepcion, params.texto);
  if (campo === null) {
    const foco = params.percepcion.foco ?? 'desconocido';
    return [
      `${PREFIJO_PERCEPCION}: el texto tecleado NO aparece en ningun campo legible de la pagina; ` +
        `foco actual: [${truncar(foco, MAX_DESCRIPTOR_CHARS)}]. Verifica donde quedo antes de seguir.`,
    ];
  }
  const sufijo = campo.porChips === true ? ' (chip confirmado)' : '';
  const lineas = [
    `${PREFIJO_PERCEPCION}: texto aterrizo en: [${truncar(campo.contexto, MAX_DESCRIPTOR_CHARS)}]${sufijo}`,
  ];
  const coincide = coincideConObjetivoDeclarado(params.descripcion, params.texto, campo.contexto);
  if (coincide === false) {
    lineas.push(
      `${PREFIJO_PERCEPCION}: ese campo NO parece ser el objetivo que declaraste ` +
        `("${truncar(params.descripcion, MAX_DESCRIPTOR_CHARS)}"). Deshaz lo tecleado ahi y enfoca ` +
        'el campo correcto antes de reescribir.',
    );
  }
  return lineas;
}

/** Lo minimo de un evento step_finished que la percepcion interpreta (mismo shape que stagehand.ts). */
export interface EventoDePasoPercibido {
  actionName: string;
  actionArgs: Record<string, unknown>;
  toolOutput: { result?: unknown };
}

/** Interpretacion de un paso: que percepcion le corresponde. */
export type PasoInterpretado =
  | { tipo: 'click'; descripcion: string }
  | { tipo: 'escritura'; descripcion: string; texto: string }
  | { tipo: 'refrescar' }
  | { tipo: 'ignorar' };

/** Tools que NO tocan la pagina: no se paga una lectura de percepcion por ellas. */
const TOOLS_SIN_EFECTO_EN_PAGINA = new Set(['screenshot', 'extract', 'ariaTree', 'done']);

function textoDeArgumento(args: Record<string, unknown>, clave: string): string {
  const valor = args[clave];
  return typeof valor === 'string' ? valor : '';
}

/** El objeto Action resuelto de una salida de act ({ selector, method, arguments, description }). */
function actionDeSalidaDeAct(result: unknown): {
  method: string;
  argumentos: string[];
  /** Selector que el motor resolvio, ya sin el prefijo de Stagehand. null = lo resolvio por vision. */
  xpath: string | null;
} | null {
  if (typeof result !== 'object' || result === null) return null;
  const envoltorio = result as { output?: unknown; playwrightArguments?: unknown };
  const salida =
    typeof envoltorio.output === 'object' && envoltorio.output !== null
      ? (envoltorio.output as { playwrightArguments?: unknown })
      : envoltorio;
  const accion = salida.playwrightArguments;
  if (typeof accion !== 'object' || accion === null) return null;
  const { method, arguments: argumentos, selector } = accion as {
    method?: unknown;
    arguments?: unknown;
    selector?: unknown;
  };
  if (typeof method !== 'string') return null;
  return {
    method,
    argumentos: Array.isArray(argumentos)
      ? argumentos.filter((a): a is string => typeof a === 'string')
      : [],
    xpath: typeof selector === 'string' ? xpathDeSelector(selector) : null,
  };
}

/** Prefijo con el que Stagehand entrega sus selectores ('xpath=/html[1]/...'). */
const PREFIJO_XPATH = 'xpath=';

/** El xpath de un selector del motor, o null si no lo es (nunca se adivina un elemento). */
function xpathDeSelector(selector: string): string | null {
  const crudo = selector.startsWith(PREFIJO_XPATH) ? selector.slice(PREFIJO_XPATH.length) : selector;
  return crudo.startsWith('/') ? crudo : null;
}

/** Metodos de act que ESCRIBEN texto en el elemento resuelto. */
const METODOS_DE_ESCRITURA = new Set(['fill', 'type', 'sendKeys', 'setValue']);

/**
 * Clasifica UN paso del motor para decidir que percepcion corre despues de el:
 *  - act con method click -> click; act con method de escritura -> escritura (texto = argumento 1).
 *  - tools nativas `click` y `type` (modo hibrido, por coordenadas) -> lo mismo.
 *  - keys / goto / navback / scroll / fillForm -> solo refrescar la huella (la pagina pudo cambiar).
 *  - screenshot / extract / ariaTree / done -> ignorar (la pagina no cambio; no se paga la lectura).
 */
export function interpretarPaso(evento: EventoDePasoPercibido): PasoInterpretado {
  if (TOOLS_SIN_EFECTO_EN_PAGINA.has(evento.actionName)) return { tipo: 'ignorar' };
  if (evento.actionName === 'click') {
    return { tipo: 'click', descripcion: textoDeArgumento(evento.actionArgs, 'describe') };
  }
  if (evento.actionName === 'type') {
    const texto = textoDeArgumento(evento.actionArgs, 'text');
    if (texto !== '') {
      return {
        tipo: 'escritura',
        descripcion: textoDeArgumento(evento.actionArgs, 'describe'),
        texto,
      };
    }
    return { tipo: 'refrescar' };
  }
  if (evento.actionName === 'act') {
    const accion = actionDeSalidaDeAct(evento.toolOutput.result);
    const descripcion = textoDeArgumento(evento.actionArgs, 'action');
    if (accion === null) return { tipo: 'refrescar' };
    if (accion.method === 'click') return { tipo: 'click', descripcion };
    if (METODOS_DE_ESCRITURA.has(accion.method) && accion.argumentos[0] !== undefined) {
      return { tipo: 'escritura', descripcion, texto: accion.argumentos[0] };
    }
    return { tipo: 'refrescar' };
  }
  return { tipo: 'refrescar' };
}

/**
 * QUE ELEMENTO leer para el ATLAS en un paso dado, o null si ese paso no aporta ninguno. Se decide
 * aparte de `interpretarPaso` a proposito: aquella funcion gobierna las LINEAS que ve el modelo y no
 * se toca; esta solo elige de donde salen las estrategias que van al aprendizaje comun.
 *
 * El criterio es el mismo con el que el atlas clasifica los pasos de la traza (accionDelPasoDeTraza):
 * solo los pasos que terminan siendo `click` o `escribir` tienen clase de elemento, asi que solo esos
 * piden lectura y el resto no gasta ni una linea de JavaScript en la pagina.
 *
 *  - ESCRITURA (act con fill/type/setValue, o la tool nativa `type`): el campo donde aterrizo el
 *    texto, que es el unico que demuestra donde quedo de verdad lo que se escribio.
 *  - CLICK con selector resuelto: ese elemento exacto.
 *  - CLICK resuelto por VISION (el act no trae playwrightArguments) o por coordenadas: el elemento
 *    enfocado, que es la unica referencia que queda de esos dos caminos.
 */
export function objetivoDeLectura(evento: EventoDePasoPercibido): ObjetivoDeLectura | null {
  if (TOOLS_SIN_EFECTO_EN_PAGINA.has(evento.actionName)) return null;
  if (evento.actionName === 'click') return { tipo: 'foco' };
  if (evento.actionName === 'type') {
    const texto = textoDeArgumento(evento.actionArgs, 'text');
    return texto === '' ? null : { tipo: 'campo', texto };
  }
  if (evento.actionName !== 'act') return null;
  const accion = actionDeSalidaDeAct(evento.toolOutput.result);
  // Un act sin accion resuelta es un click por vision: para el atlas cuenta como click (mismo
  // criterio que accionDelPasoDeTraza) y lo unico que queda de el es el foco.
  if (accion === null) return { tipo: 'foco' };
  if (METODOS_DE_ESCRITURA.has(accion.method) && accion.argumentos[0] !== undefined) {
    return { tipo: 'campo', texto: accion.argumentos[0] };
  }
  if (accion.method !== 'click') return null;
  return accion.xpath !== null ? { tipo: 'xpath', xpath: accion.xpath } : { tipo: 'foco' };
}

/** Control de percepcion de UNA corrida del motor: acumula lineas y las entrega por turno. */
export interface ControlDePercepcion {
  /** Toma la huella INICIAL (el "antes" del primer paso). Best-effort: nunca lanza. */
  inicializar(): Promise<void>;
  /**
   * Corre la percepcion que corresponda al paso recien terminado. Best-effort: nunca lanza.
   *
   * Devuelve las estrategias del elemento que ese paso toco (ATLAS DE SITIOS), leidas en la MISMA
   * evaluacion que la percepcion. Lista vacia cuando el paso no toca ningun elemento, cuando la
   * lectura no encontro nada o cuando fallo: aprender es una mejora, nunca una condicion.
   */
  alTerminarPaso(evento: EventoDePasoPercibido): Promise<EstrategiaLocalizacion[]>;
  /** Drena las lineas pendientes (acotadas a MAX_LINEAS_POR_TURNO) para el siguiente turno. */
  tomarLineas(): string[];
}

/**
 * Crea el control de percepcion de una corrida. La huella "antes" de cada paso es la percepcion
 * leida DESPUES del paso anterior (entre pasos nadie mas toca la pagina: solo actua el agente), y la
 * inicial se toma al arrancar la corrida. Todo es best-effort: si una lectura falla, ese paso queda
 * sin percepcion y la tarea sigue igual.
 *
 * `mapaDelSitio` (ATLAS DE SITIOS, V040) es el bloque "mapa conocido del sitio" que el handler arma
 * con lo que la plataforma ya observo en ese dominio. Entra por ESTA cola, y no por un canal nuevo,
 * justamente para que quede DENTRO del presupuesto de contexto que ya existe (MAX_LINEAS_POR_TURNO):
 * se encola al inicializar y viaja en el primer turno como una linea mas. Ausente o vacio = la
 * corrida queda exactamente como antes de V040.
 */
export function crearControlDePercepcion(params: {
  percibir: (objetivo?: ObjetivoDeLectura | undefined) => Promise<PercepcionDePagina | null>;
  mapaDelSitio?: readonly string[] | undefined;
  logger?: Logger | undefined;
}): ControlDePercepcion {
  let previa: PercepcionDePagina | null = null;
  let cola: string[] = [...(params.mapaDelSitio ?? [])];

  const percibirSeguro = async (
    objetivo?: ObjetivoDeLectura | undefined,
  ): Promise<PercepcionDePagina | null> => {
    try {
      return await params.percibir(objetivo);
    } catch (error) {
      params.logger?.warn('tarea web: la lectura de percepcion fallo; el paso queda sin percepcion', {
        err: error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido',
      });
      return null;
    }
  };

  return {
    inicializar: async (): Promise<void> => {
      previa = await percibirSeguro();
    },
    alTerminarPaso: async (evento: EventoDePasoPercibido): Promise<EstrategiaLocalizacion[]> => {
      const paso = interpretarPaso(evento);
      if (paso.tipo === 'ignorar') return [];
      // El objetivo de lectura viaja DENTRO de la misma evaluacion: ni una conexion CDP mas, ni una
      // linea mas para el modelo. Ausente = la lectura es exactamente la de siempre.
      const actual = await percibirSeguro(objetivoDeLectura(evento) ?? undefined);
      if (actual === null) return [];
      if (paso.tipo === 'click' && previa !== null && mismaHuella(previa, actual)) {
        cola.push(lineaDeClickSinEfecto(paso.descripcion));
      }
      if (paso.tipo === 'escritura') {
        cola.push(
          ...lineasDeAterrizaje({ percepcion: actual, texto: paso.texto, descripcion: paso.descripcion }),
        );
      }
      previa = actual;
      return actual.estrategias ?? [];
    },
    tomarLineas: (): string[] => {
      const lineas = cola.slice(0, MAX_LINEAS_POR_TURNO);
      cola = [];
      return lineas;
    },
  };
}
