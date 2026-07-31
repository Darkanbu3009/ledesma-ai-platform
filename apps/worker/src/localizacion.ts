import {
  esAtributoEstable,
  MAX_ESTRATEGIAS_POR_PASO,
  MAX_TEXTO_PASO_CHARS,
  ordenarEstrategias,
  parsearEstrategia,
  type EstrategiaLocalizacion,
} from '@ledesma-platform/shared';
import { censurarValor, VALOR_CENSURADO } from './censura.js';
import { normalizarTexto } from './parametros-objetivo.js';

/**
 * LOCALIZACION DE ELEMENTOS sin modelo (Fase F, paso 2, CAMBIO 1 y 4). Dos mitades:
 *
 *  1. El JAVASCRIPT que corre DENTRO de la pagina para (a) LEER las formas estables de volver a
 *     encontrar un elemento y (b) RESOLVER un elemento a partir de esa lista y devolver su centro.
 *  2. Las funciones de este proceso que construyen esas expresiones y que SANEAN lo que vuelve.
 *
 * POR QUE HACE FALTA: la traza del motor de navegacion solo registra el XPATH ABSOLUTO que resolvio
 * Stagehand (/html[1]/body[1]/div[31]/div[2]/...). Ese xpath se rompe con que el sitio inserte un div
 * mas arriba, asi que por si solo no sostiene una receta. Antes de poder repetir nada hay que
 * capturar tambien el atributo estable, el rol con su nombre accesible y el texto visible (D1).
 *
 * MUNDO AISLADO SIEMPRE: estas expresiones corren en el mundo aislado de la pagina (ver
 * evaluarEnLaPagina en browserbase.ts), no en el mundo del sitio. Un sitio hostil que parchea
 * `querySelector`, `getAttribute` o `JSON.stringify` no puede hacer que la lectura devuelva el
 * elemento equivocado ni que la resolucion apunte a otro boton.
 *
 * PRIVACIDAD: un nombre accesible o un texto visible pueden llevar datos personales ("Enviar a
 * juan@ejemplo.com"). Todo lo que vuelve del navegador pasa por la MISMA censura que la traza
 * (censura.ts) y la estrategia se DESCARTA si la censura la toco: una estrategia censurada no
 * localiza nada, y guardarla solo serviria para filtrar el dato.
 */

/**
 * Utilidades compartidas por TODAS las expresiones que leen el DOM: las dos de este modulo, la de
 * percepcion (browserbase.ts), el localizador de controles por nombre (browserbase.ts) y el guion del
 * grabador (guion-grabador.ts). Se inyectan como texto en cada evaluacion (el mundo aislado se recrea
 * en cada conexion CDP, asi que no hay estado que reusar entre llamadas).
 *
 * QUE UNA SOLA COPIA IMPORTA: la clase de elemento del atlas (claseDeElemento, atlas-sitios.ts) sale
 * del rol y del nombre que devuelven estas funciones. Dos implementaciones del nombre accesible
 * producirian dos clases distintas para el MISMO control, y lo que escribiera un camino no lo
 * encontraria el otro.
 *
 * `rolDe` y `nombreDe` son una aproximacion DELIBERADA del calculo de nombre accesible del estandar:
 * cubren los casos que un formulario real usa (aria-label, aria-labelledby, label asociado,
 * placeholder, title, texto del control) sin arrastrar una implementacion completa que aqui no
 * aporta. Si no alcanzan, quedan el texto visible y el xpath por debajo.
 */
export const AYUDANTES_DOM = `
const ROL_POR_TAG = { button: 'button', a: 'link', select: 'combobox', textarea: 'textbox',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading' };
const ROL_POR_INPUT = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button',
  reset: 'button', search: 'searchbox', email: 'textbox', tel: 'textbox', url: 'textbox',
  text: 'textbox', password: 'textbox', number: 'spinbutton' };
function rolDe(el) {
  const explicito = el.getAttribute && el.getAttribute('role');
  if (explicito) return String(explicito).trim().toLowerCase().split(/\\s+/)[0];
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input') {
    const tipo = String(el.getAttribute('type') || 'text').toLowerCase();
    return ROL_POR_INPUT[tipo] || 'textbox';
  }
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
  return ROL_POR_TAG[tag] || '';
}
function textoDe(el) {
  const crudo = el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent;
  return String(crudo == null ? '' : crudo).replace(/\\s+/g, ' ').trim();
}
// Marcas invisibles de direccion de texto (LRM, RLM, aislantes bidi, BOM) que sitios como Gmail
// incrustan en el nombre accesible (el boton Enviar las lleva): se retiran antes de comparar. Es el
// MISMO conjunto que retira normalizarTexto (parametros-objetivo.ts) fuera de la pagina.
function claveDeNombre(texto) {
  return String(texto == null ? '' : texto)
    .replace(/[\\u200e\\u200f\\u061c\\u202a-\\u202e\\u2066-\\u2069\\ufeff]/g, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function nombreDe(el) {
  if (!el.getAttribute) return '';
  const etiqueta = el.getAttribute('aria-label');
  if (etiqueta && etiqueta.trim() !== '') return etiqueta.replace(/\\s+/g, ' ').trim();
  const referencia = el.getAttribute('aria-labelledby');
  if (referencia) {
    const partes = [];
    for (const id of referencia.split(/\\s+/)) {
      const otro = id === '' ? null : document.getElementById(id);
      if (otro) partes.push(textoDe(otro));
    }
    const unido = partes.join(' ').trim();
    if (unido !== '') return unido;
  }
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
    if (label) {
      const texto = textoDe(label);
      if (texto !== '') return texto;
    }
  }
  const cerrado = el.closest ? el.closest('label') : null;
  if (cerrado) {
    const texto = textoDe(cerrado);
    if (texto !== '') return texto;
  }
  for (const atributo of ['placeholder', 'title', 'alt', 'name']) {
    const valor = el.getAttribute(atributo);
    if (valor && valor.trim() !== '') return valor.replace(/\\s+/g, ' ').trim();
  }
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'button' || tag === 'a' || tag === 'summary') return textoDe(el);
  if (tag === 'input') {
    const tipo = String(el.getAttribute('type') || '').toLowerCase();
    if (tipo === 'submit' || tipo === 'button' || tipo === 'reset') {
      return String(el.getAttribute('value') || '').trim();
    }
  }
  return '';
}
function xpathDe(el) {
  const partes = [];
  let actual = el;
  while (actual && actual.nodeType === 1 && String(actual.tagName).toLowerCase() !== 'html') {
    const tag = String(actual.tagName).toLowerCase();
    let indice = 1;
    let hermano = actual.previousElementSibling;
    while (hermano) {
      if (String(hermano.tagName).toLowerCase() === tag) indice++;
      hermano = hermano.previousElementSibling;
    }
    partes.unshift(tag + '[' + indice + ']');
    actual = actual.parentElement;
  }
  return '/html[1]/' + partes.join('/');
}
function porXpath(xpath) {
  try {
    const r = document.evaluate(xpath, document, null, 9, null);
    return r && r.singleNodeValue && r.singleNodeValue.nodeType === 1 ? r.singleNodeValue : null;
  } catch (e) { return null; }
}
const ATRIBUTOS_A_LEER = ['data-testid','data-test','data-qa','data-cy','id','name','aria-label'];
function estrategiasDe(el) {
  const estrategias = [];
  for (const atributo of ATRIBUTOS_A_LEER) {
    const valor = el.getAttribute ? el.getAttribute(atributo) : null;
    if (valor && valor.trim() !== '') {
      estrategias.push({ tipo: 'atributo', atributo: atributo, valor: valor.trim() });
    }
  }
  const rol = rolDe(el);
  const nombre = nombreDe(el);
  if (rol !== '' && nombre !== '') estrategias.push({ tipo: 'rol', rol: rol, nombre: nombre });
  const texto = textoDe(el);
  if (texto !== '' && texto.length <= 120) estrategias.push({ tipo: 'texto', texto: texto });
  estrategias.push({ tipo: 'xpath', xpath: xpathDe(el) });
  return estrategias;
}
`;

/**
 * Expresion que LEE las estrategias del elemento indicado por `referencia` y devuelve un JSON con
 * ellas. Devuelve la cadena vacia si el elemento ya no esta en la pagina (best-effort: el registro de
 * una trayectoria jamas debe tumbar la tarea).
 */
export function expresionLeerEstrategias(referencia: ReferenciaDeElemento): string {
  const resolver =
    referencia.tipo === 'xpath'
      ? `porXpath(${JSON.stringify(referencia.xpath)})`
      : `document.elementFromPoint(${Math.round(referencia.x)}, ${Math.round(referencia.y)})`;
  return `(() => {
${AYUDANTES_DOM}
  const el = ${resolver};
  if (!el || el.nodeType !== 1) return '';
  return JSON.stringify(estrategiasDe(el));
})()`;
}

/**
 * Expresion que RESUELVE un elemento probando las estrategias EN EL ORDEN RECIBIDO, lo trae al
 * viewport y devuelve un JSON con el centro de su caja, la estrategia que funciono (tipo e INDICE,
 * insumo del registro de ganadoras de la auto reparacion) y las estrategias que ese elemento tiene
 * AHORA (insumo de la reparacion de selectores). Devuelve la cadena vacia si ninguna resuelve.
 *
 * NO reordena las estrategias a proposito: el orden que llega es el orden persistido del paso, que
 * puede traer una promocion de la auto reparacion (un fallback que vino ganando, puesto de primaria).
 * Reordenar aqui la desharia; ademas el indice devuelto debe referirse a la lista tal como la guarda
 * el paso.
 *
 * Un elemento sin caja (display:none, width 0) se considera NO RESUELTO a proposito: hacer click en
 * las coordenadas de un elemento invisible es hacer click en otra cosa.
 */
export function expresionResolverElemento(estrategias: EstrategiaLocalizacion[]): string {
  const especificacion = JSON.stringify(estrategias);
  return `(() => {
${AYUDANTES_DOM}
  const especificacion = JSON.parse(${JSON.stringify(especificacion)});
  function visible(el) {
    if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return false;
    const caja = el.getBoundingClientRect();
    return caja.width > 0 && caja.height > 0;
  }
  function porAtributo(estrategia) {
    const seleccion = '[' + estrategia.atributo + '="' + String(estrategia.valor).replace(/(["\\\\])/g, '\\\\$1') + '"]';
    let encontrados;
    try { encontrados = document.querySelectorAll(seleccion); } catch (e) { return null; }
    const vivos = Array.prototype.filter.call(encontrados, visible);
    return vivos.length === 1 ? vivos[0] : null;
  }
  // Nombre accesible matcheado POR PREFIJO: el nombre buscado puede ser un recorte del real
  // ("Enviar" encuentra "Enviar (Ctrl+Intro)", "destinatario" encuentra "Destinatarios en Para").
  // El prefijo solo vale si termina en un limite de palabra o si al nombre real solo le sobra el
  // plural: "Para" NO encuentra "Parar reproduccion".
  function nombreCoincide(delElemento, buscado) {
    const nombre = claveDeNombre(delElemento);
    const objetivo = claveDeNombre(buscado);
    if (nombre === '' || objetivo === '') return false;
    if (nombre === objetivo) return true;
    if (nombre.indexOf(objetivo) !== 0) return false;
    const resto = nombre.slice(objetivo.length);
    return /^[^\\p{L}\\p{N}]/u.test(resto) || /^s(?:[^\\p{L}\\p{N}]|$)/u.test(resto);
  }
  function porRol(estrategia) {
    const candidatos = [];
    for (const el of document.querySelectorAll('*')) {
      if (!visible(el)) continue;
      if (rolDe(el) === estrategia.rol && nombreCoincide(nombreDe(el), estrategia.nombre)) candidatos.push(el);
    }
    if (candidatos.length === 1) return candidatos[0];
    // Con varios candidatos por prefijo, la coincidencia EXACTA desempata; sin exacta unica, nada.
    const exactos = candidatos.filter((el) => claveDeNombre(nombreDe(el)) === claveDeNombre(estrategia.nombre));
    return exactos.length === 1 ? exactos[0] : null;
  }
  function porTexto(estrategia) {
    const candidatos = [];
    for (const el of document.querySelectorAll('*')) {
      if (!visible(el)) continue;
      if (textoDe(el) !== estrategia.texto) continue;
      // El mas PROFUNDO con ese texto exacto: el ancestro tambien lo contiene y clicar el ancestro
      // puede caer en otra zona de la pagina.
      if (Array.prototype.some.call(el.querySelectorAll('*'), (h) => textoDe(h) === estrategia.texto)) {
        continue;
      }
      candidatos.push(el);
    }
    return candidatos.length === 1 ? candidatos[0] : null;
  }
  let elegido = null;
  let usada = null;
  let indice = -1;
  for (let i = 0; i < especificacion.length; i++) {
    const estrategia = especificacion[i];
    let candidato = null;
    if (estrategia.tipo === 'atributo') candidato = porAtributo(estrategia);
    else if (estrategia.tipo === 'rol') candidato = porRol(estrategia);
    else if (estrategia.tipo === 'texto') candidato = porTexto(estrategia);
    else if (estrategia.tipo === 'xpath') candidato = porXpath(estrategia.xpath);
    if (candidato && visible(candidato)) { elegido = candidato; usada = estrategia.tipo; indice = i; break; }
  }
  if (!elegido) return '';
  try { elegido.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* sin scroll */ }
  const caja = elegido.getBoundingClientRect();
  if (caja.width <= 0 || caja.height <= 0) return '';
  return JSON.stringify({
    x: Math.round(caja.left + caja.width / 2),
    y: Math.round(caja.top + caja.height / 2),
    usada: usada,
    indice: indice,
    estrategias: estrategiasDe(elegido),
  });
})()`;
}

/** Expresion que VACIA el campo enfocado (select all + delete) antes de teclear un valor nuevo. */
export const EXPRESION_VACIAR_CAMPO_ENFOCADO = `(() => {
  const el = document.activeElement;
  if (!el) return '';
  const tag = String(el.tagName || '').toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && el.isContentEditable !== true) return '';
  try {
    if (el.setSelectionRange && typeof el.value === 'string') el.setSelectionRange(0, el.value.length);
    else if (document.getSelection) document.getSelection().selectAllChildren(el);
  } catch (e) { /* sin seleccion */ }
  return 'ok';
})()`;

/** Como se le dice al navegador cual es el elemento a leer: por su xpath o por un punto de pantalla. */
export type ReferenciaDeElemento =
  | { tipo: 'xpath'; xpath: string }
  | { tipo: 'punto'; x: number; y: number };

/** Punto de la pagina sobre el que actua una primitiva de bajo nivel. */
export interface PuntoDeLaPagina {
  x: number;
  y: number;
}

/** Lo que devuelve resolver un elemento por estrategias. */
export interface ElementoResuelto extends PuntoDeLaPagina {
  /** Tipo de estrategia que efectivamente lo encontro (observabilidad). */
  usada: EstrategiaLocalizacion['tipo'];
  /**
   * INDICE de la estrategia que lo encontro, dentro de la lista que se paso a resolver (que es el
   * orden persistido del paso). Es el insumo del registro de ganadoras: 0 = la primaria sigue
   * sirviendo; mayor a 0 = un fallback la esta cargando. null si el navegador no lo informo.
   */
  indice: number | null;
  /** Estrategias que el elemento tiene AHORA: insumo de la auto reparacion (D5). */
  estrategias: EstrategiaLocalizacion[];
}

/**
 * Contexto textual con el que se juzga si el valor de una estrategia es sensible. Junta el tipo y el
 * atributo, que es lo que delata un campo de contrasena o de tarjeta (mismo criterio que la censura
 * de la traza en trayectoria.ts).
 */
function contextoDeEstrategia(estrategia: EstrategiaLocalizacion): string {
  switch (estrategia.tipo) {
    case 'atributo':
      return `${estrategia.atributo} ${estrategia.valor}`;
    case 'rol':
      return `${estrategia.rol} ${estrategia.nombre}`;
    case 'texto':
      return estrategia.texto;
    case 'xpath':
      return estrategia.xpath;
  }
}

/** El texto que una estrategia expone y que por tanto hay que censurar antes de persistirlo. */
function textoDeEstrategia(estrategia: EstrategiaLocalizacion): string {
  switch (estrategia.tipo) {
    case 'atributo':
      return estrategia.valor;
    case 'rol':
      return estrategia.nombre;
    case 'texto':
      return estrategia.texto;
    case 'xpath':
      return estrategia.xpath;
  }
}

/**
 * SANEA lo que vuelve del navegador: valida cada estrategia contra el contrato, DESCARTA las que la
 * censura toca (una estrategia con un dato sensible dentro no se guarda: no localizaria nada y solo
 * serviria para filtrarlo), quita duplicadas, las ordena y las acota.
 *
 * Nunca lanza: cualquier basura devuelve lista vacia y el llamador decide (sin estrategias, el paso
 * no se promueve).
 */
export function sanearEstrategias(crudo: string): EstrategiaLocalizacion[] {
  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    return [];
  }
  if (!Array.isArray(parseado)) return [];
  const saneadas: EstrategiaLocalizacion[] = [];
  const vistas = new Set<string>();
  for (const item of parseado) {
    const estrategia = parsearEstrategia(item);
    if (estrategia === null) continue;
    if (estrategia.tipo === 'atributo' && !esAtributoEstable(estrategia.atributo)) continue;
    const texto = textoDeEstrategia(estrategia);
    if (texto.length > MAX_TEXTO_PASO_CHARS) continue;
    // La censura decide: si toco el texto, la estrategia se cae entera.
    if (censurarValor(texto, contextoDeEstrategia(estrategia)) !== texto) continue;
    if (texto.includes(VALOR_CENSURADO)) continue;
    const clave = JSON.stringify(estrategia);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    saneadas.push(estrategia);
  }
  return ordenarEstrategias(saneadas).slice(0, MAX_ESTRATEGIAS_POR_PASO);
}

/**
 * LARGO MINIMO de un valor para poder decidir que una estrategia DEPENDE de el. Con menos, el valor
 * aparece dentro de casi cualquier texto por casualidad ("3" esta dentro del xpath `div[3]`) y
 * descartar estrategias por esa coincidencia destruiria localizaciones buenas. Un valor tan corto
 * tampoco es un dato personal que haya que proteger.
 */
const MIN_VALOR_PARA_DEPENDENCIA = 4;

/**
 * ¿Esta forma de localizar el elemento DEPENDE de un valor que se tecleo? Es la regla que sostiene
 * dos cosas a la vez, y por eso vive aqui, junto a la definicion de las estrategias, y no en uno de
 * los dos caminos que la usan:
 *
 *  1. REUTILIZABILIDAD. Un paso cuya unica pista es el texto del dato que se acaba de escribir no
 *     sirve con otro dato. Medido en produccion: el clic sobre la sugerencia del autocompletado quedo
 *     localizado por el texto "martin@ejemplo.com martin@ejemplo.com"; con otro destinatario esa
 *     sugerencia no existe y el paso falla. Un campo tampoco se localiza por lo que contiene: antes
 *     de escribir esta vacio.
 *  2. PRIVACIDAD. Una estrategia es un lugar donde un valor queda PERSISTIDO. Un paso parametrizado
 *     guarda el marcador y jamas el valor; si su localizacion llevara el valor dentro, el dato
 *     quedaria guardado igual, solo que en otro campo.
 *
 * EL XPATH NUNCA DEPENDE DEL VALOR: describe la POSICION en la pagina (la primera fila de la lista de
 * sugerencias sigue siendo la primera con cualquier otro dato), y es ademas la estrategia que hace
 * que un paso de confirmacion siga siendo repetible cuando todo lo demas se cae.
 */
export function estrategiaDependeDelValor(
  estrategia: EstrategiaLocalizacion,
  valor: string,
): boolean {
  if (estrategia.tipo === 'xpath') return false;
  const dato = normalizarTexto(valor);
  const pista = normalizarTexto(textoDeEstrategia(estrategia));
  if (dato === '' || pista === '') return false;
  if (Math.min(dato.length, pista.length) < MIN_VALOR_PARA_DEPENDENCIA) return false;
  return pista.includes(dato) || dato.includes(pista);
}

/** Las estrategias que NO dependen de ninguno de esos valores. */
export function estrategiasIndependientesDelValor(
  estrategias: EstrategiaLocalizacion[],
  valores: readonly string[],
): EstrategiaLocalizacion[] {
  return estrategias.filter((estrategia) =>
    valores.every((valor) => !estrategiaDependeDelValor(estrategia, valor)),
  );
}

/**
 * MODIFICADORES de CDP (Input.dispatchKeyEvent): mascara de bits documentada por el protocolo
 * (Alt=1, Control=2, Meta=4, Shift=8).
 */
const MODIFICADORES: Readonly<Record<string, number>> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/**
 * Codigos de tecla virtual de Windows de las teclas NO imprimibles que una receta puede pulsar. Solo
 * estas: una receta no teclea texto libre por esta via (para eso esta el paso 'escribir'), asi que la
 * lista es corta y cerrada a proposito.
 */
const TECLAS_ESPECIALES: Readonly<Record<string, { key: string; codigo: number }>> = {
  enter: { key: 'Enter', codigo: 13 },
  tab: { key: 'Tab', codigo: 9 },
  escape: { key: 'Escape', codigo: 27 },
  esc: { key: 'Escape', codigo: 27 },
  backspace: { key: 'Backspace', codigo: 8 },
  delete: { key: 'Delete', codigo: 46 },
  space: { key: ' ', codigo: 32 },
  arrowup: { key: 'ArrowUp', codigo: 38 },
  arrowdown: { key: 'ArrowDown', codigo: 40 },
  arrowleft: { key: 'ArrowLeft', codigo: 37 },
  arrowright: { key: 'ArrowRight', codigo: 39 },
  home: { key: 'Home', codigo: 36 },
  end: { key: 'End', codigo: 35 },
  pageup: { key: 'PageUp', codigo: 33 },
  pagedown: { key: 'PageDown', codigo: 34 },
};

/** Una pulsacion lista para Input.dispatchKeyEvent. */
export interface PulsacionDeTecla {
  key: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  /** Texto que la pulsacion inserta (solo en teclas imprimibles). */
  text: string | null;
}

/**
 * Traduce una combinacion ('Enter', 'Control+a', 'Shift+Tab') a lo que CDP necesita. Devuelve null si
 * la combinacion no se reconoce: una receta con una combinacion rara no pulsa nada al azar, escala.
 */
export function parsearCombinacionDeTeclas(combinacion: string): PulsacionDeTecla | null {
  const partes = combinacion.split('+').map((p) => p.trim().toLowerCase());
  const ultima = partes.pop();
  if (ultima === undefined || ultima === '') return null;
  let modifiers = 0;
  for (const parte of partes) {
    const bit = MODIFICADORES[parte];
    if (bit === undefined) return null;
    modifiers |= bit;
  }
  const especial = TECLAS_ESPECIALES[ultima];
  if (especial !== undefined) {
    return { key: especial.key, windowsVirtualKeyCode: especial.codigo, modifiers, text: null };
  }
  // Un solo caracter alfanumerico ('a' de Control+a): su codigo virtual es el de la mayuscula.
  if (/^[a-z0-9]$/.test(ultima)) {
    // Con Control o Meta pulsados la tecla NO inserta texto: es un atajo, no una escritura.
    const esAtajo = (modifiers & 2) !== 0 || (modifiers & 4) !== 0;
    return {
      key: ultima,
      windowsVirtualKeyCode: ultima.toUpperCase().charCodeAt(0),
      modifiers,
      text: esAtajo ? null : ultima,
    };
  }
  return null;
}

/** Lee el resultado de `expresionResolverElemento`. null si no resolvio o si el JSON no es el esperado. */
export function leerElementoResuelto(crudo: string): ElementoResuelto | null {
  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (typeof parseado !== 'object' || parseado === null) return null;
  const objeto = parseado as Record<string, unknown>;
  const { x, y, usada } = objeto;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (usada !== 'atributo' && usada !== 'rol' && usada !== 'texto' && usada !== 'xpath') return null;
  // El indice es observabilidad (registro de ganadoras), no localizacion: uno raro no invalida el
  // elemento resuelto, simplemente no se registra nada de este paso.
  const indice = objeto.indice;
  return {
    x,
    y,
    usada,
    indice: typeof indice === 'number' && Number.isInteger(indice) && indice >= 0 ? indice : null,
    estrategias: sanearEstrategias(JSON.stringify(objeto.estrategias ?? [])),
  };
}
