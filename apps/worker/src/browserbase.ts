import Browserbase from '@browserbasehq/sdk';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { ClienteCdp } from './cdp.js';
import { SalidaDeRedNoDisponibleError } from './sitios.js';
import type { NavegadorRemoto, SesionDeLoginAbierta } from './sitios.js';
import type { NavegadorParaTarea, SesionDeTareaAbierta } from './tarea-web.js';
import type {
  CapturaEnCurso,
  NavegadorParaGrabacion,
  SesionDeGrabacionAbierta,
} from './grabacion.js';
import { EXPRESION_HAY_CAMPO_DE_CONTRASENA } from './contrasena.js';
import {
  expresionSondaDeClases,
  parsearLecturaDeSonda,
  type DescriptorDeSonda,
} from './sonda-interfaz.js';
import { ENLACE_DE_GRABACION, GUION_GRABADOR, MUNDO_DE_GRABACION } from './guion-grabador.js';
import type { CampoDeLaPagina } from './verificacion.js';
import type {
  InstruccionDePaso,
  NavegadorDeterminista,
  ResultadoPasoDeterminista,
} from './ejecutor-receta.js';
import {
  construirExpresionPercepcion,
  parsearPercepcion,
  type ObjetivoDeLectura,
  type PercepcionDePagina,
} from './percepcion.js';
import {
  AYUDANTES_DOM,
  EXPRESION_VACIAR_CAMPO_ENFOCADO,
  expresionLeerEstrategias,
  expresionResolverElemento,
  leerElementoResuelto,
  parsearCombinacionDeTeclas,
  sanearEstrategias,
  type PuntoDeLaPagina,
  type ReferenciaDeElemento,
} from './localizacion.js';

/**
 * ADAPTADOR real del puerto NavegadorRemoto (sitios.ts) sobre Browserbase (@browserbasehq/sdk
 * 2.16.0, el UNICO SDK permitido en este PR: cero Stagehand, cero AI SDK, cero clientes de modelo).
 * Este modulo es el unico del worker que importa el SDK; los handlers y los tests no lo tocan.
 *
 * Como no hay Playwright/Puppeteer (prohibidos), la navegacion inicial y la extraccion de cookies
 * van por CDP crudo (cdp.ts) contra el connectUrl de la sesion. El login en si JAMAS pasa por aca:
 * lo teclea el usuario en la vista en vivo, directamente contra Browserbase.
 *
 * Decisiones atadas a la doc de Browserbase (citas en el PR):
 *  - Contextos: browserSettings.context {id, persist:true}; el proveedor guarda cookies/perfil al
 *    CERRAR la sesion ("The data will be saved when the session closes").
 *  - keepAlive: true SIEMPRE: sin el, la sesion muere al desconectarse nuestro WebSocket CDP y el
 *    usuario no llegaria a loguearse. Requiere plan pago de Browserbase (Hobby+).
 *  - Proxy: 'browserbase' usa el pool gestionado con GEOLOCALIZACION FIJA POR PAIS (doc "Proxies":
 *    proxies: [{type:'browserbase', geolocation:{country}}], country en ISO 3166-1 alpha-2). El pool
 *    es residencial ROTATIVO: la IP cambia entre sesiones aunque el pais pedido sea el mismo, y la
 *    doc advierte que sin cobertura en la ubicacion pedida usa el proxy MAS CERCANO (puede cruzar
 *    frontera). Por eso el criterio de pinning es el PAIS observado (los handlers verifican y fallan
 *    antes que degradar), no la IP exacta. Para salida garantizada fija existe el proxy EXTERNO
 *    propio (BROWSERBASE_PROXY_*): la doc lo senala como la via de IP estatica.
 *  - La API NO expone la salida (IP ni pais) de una sesion: se OBSERVA navegando a un echo a traves
 *    del proxy (cdn-cgi/trace de Cloudflare, que devuelve ip= y loc= en texto plano), antes de
 *    navegar a la URL de login.
 */

/**
 * Timeout propio de la sesion de LOGIN en Browserbase (segundos): techo duro de costo si este worker
 * muriera antes de barrer. 15 min > los 10 del barrido, asi el barrido (que ademas marca la fila)
 * casi siempre llega primero y el timeout del proveedor queda de red de seguridad.
 */
const SESSION_TIMEOUT_SECONDS = 15 * 60;

/**
 * Timeout propio de la sesion de TAREA WEB (segundos). Mas largo que el de login porque una tarea
 * puede PAUSARSE en un checkpoint de aprobacion humana (7.1e) y la sesion DEBE seguir viva mientras
 * la aprobacion este pendiente (el estado del checkout se pierde si se reabre): cubre el deadline de
 * la corrida (<= 10 min), el TTL de la aprobacion (<= 20 min, ver env.ts), la corrida de la
 * reanudacion y margen. Doc de Browserbase: `timeout` acepta 60..21600 s y "keepAlive ... keep the
 * session alive even after disconnections" (https://docs.browserbase.com/reference/api/create-a-session);
 * el barrido de aprobaciones vencidas cierra la sesion mucho antes en operacion normal, y este
 * timeout queda de techo duro de costo si el worker muriera.
 */
const TAREA_SESSION_TIMEOUT_SECONDS = 45 * 60;

/**
 * Timeout propio de la sesion de GRABACION (segundos). Es un HUMANO el que maneja el navegador, asi que
 * el plazo se parece al del login: el worker da por abandonada la grabacion a los 10 minutos
 * (GRABACION_TIMEOUT_MS) y cierra la sesion el mismo; estos 20 minutos son el techo duro de costo si el
 * worker muriera antes de llegar a cerrarla.
 */
const GRABACION_SESSION_TIMEOUT_SECONDS = 20 * 60;

/**
 * Echo para OBSERVAR la salida real del proxy (la API no la expone). El trace de Cloudflare devuelve
 * lineas clave=valor en texto plano; se usan `ip` (egress IP, informativa) y `loc` (pais ISO 3166-1
 * alpha-2, EL criterio de verificacion del pinning). loc=XX significa pais desconocido -> null.
 */
const ECHO_SALIDA_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

/** Referencia de salida del pool gestionado de Browserbase (best-effort, sin IP garantizada). */
const PROXY_REF_POOL = 'browserbase';

/** Prefijo de referencia de salida por proxy EXTERNO propio (IP estatica garantizada por el operador). */
const PROXY_REF_EXTERNO = 'external:';

/**
 * VIEWPORT de la sesion de LOGIN. La vista en vivo de Browserbase renderiza el navegador remoto al
 * tamano del viewport de la SESION, no al del iframe que la embebe: la doc de "Session Live View"
 * (https://docs.browserbase.com/features/session-live-view) no ofrece ningun parametro de escala en
 * la URL, y su propia receta para cambiar el tamano de la vista (el ejemplo "mobile live view") es
 * fijar browserSettings.viewport {width, height} AL CREAR la sesion. Sin viewport explicito, el
 * default del proveedor gobierna lo que el usuario ve y agrandar el iframe con CSS no cambia nada
 * (la leccion del intento previo, que solo agrando el modal). 1280x720 es un viewport desktop
 * estandar con el aspecto (16:9) del iframe del modal: la vista escala ~1:1 y se lee bien.
 */
export const LOGIN_VIEWPORT = { width: 1280, height: 720 } as const;

const IP_REGEX = /^[0-9a-fA-F:.]{3,45}$/;
const PAIS_REGEX = /^[A-Z]{2}$/;

/** Tope del texto visible que se lee de una pagina (evidencia de apoyo, no un scrape). */
const MAX_TEXTO_VISIBLE_CHARS = 4000;

/** Nombre del mundo aislado donde corre la lectura de la verificacion (ver evaluarEnLaPagina). */
const MUNDO_DE_VERIFICACION = 'ledesma-verificacion';

/**
 * Espera tras una accion determinista (ms) para que el sitio reaccione (render, XHR, navegacion)
 * antes del paso siguiente. Corta a proposito: la receta repite un flujo que ya funciono, no explora.
 */
const PAUSA_TRAS_ACCION_MS = 400;

/** Tope de espera de la carga tras una navegacion de receta. Vencido, se sigue igual (best-effort). */
const ESPERA_DE_CARGA_MS = 10_000;

const EXPRESION_TEXTO_BODY =
  `(() => (document.body ? String(document.body.innerText || '').slice(0, ${MAX_TEXTO_VISIBLE_CHARS}) : ''))()`;

/**
 * Expresion de SOLO LECTURA que recolecta los campos del formulario con su valor ACTUAL y el
 * contexto que los identifica. Va como String.raw para que las expresiones regulares de adentro
 * lleguen intactas al navegador. Exportada SOLO para el test de DOM (lector-campos-dom.test.ts),
 * que la ejecuta tal cual sobre una pagina real.
 *
 * Decisiones que importan para la seguridad de la verificacion:
 *  - input[type=password] se OMITE entero: su valor no hace falta para verificar nada.
 *  - los campos OCULTOS y los de tipo hidden SI se incluyen: un destinatario o un monto colado en un
 *    campo invisible es precisamente lo que hay que detectar.
 *  - contenteditable se incluye porque los redactores de correo modernos no usan <textarea>.
 *  - un campo VACIO busca su valor en los CHIPS de su contenedor (ver abajo): un sitio como Gmail
 *    vacia el input al confirmar el destinatario y el dato pasa a vivir en un elemento con
 *    atributos; sin esta lectura el sistema leia cadena vacia donde el usuario veia el correo.
 *  - un campo con chips de los que NO se pudo extraer ningun valor sale marcado noLeible: "no se
 *    pudo leer" y "esta vacio" son estados distintos y la verificacion los trata distinto.
 *  - un campo cuyo valor SALIO de sus chips va marcado porChips (FIX B): la percepcion lo reporta
 *    como "chip confirmado". La verificacion lo ignora (leerCamposDeLaPagina no copia el campo).
 *  - todo va acotado (60 campos, 200 caracteres por valor y por contexto, 20 chips por campo): la
 *    verificacion compara datos concretos, no vuelca la pagina.
 *
 * COMO SE LEE UN CHIP: solo dentro del contenedor (rol listbox, list o group) al que el campo
 * pertenece (closest desde el PADRE del campo, jamas un popup suelto del documento), y solo
 * elementos que ESTRUCTURALMENTE representan un valor comprometido (data-hovercard-id / data-name /
 * data-value, o rol option / listitem). El valor sale de los atributos en este orden --
 * data-hovercard-id, data-name, data-value, title, aria-label -- y, si ninguno trae nada, del texto
 * visible del chip. El valor leido queda asociado AL CAMPO del contenedor, nunca suelto.
 *
 * POR QUE combobox NO es un contenedor de chips (revision adversarial): en el patron ARIA de
 * combobox el envoltorio contiene el POPUP de sugerencias, y una sugerencia es un dato que NADIE
 * confirmo. Leerla como valor del campo haria pasar la verificacion con un destinatario no
 * comprometido, que es exactamente el falso positivo que este lector no puede introducir. Ademas
 * el arranque en el PADRE impide que un campo que a su vez tiene rol de contenedor se lea a si
 * mismo. Un popup que viva FUERA del contenedor del campo queda excluido por construccion.
 */
export const EXPRESION_LEER_CAMPOS = String.raw`(() => {
  const MAX_CAMPOS = 60, MAX_VALOR = 200, MAX_CONTEXTO = 200, MAX_CHIPS_POR_CAMPO = 20;
  const salida = [];
  const CONTENEDOR_DE_CHIPS = '[role="listbox"], [role="list"], [role="group"]';
  const CHIP_POR_ATRIBUTO = '[data-hovercard-id], [data-name], [data-value]';
  const CHIP_POR_ROL = '[role="option"], [role="listitem"]';
  const ATRIBUTOS_DE_CHIP = ['data-hovercard-id', 'data-name', 'data-value', 'title', 'aria-label'];
  const valorDeChip = (chip) => {
    for (const atributo of ATRIBUTOS_DE_CHIP) {
      const crudo = chip.getAttribute(atributo);
      if (crudo && crudo.trim() !== '') return crudo.trim();
    }
    return String(chip.innerText || chip.textContent || '').trim();
  };
  // Un boton (el de quitar el chip), un control o un elemento oculto a la accesibilidad no es un
  // valor comprometido: leerlo meteria "Quitar" o una tooltip como si fuera el dato.
  const noEsChip = (chip, nodo) => {
    const rolDeChip = (chip.getAttribute('role') || '').toLowerCase();
    const tagDeChip = (chip.tagName || '').toLowerCase();
    return (
      rolDeChip === 'button' ||
      tagDeChip === 'button' || tagDeChip === 'input' || tagDeChip === 'textarea' || tagDeChip === 'select' ||
      chip.getAttribute('aria-hidden') === 'true' ||
      chip.contains(nodo) || nodo.contains(chip)
    );
  };
  // Chips del campo: valores YA COMPROMETIDOS que viven en el contenedor del campo. Devuelve los
  // valores legibles y cuantos chips estructurales NO entregaron ningun valor (para noLeible).
  const leerChipsDelCampo = (nodo) => {
    const padre = nodo.parentElement;
    const contenedor = padre && padre.closest ? padre.closest(CONTENEDOR_DE_CHIPS) : null;
    if (!contenedor) return { valores: [], ilegibles: 0 };
    let candidatos = contenedor.querySelectorAll(CHIP_POR_ATRIBUTO);
    if (candidatos.length === 0) candidatos = contenedor.querySelectorAll(CHIP_POR_ROL);
    const valores = [];
    const leidos = [];
    let ilegibles = 0;
    for (const chip of candidatos) {
      if (leidos.length >= MAX_CHIPS_POR_CAMPO) break;
      if (noEsChip(chip, nodo)) continue;
      // Un chip anidado dentro de otro ya leido es el mismo dato dos veces.
      if (leidos.some((previo) => previo.contains(chip))) continue;
      leidos.push(chip);
      const valor = valorDeChip(chip);
      if (valor === '') {
        ilegibles += 1;
      } else if (!valores.includes(valor)) {
        valores.push(valor);
      }
    }
    return { valores, ilegibles };
  };
  const nodos = document.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  for (const nodo of nodos) {
    if (salida.length >= MAX_CAMPOS) break;
    const tag = (nodo.tagName || '').toLowerCase();
    const tipo = (nodo.getAttribute('type') || '').toLowerCase();
    if (tipo === 'password') continue;
    let valor = '';
    if (tag === 'select') {
      const opcion = nodo.selectedOptions && nodo.selectedOptions[0];
      valor = opcion ? (opcion.textContent || opcion.value || '') : (nodo.value || '');
    } else if (tag === 'input' || tag === 'textarea') {
      valor = (tipo === 'checkbox' || tipo === 'radio')
        ? (nodo.checked ? (nodo.value || 'on') : '')
        : (nodo.value || '');
    } else {
      valor = nodo.innerText || nodo.textContent || '';
    }
    valor = String(valor).trim();
    let noLeible = false;
    let porChips = false;
    // Solo un campo de TEXTO vacio delega en sus chips: un checkbox sin marcar o un select sin
    // seleccion estan legitimamente vacios y no tienen chips que leer.
    const esCampoDeTexto = tag !== 'select' && tipo !== 'checkbox' && tipo !== 'radio';
    if (valor === '' && esCampoDeTexto) {
      const chips = leerChipsDelCampo(nodo);
      if (chips.valores.length > 0) {
        valor = chips.valores.join(', ');
        porChips = true;
      } else if (chips.ilegibles > 0) {
        noLeible = true;
      }
    }
    if (valor === '' && !noLeible) continue;
    let etiqueta = '';
    try {
      const id = nodo.getAttribute('id');
      if (id && window.CSS && window.CSS.escape) {
        const asociada = document.querySelector('label[for="' + window.CSS.escape(id) + '"]');
        if (asociada) etiqueta = asociada.innerText || asociada.textContent || '';
      }
      if (!etiqueta && nodo.closest) {
        const contenedora = nodo.closest('label');
        if (contenedora) etiqueta = contenedora.innerText || contenedora.textContent || '';
      }
    } catch (e) {
      etiqueta = '';
    }
    const contexto = [
      tag,
      tipo,
      nodo.getAttribute('name') || '',
      nodo.getAttribute('id') || '',
      nodo.getAttribute('placeholder') || '',
      nodo.getAttribute('aria-label') || '',
      etiqueta,
    ].join(' ').replace(/\s+/g, ' ').trim();
    const campo = { contexto: contexto.slice(0, MAX_CONTEXTO), valor: valor.slice(0, MAX_VALOR) };
    if (noLeible) campo.noLeible = true;
    if (porChips) campo.porChips = true;
    salida.push(campo);
  }
  return JSON.stringify(salida);
})()`;

/**
 * Expresion de PERCEPCION (FIX A y B): el lector de campos de arriba COMPUESTO con la huella de la
 * pagina y el descriptor del foco (ver percepcion.ts). Exportada SOLO para el test de DOM, que la
 * ejecuta tal cual sobre una pagina real igual que hace con EXPRESION_LEER_CAMPOS.
 */
export const EXPRESION_PERCEPCION = construirExpresionPercepcion(EXPRESION_LEER_CAMPOS);

/**
 * La MISMA expresion de percepcion mas la lectura de las estrategias del elemento tocado (ATLAS DE
 * SITIOS). Se compone aqui, que es donde ya viven las dos mitades: el lector de campos de la
 * verificacion y los ayudantes de DOM de la localizacion. Exportada SOLO para el test de DOM.
 */
export function expresionPercepcionConEstrategias(objetivo: ObjetivoDeLectura): string {
  return construirExpresionPercepcion(EXPRESION_LEER_CAMPOS, {
    ayudantes: AYUDANTES_DOM,
    objetivo,
  });
}

/** Lo que devuelve localizar el control de una accion por su rol y su nombre accesible. */
export interface BotonLocalizado {
  /**
   * NOMBRE ACCESIBLE completo del control VISIBLE que matcheo, resuelto por la cadena entera de
   * `nombreDe` (en Gmail el aria-label "Enviar (Ctrl-Enter)"; en un sitio sin aria-label, el texto
   * del propio boton). El campo conserva su nombre historico porque el puerto que lo declara lo
   * comparte con el ejecutor de recetas.
   */
  ariaLabel: string;
  /** Rol accesible del elemento, el MISMO que leen la percepcion y el grabador (`rolDe`). */
  rol: string;
  /** Cuantos candidatos (visibles u ocultos) matchearon el prefijo en la pagina. */
  candidatos: number;
}

/**
 * ELEMENTOS QUE RECORRE el localizador. La lista es CERRADA y corta a proposito: cada tag de mas es
 * un candidato de mas, y con mas de un candidato no hay certeza de cual control se acciona.
 *
 *  - `button` y `[role="button"]`: el boton nativo y el que un sitio arma con un div (Gmail).
 *  - `input[type="submit"]` e `input[type="button"]`: el boton de formulario sin JavaScript, que es
 *    la forma clasica de una accion final en un sitio de compra. `nombreDe` ya sabe leer su `value` y
 *    `rolDe` ya los mapea a 'button', asi que producen la MISMA clase que los otros dos.
 *
 * QUE QUEDA FUERA, y por que: `a[href]` sin `role="button"` (un enlace es navegacion, no una accion,
 * y meter todos los enlaces multiplicaria los candidatos: la carpeta "Enviados" de un correo entraria
 * por prefijo), `[role="menuitem"]` y `[role="link"]` (idem), `input[type="image"]` (su nombre sale
 * del `alt` y es raro como accion final) y `summary` (abre un detalle, no acciona nada). Un
 * `a[role="button"]` SI entra: ya lo cubre `[role="button"]`.
 */
const CONTROLES_ACCIONABLES = 'button, [role="button"], input[type="submit"], input[type="button"]';

/**
 * Expresion de SOLO LECTURA que localiza el CONTROL de una accion por su ROL y su NOMBRE ACCESIBLE
 * por PREFIJO (el nombre real del boton Enviar de Gmail es "Enviar (Ctrl-Enter)", asi que la
 * coincidencia exacta de las estrategias de receta no sirve aqui). Es la localizacion que el modo
 * simulacro de scripts/validar-percepcion.ts valida contra Gmail real SIN clickear nada, y la que
 * alimenta la barrera de identidad en los dos caminos.
 *
 * EL NOMBRE SALE DE `nombreDe` (AYUDANTES_DOM, localizacion.ts), o sea de la MISMA cadena que usan la
 * percepcion y el grabador: aria-label, aria-labelledby, label asociado, placeholder / title / alt y
 * texto del control. Hasta este cambio miraba SOLO el aria-label, asi que un boton cuyo nombre viene
 * de su texto interno (`<button>Comprar ahora</button>`) no se encontraba nunca. Cero logica
 * duplicada: si divergiera de la percepcion, el mismo control tendria dos clases de elemento.
 *
 * La comparacion pasa por `claveDeNombre`, el mismo normalizador que ya usa el resolutor dentro de la
 * pagina: sin marcas invisibles de direccion, con los espacios colapsados y en minusculas.
 *
 * VISIBILIDAD compatible con el navegador real y con el test de DOM (jsdom no calcula layout): un
 * elemento con un ancestro display:none / hidden / aria-hidden esta oculto SIEMPRE; el criterio de
 * caja (getBoundingClientRect) se aplica solo cuando el documento tiene layout de verdad.
 */
export function expresionLocalizarBotonPorAriaLabel(prefijos: string[]): string {
  return String.raw`(() => {
${AYUDANTES_DOM}
  const prefijos = ${JSON.stringify(prefijos)}.map((p) => claveDeNombre(p));
  const ocultoPorAtributos = (el) => {
    for (let n = el; n && n.getAttribute; n = n.parentElement) {
      const estilo = (n.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
      if (estilo.includes('display:none') || estilo.includes('visibility:hidden')) return true;
      if (n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('hidden')) return true;
    }
    return false;
  };
  const conLayout = !!(document.body && document.body.getBoundingClientRect
    && document.body.getBoundingClientRect().width > 0);
  // Visibilidad PROPIA del localizador, con nombre propio para no tapar la \`visible\` de los
  // ayudantes (la del resolutor, que es solo de caja): esta mira ademas los atributos de ocultamiento
  // de los ancestros y tolera un documento sin layout, que es lo que necesita el test de DOM.
  const visibleParaLocalizar = (el) => {
    if (ocultoPorAtributos(el)) return false;
    if (!conLayout) return true;
    const caja = el.getBoundingClientRect();
    return caja.width > 0 && caja.height > 0;
  };
  let candidatos = 0;
  let elegido = null;
  for (const el of document.querySelectorAll(${JSON.stringify(CONTROLES_ACCIONABLES)})) {
    const nombre = nombreDe(el);
    if (nombre === '') continue;
    const plano = claveDeNombre(nombre);
    if (!prefijos.some((p) => p !== '' && plano.indexOf(p) === 0)) continue;
    candidatos += 1;
    if (elegido === null && visibleParaLocalizar(el)) {
      elegido = { ariaLabel: nombre.slice(0, 120), rol: rolDe(el) };
    }
  }
  if (elegido === null) return JSON.stringify({ localizado: null, candidatos: candidatos });
  return JSON.stringify({ localizado: elegido, candidatos: candidatos });
})()`;
}

/** Pausa acotada (los pasos de una receta necesitan dejar respirar al sitio entre acciones). */
function pausar(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * MANDO minimo sobre una pagina ya adherida por CDP: evaluar en el MUNDO AISLADO, disparar entrada
 * REAL (Input.*) y navegar. Existe para que un paso de receta gaste UNA conexion CDP en vez de una
 * por primitiva, y para que toda la ejecucion determinista comparta un solo lugar donde se decide
 * como se toca la pagina.
 *
 * POR QUE ENTRADA REAL Y NO `element.click()`: un sitio puede distinguir un evento sintetico de uno
 * del usuario (isTrusted) y muchos formularios reales no reaccionan al sintetico. Input.* genera los
 * mismos eventos que una persona, que es lo que hace que repetir el flujo aprendido funcione.
 *
 * POR QUE MUNDO AISLADO: identico motivo que la verificacion (ver evaluarEnLaPagina). El JavaScript
 * del sitio no puede parchear lo que la resolucion del elemento ve, asi que no puede hacer que la
 * receta actue sobre un boton distinto del que aprendio.
 */
class PaginaCdp {
  constructor(
    private readonly cdp: ClienteCdp,
    private readonly sessionId: string,
  ) {}

  /** Evalua una expresion en un mundo aislado nuevo y devuelve su valor si es texto. */
  async evaluar(expresion: string): Promise<string | null> {
    const { frameTree } = await this.cdp.enviar<{ frameTree: { frame: { id: string } } }>(
      'Page.getFrameTree',
      {},
      this.sessionId,
    );
    const { executionContextId } = await this.cdp.enviar<{ executionContextId: number }>(
      'Page.createIsolatedWorld',
      { frameId: frameTree.frame.id, worldName: MUNDO_DE_VERIFICACION },
      this.sessionId,
    );
    const evaluado = await this.cdp.enviar<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      { expression: expresion, returnByValue: true, contextId: executionContextId },
      this.sessionId,
    );
    const valor = evaluado.result?.value;
    return typeof valor === 'string' ? valor : null;
  }

  /** Click REAL (mover, presionar, soltar) en el punto dado. */
  async click(punto: PuntoDeLaPagina): Promise<void> {
    const base = { x: punto.x, y: punto.y, button: 'left', clickCount: 1 };
    await this.cdp.enviar('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' }, this.sessionId);
    await this.cdp.enviar('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, this.sessionId);
    await this.cdp.enviar('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, this.sessionId);
  }

  /** Pulsacion REAL de una tecla (down + up), con sus modificadores. */
  async pulsar(pulsacion: {
    key: string;
    windowsVirtualKeyCode: number;
    modifiers: number;
    text: string | null;
  }): Promise<void> {
    const base = {
      key: pulsacion.key,
      windowsVirtualKeyCode: pulsacion.windowsVirtualKeyCode,
      nativeVirtualKeyCode: pulsacion.windowsVirtualKeyCode,
      modifiers: pulsacion.modifiers,
      ...(pulsacion.text !== null ? { text: pulsacion.text } : {}),
    };
    await this.cdp.enviar('Input.dispatchKeyEvent', { ...base, type: 'keyDown' }, this.sessionId);
    await this.cdp.enviar('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, this.sessionId);
  }

  /** Inserta texto en el elemento enfocado como lo haria el teclado (dispara los eventos de input). */
  async insertarTexto(texto: string): Promise<void> {
    await this.cdp.enviar('Input.insertText', { text: texto }, this.sessionId);
  }

  /**
   * Navega y espera la carga. La espera es BEST-EFFORT: vencida, se sigue igual (una pagina que
   * nunca dispara load no debe colgar la receta; el paso siguiente fallara en localizar y escalara).
   */
  async navegar(url: string): Promise<void> {
    const carga = this.cdp.esperarEvento('Page.loadEventFired', this.sessionId).catch(() => undefined);
    const navegacion = await this.cdp.enviar<{ errorText?: string }>(
      'Page.navigate',
      { url },
      this.sessionId,
    );
    if (navegacion.errorText) {
      throw new Error(`el navegador no pudo abrir la pagina: ${navegacion.errorText}`);
    }
    await Promise.race([carga, pausar(ESPERA_DE_CARGA_MS)]);
  }
}

/** Salida de red observada por el echo: IP (informativa) y pais (criterio de pinning). */
interface SalidaEcho {
  egressIp: string | null;
  egressCountry: string | null;
}

/**
 * Parsea el texto del trace de Cloudflare (lineas clave=valor). Tolerante: cualquier cosa que no
 * matchee el formato esperado queda null (y con pais null el handler NO verifica -> aborta).
 */
export function parsearTraceDeSalida(texto: string): SalidaEcho {
  let egressIp: string | null = null;
  let egressCountry: string | null = null;
  for (const linea of texto.split('\n')) {
    const [clave, valor] = linea.split('=', 2);
    if (clave === 'ip' && valor !== undefined && IP_REGEX.test(valor.trim())) {
      egressIp = valor.trim();
    }
    if (clave === 'loc' && valor !== undefined) {
      const pais = valor.trim().toUpperCase();
      // XX = pais desconocido para Cloudflare: no sirve para verificar el pin.
      if (PAIS_REGEX.test(pais) && pais !== 'XX') egressCountry = pais;
    }
  }
  return { egressIp, egressCountry };
}

export interface BrowserbaseConfig {
  apiKey: string;
  projectId: string;
  /** Proxy externo propio con IP estatica (opcional). Si esta, las conexiones NUEVAS salen por el. */
  proxyServer?: string | undefined;
  proxyUsername?: string | undefined;
  proxyPassword?: string | undefined;
}

type ProxiesParam = NonNullable<Browserbase.SessionCreateParams['proxies']>;

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

export class NavegadorBrowserbase
  implements NavegadorRemoto, NavegadorParaTarea, NavegadorDeterminista, NavegadorParaGrabacion
{
  private readonly bb: Browserbase;

  constructor(private readonly config: BrowserbaseConfig) {
    this.bb = new Browserbase({ apiKey: config.apiKey });
  }

  /**
   * Resuelve la config de proxies para el `proxyRef` pedido. null = asignar salida nueva (externa si
   * hay proxy propio configurado; si no, el pool). El pool SIEMPRE se pide con la geolocalizacion
   * del PAIS pineado (`proxyCountry`): es best-effort del proveedor (sin cobertura puede enrutar por
   * el pais mas cercano), asi que el llamador VERIFICA el pais observado y aborta si difiere. Un ref
   * pineado que ya no se puede reconstruir (proxy externo cambiado o retirado del entorno) lanza
   * SalidaDeRedNoDisponibleError: JAMAS se degrada en silencio a otra salida.
   */
  private resolverProxy(
    proxyRef: string | null,
    proxyCountry: string,
  ): { proxies: ProxiesParam; proxyRef: string } {
    const externo = this.config.proxyServer
      ? { server: this.config.proxyServer, username: this.config.proxyUsername, password: this.config.proxyPassword }
      : null;

    // Pool gestionado con geolocalizacion fija por pais (doc de Browserbase, seccion Proxies).
    const pool: ProxiesParam = [
      { type: 'browserbase', geolocation: { country: proxyCountry } },
    ];

    if (proxyRef === null) {
      if (externo) {
        return {
          proxies: [
            {
              type: 'external',
              server: externo.server,
              ...(externo.username !== undefined ? { username: externo.username } : {}),
              ...(externo.password !== undefined ? { password: externo.password } : {}),
            },
          ],
          proxyRef: `${PROXY_REF_EXTERNO}${externo.server}`,
        };
      }
      return { proxies: pool, proxyRef: PROXY_REF_POOL };
    }

    if (proxyRef === PROXY_REF_POOL) {
      return { proxies: pool, proxyRef: PROXY_REF_POOL };
    }

    if (proxyRef.startsWith(PROXY_REF_EXTERNO)) {
      const server = proxyRef.slice(PROXY_REF_EXTERNO.length);
      if (!externo || externo.server !== server) {
        throw new SalidaDeRedNoDisponibleError(
          'la salida de red pineada a esta conexion era un proxy externo que ya no esta configurado ' +
            'en el worker (BROWSERBASE_PROXY_SERVER distinto o ausente); restaurala o desconecta y ' +
            'reconecta el sitio para pinear una salida nueva',
        );
      }
      return {
        proxies: [
          {
            type: 'external',
            server: externo.server,
            ...(externo.username !== undefined ? { username: externo.username } : {}),
            ...(externo.password !== undefined ? { password: externo.password } : {}),
          },
        ],
        proxyRef,
      };
    }

    throw new SalidaDeRedNoDisponibleError(
      `la referencia de salida de red pineada a esta conexion no es reconocible (${proxyRef}); ` +
        'desconecta y reconecta el sitio para pinear una salida nueva',
    );
  }

  /**
   * OBSERVA la salida de red real (IP + pais) navegando la pagina dada al echo A TRAVES del proxy.
   * Best-effort: si el echo falla, ambos campos quedan null y el handler decide (pais null NO
   * verifica el pin -> aborta; en una conexion nueva el pais observado null tampoco verifica).
   */
  private async observarSalidaEnPagina(cdp: ClienteCdp, sessionId: string): Promise<SalidaEcho> {
    try {
      const carga = cdp.esperarEvento('Page.loadEventFired', sessionId);
      await cdp.enviar('Page.navigate', { url: ECHO_SALIDA_URL }, sessionId);
      await carga;
      const evaluado = await cdp.enviar<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        { expression: 'document.body.innerText.trim()', returnByValue: true },
        sessionId,
      );
      const valor = evaluado.result?.value;
      if (typeof valor !== 'string') return { egressIp: null, egressCountry: null };
      return parsearTraceDeSalida(valor);
    } catch {
      return { egressIp: null, egressCountry: null };
    }
  }

  async abrirSesionParaLogin(params: {
    url: string;
    contextoExternoId: string | null;
    proxyRef: string | null;
    proxyCountry: string;
  }): Promise<SesionDeLoginAbierta> {
    const { proxies, proxyRef } = this.resolverProxy(params.proxyRef, params.proxyCountry);

    // Contexto NUEVO para una conexion nueva; el pineado para una reapertura (cookies del proveedor).
    const contextoExternoId =
      params.contextoExternoId ??
      (await this.bb.contexts.create({ projectId: this.config.projectId })).id;

    // keepAlive: la sesion debe SOBREVIVIR a nuestra desconexion CDP para que el humano se loguee.
    // timeout: techo de costo propio (el barrido de 10 min llega antes en operacion normal).
    // viewport: EXPLICITO porque es lo que dimensiona la vista en vivo (ver LOGIN_VIEWPORT).
    const session = await this.bb.sessions.create({
      projectId: this.config.projectId,
      browserSettings: {
        context: { id: contextoExternoId, persist: true },
        viewport: { width: LOGIN_VIEWPORT.width, height: LOGIN_VIEWPORT.height },
      },
      proxies,
      keepAlive: true,
      timeout: SESSION_TIMEOUT_SECONDS,
    });

    let salida: SalidaEcho;
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);

      // OBSERVAR la salida real (IP + pais) por el echo A TRAVES del proxy (la API no la expone).
      // Best-effort: si el echo falla queda null y el handler decide (pais no verificable -> aborta).
      salida = await this.observarSalidaEnPagina(cdp, sessionId);

      // Navegar a la URL de login y DESCONECTAR: el humano toma el control en la vista en vivo. No
      // se espera la carga completa (el job no espera nada del humano); si Chrome rechaza la
      // navegacion (URL irresoluble), se falla ruidosamente.
      const navegacion = await cdp.enviar<{ errorText?: string }>(
        'Page.navigate',
        { url: params.url },
        sessionId,
      );
      if (navegacion.errorText) {
        throw new Error(`el navegador no pudo abrir la URL de login: ${navegacion.errorText}`);
      }
    } catch (error) {
      // La sesion recien creada no debe quedar viva si el arranque fallo (minutos facturados).
      cdp.cerrar();
      await this.cerrarSesionSilencioso(session.id);
      throw error;
    }
    cdp.cerrar();

    const debug = await this.bb.sessions.debug(session.id);

    return {
      sesionExternaId: session.id,
      contextoExternoId,
      vistaEnVivoUrl: debug.debuggerFullscreenUrl,
      proxyRef,
      egressIp: salida.egressIp,
      egressCountry: salida.egressCountry,
      // Browserbase no expone una referencia de fingerprint propia: el fingerprint/perfil viaja CON
      // el contexto del proveedor, asi que la referencia estable es el contexto mismo.
      fingerprintRef: `contexto:${contextoExternoId}`,
      expiraEn: session.expiresAt ?? null,
    };
  }

  /**
   * Abre la sesion de una TAREA WEB (7.1d): RECONECTA el contexto guardado y FUERZA la salida
   * pineada con la geolocalizacion del pais pineado (proxyRef y proxyCountry OBLIGATORIOS: una
   * tarea jamas sortea salida nueva; resolverProxy lanza SalidaDeRedNoDisponibleError si el pin no
   * es reconstruible). Observa la salida (IP + pais) por el echo (igual que el login) y DEVUELVE sin
   * navegar a ninguna URL del sitio: la verificacion del pin POR PAIS la hace el handler ANTES de
   * permitir navegar. keepAlive:true porque Stagehand se conecta y desconecta por CDP durante la
   * tarea y la sesion debe sobrevivir entre medio.
   */
  async abrirSesionParaTarea(params: {
    contextoExternoId: string;
    proxyRef: string;
    proxyCountry: string;
  }): Promise<SesionDeTareaAbierta> {
    const { proxies } = this.resolverProxy(params.proxyRef, params.proxyCountry);

    const session = await this.bb.sessions.create({
      projectId: this.config.projectId,
      browserSettings: { context: { id: params.contextoExternoId, persist: true } },
      proxies,
      keepAlive: true,
      timeout: TAREA_SESSION_TIMEOUT_SECONDS,
    });

    let salida: SalidaEcho;
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      // OBSERVAR la salida real por el echo, ANTES de tocar el sitio. Best-effort: si falla, el
      // pais queda null y el handler NO puede verificar el pin -> aborta.
      salida = await this.observarSalidaEnPagina(cdp, sessionId);
    } catch (error) {
      cdp.cerrar();
      await this.cerrarSesionSilencioso(session.id);
      throw error;
    }
    cdp.cerrar();

    return {
      sesionExternaId: session.id,
      egressIp: salida.egressIp,
      egressCountry: salida.egressCountry,
    };
  }

  /**
   * Inyecta el contexto de sesion DESCIFRADO (cookies-cdp-v1, el formato que extraerContexto
   * serializo) en la sesion viva via Storage.setCookies (browser-level). El claro no se loguea ni
   * persiste: entra por parametro y muere con este scope.
   */
  async inyectarContexto(sesionExternaId: string, contexto: string): Promise<void> {
    let cookies: unknown[];
    try {
      const parsed = JSON.parse(contexto) as { formato?: unknown; cookies?: unknown };
      if (parsed.formato !== 'cookies-cdp-v1' || !Array.isArray(parsed.cookies)) {
        throw new Error('formato desconocido');
      }
      cookies = parsed.cookies;
    } catch {
      // Sin detalle del blob: el contexto guardado no es usable (corrupto o de otra version).
      throw new Error('el contexto de sesion guardado no es interpretable; reconecta el sitio');
    }
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      await cdp.enviar('Storage.setCookies', { cookies });
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * Navega a `url` y detecta DETERMINISTICAMENTE (sin modelo) una pantalla de login: presencia de un
   * campo de contrasena en el documento. Es el pre-chequeo de caducidad de 7.1d; el resto de la
   * deteccion (login a mitad de tarea) la hace el prompt del motor con su marcador.
   */
  async detectarPantallaDeLogin(sesionExternaId: string, url: string): Promise<boolean> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      const carga = cdp.esperarEvento('Page.loadEventFired', sessionId);
      const navegacion = await cdp.enviar<{ errorText?: string }>('Page.navigate', { url }, sessionId);
      if (navegacion.errorText) {
        throw new Error(`el navegador no pudo abrir el sitio: ${navegacion.errorText}`);
      }
      await carga;
      const evaluado = await cdp.enviar<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        { expression: EXPRESION_HAY_CAMPO_DE_CONTRASENA, returnByValue: true },
        sessionId,
      );
      return evaluado.result?.value === true;
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * Abre la sesion de una GRABACION DE TAREA: igual que la de una tarea web (reconecta el contexto
   * guardado y FUERZA la salida pineada con la geolocalizacion del pais pineado), pero ademas devuelve
   * la URL DE LA VISTA EN VIVO, porque aqui es un humano quien va a manejar el navegador.
   *
   * Reusa el MISMO viewport explicito que el login (LOGIN_VIEWPORT): es lo que dimensiona la vista en
   * vivo del proveedor, asi que sin el la grabacion se veria al tamano por defecto.
   */
  async abrirSesionParaGrabacion(params: {
    contextoExternoId: string;
    proxyRef: string;
    proxyCountry: string;
  }): Promise<SesionDeGrabacionAbierta> {
    const { proxies } = this.resolverProxy(params.proxyRef, params.proxyCountry);

    const session = await this.bb.sessions.create({
      projectId: this.config.projectId,
      browserSettings: {
        context: { id: params.contextoExternoId, persist: true },
        viewport: { width: LOGIN_VIEWPORT.width, height: LOGIN_VIEWPORT.height },
      },
      proxies,
      keepAlive: true,
      timeout: GRABACION_SESSION_TIMEOUT_SECONDS,
    });

    let salida: SalidaEcho;
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      salida = await this.observarSalidaEnPagina(cdp, sessionId);
    } catch (error) {
      cdp.cerrar();
      await this.cerrarSesionSilencioso(session.id);
      throw error;
    }
    cdp.cerrar();

    const debug = await this.bb.sessions.debug(session.id);
    return {
      sesionExternaId: session.id,
      vistaEnVivoUrl: debug.debuggerFullscreenUrl,
      egressIp: salida.egressIp,
      egressCountry: salida.egressCountry,
    };
  }

  /**
   * INSTALA el grabador en la pagina y empieza a recibir sus eventos (CAMBIO 1 de la grabacion).
   *
   * Tres piezas de CDP, todas de solo lectura sobre la pagina:
   *  1. `Runtime.addBinding` con `executionContextName`: crea la funcion por la que el guion le habla
   *     al worker. Al llamarla, el navegador emite `Runtime.bindingCalled`, que es lo que se escucha
   *     aqui. Ligada al MUNDO AISLADO por nombre, asi que la pagina no la ve ni la puede llamar.
   *  2. `Page.addScriptToEvaluateOnNewDocument` con `worldName`: reinstala el guion en cada navegacion
   *     (la grabacion sobrevive a los cambios de pagina del usuario).
   *  3. Un `Page.createIsolatedWorld` + `Runtime.evaluate` para el documento que YA esta cargado, que
   *     el punto 2 por si solo no cubre.
   *
   * La conexion CDP queda ABIERTA mientras dura la grabacion (a diferencia del resto de los metodos,
   * que abren y cierran una por llamada): es el canal por el que llegan los eventos. `detener` la
   * cierra y quita el guion de las navegaciones futuras.
   */
  async iniciarCaptura(
    sesionExternaId: string,
    alRecibir: (crudo: string) => void,
  ): Promise<CapturaEnCurso> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      await cdp.enviar('Runtime.enable', {}, sessionId);
      await cdp.enviar(
        'Runtime.addBinding',
        { name: ENLACE_DE_GRABACION, executionContextName: MUNDO_DE_GRABACION },
        sessionId,
      );
      const { identifier } = await cdp.enviar<{ identifier: string }>(
        'Page.addScriptToEvaluateOnNewDocument',
        { source: GUION_GRABADOR, worldName: MUNDO_DE_GRABACION },
        sessionId,
      );

      cdp.suscribirEvento(
        'Runtime.bindingCalled',
        (params) => {
          const evento = params as { name?: unknown; payload?: unknown } | null;
          if (!evento || evento.name !== ENLACE_DE_GRABACION) return;
          if (typeof evento.payload === 'string') alRecibir(evento.payload);
        },
        sessionId,
      );

      // El documento que ya estaba cargado cuando se instalo el grabador: se le inyecta el guion en el
      // mismo mundo aislado, para no perder los primeros pasos del usuario.
      const { frameTree } = await cdp.enviar<{ frameTree: { frame: { id: string } } }>(
        'Page.getFrameTree',
        {},
        sessionId,
      );
      const { executionContextId } = await cdp.enviar<{ executionContextId: number }>(
        'Page.createIsolatedWorld',
        { frameId: frameTree.frame.id, worldName: MUNDO_DE_GRABACION },
        sessionId,
      );
      await cdp.enviar(
        'Runtime.evaluate',
        { expression: GUION_GRABADOR, contextId: executionContextId },
        sessionId,
      );

      let detenida = false;
      return {
        detener: async (): Promise<void> => {
          if (detenida) return;
          detenida = true;
          try {
            await cdp.enviar('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId);
          } catch {
            // La sesion puede haberse caido ya: cerrar el socket alcanza para dejar de escuchar.
          }
          cdp.cerrar();
        },
      };
    } catch (error) {
      cdp.cerrar();
      throw error;
    }
  }

  /**
   * LEE los valores ACTUALES de los campos del formulario de la pagina, con el contexto que los
   * identifica (name, id, tipo, placeholder, aria-label y la etiqueta asociada). Es la lectura
   * DETERMINISTA sobre la que se hace la verificacion previa a ejecutar una accion irreversible: lo
   * que se compara contra el objetivo del usuario es lo que el agente TECLEO O ELIGIO, no lo que la
   * pagina dice de si misma.
   *
   * Es de SOLO LECTURA (Runtime.evaluate sobre el DOM, sin tocar la pagina) y JAMAS lee un campo de
   * contrasena: su valor no se necesita para verificar nada y no debe salir del navegador. Incluye
   * los campos OCULTOS a proposito: un destinatario agregado en un input hidden es exactamente el
   * caso que la verificacion tiene que atrapar. Un campo vacio cuyo valor vive en un CHIP (Gmail
   * convierte el destinatario confirmado en uno) vuelve con el valor del chip; un campo cuyos chips
   * no entregaron ningun valor vuelve marcado noLeible, nunca como vacio.
   */
  async leerCamposDeLaPagina(sesionExternaId: string): Promise<CampoDeLaPagina[]> {
    const crudo = await this.evaluarEnLaPagina(sesionExternaId, EXPRESION_LEER_CAMPOS);
    if (crudo === null) return [];
    try {
      const parsed: unknown = JSON.parse(crudo);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item): CampoDeLaPagina[] => {
        if (typeof item !== 'object' || item === null) return [];
        const { contexto, valor, noLeible } = item as {
          contexto?: unknown;
          valor?: unknown;
          noLeible?: unknown;
        };
        if (typeof contexto !== 'string' || typeof valor !== 'string') return [];
        return [{ contexto, valor, ...(noLeible === true ? { noLeible: true } : {}) }];
      });
    } catch {
      return [];
    }
  }

  /**
   * PERCEPCION DE LA PAGINA (FIX A y B): la huella ligera (URL, titulo, conteo de nodos), el
   * descriptor del elemento con FOCO y los campos con su valor actual, leidos con el MISMO lector
   * de campos de la verificacion (chips, tokens y pills incluidos; ver EXPRESION_LEER_CAMPOS).
   * Solo lectura en el mundo aislado. Best-effort: cualquier fallo devuelve null y ese paso queda
   * sin percepcion; jamas cambia el desenlace de la tarea.
   *
   * `objetivo` (ATLAS DE SITIOS) agrega a ESTA MISMA evaluacion la lectura de las estrategias del
   * elemento que el paso toco. Es la MISMA conexion CDP: la percepcion ya la abria despues de cada
   * paso y el dato del elemento estaba ahi, sin leerse. Sin el parametro, la expresion evaluada es
   * exactamente la de siempre.
   */
  async percibirPagina(
    sesionExternaId: string,
    objetivo?: ObjetivoDeLectura | undefined,
  ): Promise<PercepcionDePagina | null> {
    try {
      const expresion =
        objetivo === undefined ? EXPRESION_PERCEPCION : expresionPercepcionConEstrategias(objetivo);
      const crudo = await this.evaluarEnLaPagina(sesionExternaId, expresion);
      return parsearPercepcion(crudo);
    } catch {
      return null;
    }
  }

  /**
   * LOCALIZA (sin clickear) el boton VISIBLE cuyo aria-label empieza con alguno de los prefijos
   * (modo simulacro de la FASE 3: validar la localizacion del boton Enviar contra Gmail real sin
   * enviar nada). Solo lectura en el mundo aislado; null = ningun boton visible matcheo.
   */
  async localizarBotonPorAriaLabel(
    sesionExternaId: string,
    prefijos: string[],
  ): Promise<BotonLocalizado | null> {
    const crudo = await this.evaluarEnLaPagina(
      sesionExternaId,
      expresionLocalizarBotonPorAriaLabel(prefijos),
    );
    if (crudo === null || crudo === '') return null;
    try {
      const parsed = JSON.parse(crudo) as {
        localizado?: { ariaLabel?: unknown; rol?: unknown } | null;
        candidatos?: unknown;
      };
      const localizado = parsed.localizado;
      if (
        localizado === null ||
        localizado === undefined ||
        typeof localizado.ariaLabel !== 'string' ||
        typeof localizado.rol !== 'string'
      ) {
        return null;
      }
      return {
        ariaLabel: localizado.ariaLabel,
        rol: localizado.rol,
        candidatos: typeof parsed.candidatos === 'number' ? parsed.candidatos : 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * SONDA DE RECONOCIMIENTO PREVIA (pre-flight): los CANDIDATOS crudos de cada clase de elemento,
   * leidos de la pagina en UNA evaluacion de solo lectura en el mundo aislado (misma primitiva que
   * la percepcion y el localizador de la barrera). Cero modelo, cero acciones: la expresion la
   * construye sonda-interfaz.ts con los mismos ayudantes de DOM que derivan la clase. null = la
   * lectura no sirve y la sonda queda no evaluable (jamas se declara desajuste sobre eso).
   */
  async leerCandidatosDeSonda(
    sesionExternaId: string,
    descriptores: readonly DescriptorDeSonda[],
  ): Promise<string[][] | null> {
    const crudo = await this.evaluarEnLaPagina(
      sesionExternaId,
      expresionSondaDeClases(descriptores),
    );
    return parsearLecturaDeSonda(crudo, descriptores.length);
  }

  /**
   * LEE el TEXTO VISIBLE de la pagina (o del elemento que indique `selector`), acotado. Complementa
   * la lectura de campos para los datos que un sitio muestra como texto y no como campo (el total de
   * un checkout, el nombre del producto). Evidencia mas DEBIL que un valor de campo: lo escribe el
   * sitio, asi que la verificacion solo lo usa como ultimo recurso.
   */
  async leerTextoVisible(sesionExternaId: string, selector?: string): Promise<string> {
    const expresion =
      selector === undefined
        ? EXPRESION_TEXTO_BODY
        : `(() => { const el = document.querySelector(${JSON.stringify(selector)}); ` +
          `return el ? String(el.innerText || el.textContent || '').slice(0, ${MAX_TEXTO_VISIBLE_CHARS}) : ''; })()`;
    return (await this.evaluarEnLaPagina(sesionExternaId, expresion)) ?? '';
  }

  /**
   * Evalua una expresion de SOLO LECTURA sobre la pagina actual y devuelve su valor si es texto.
   *
   * MUNDO AISLADO (Page.createIsolatedWorld), no el mundo de la pagina: es lo que hace confiable a la
   * verificacion determinista. En el mundo principal, el JavaScript del sitio (o el inyectado en el)
   * puede redefinir lo que la lectura ve -- un getter sobre HTMLInputElement.prototype.value, un
   * querySelectorAll propio, un JSON.stringify parcheado -- y devolver el valor que el usuario pidio
   * mientras el formulario lleva otro. Un mundo aislado comparte el MISMO DOM pero tiene sus propios
   * objetos globales y sus propios wrappers de los nodos, asi que ningun parche hecho por la pagina
   * lo alcanza (es el mismo mecanismo con el que las extensiones leen paginas hostiles).
   *
   * Best-effort: cualquier fallo (sesion caida, evaluacion rechazada) devuelve null y el llamador
   * decide; en la verificacion, no poder leer NUNCA autoriza a ejecutar.
   */
  private async evaluarEnLaPagina(sesionExternaId: string, expresion: string): Promise<string | null> {
    return this.conPaginaCdp(sesionExternaId, (pagina) => pagina.evaluar(expresion));
  }

  /**
   * Abre UNA conexion CDP contra la sesion, se adhiere a la pagina y le entrega a `fn` un pequeno
   * mando (evaluar en el mundo aislado, disparar entrada real, navegar). Existe para que un paso de
   * receta (resolver el elemento, actuar y releer sus estrategias) gaste UNA sola conexion en vez de
   * una por primitiva.
   */
  private async conPaginaCdp<T>(
    sesionExternaId: string,
    fn: (pagina: PaginaCdp) => Promise<T>,
  ): Promise<T> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      return await fn(new PaginaCdp(cdp, sessionId));
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * LEE del DOM las formas estables de volver a encontrar un elemento (CAMBIO 1). Solo lectura, en
   * el mundo aislado. Best-effort: si el elemento ya no esta (un click que navego), devuelve lista
   * vacia y ese paso simplemente no se podra promover a receta.
   */
  async leerEstrategiasDeElemento(
    sesionExternaId: string,
    referencia: ReferenciaDeElemento,
  ): Promise<EstrategiaLocalizacion[]> {
    const crudo = await this.evaluarEnLaPagina(
      sesionExternaId,
      expresionLeerEstrategias(referencia),
    );
    return crudo === null || crudo === '' ? [] : sanearEstrategias(crudo);
  }

  /**
   * EJECUTA UN PASO de una receta con primitivas de bajo nivel, SIN modelo (CAMBIO 4). Resuelve el
   * elemento probando las estrategias en orden, actua con eventos de entrada REALES (los mismos que
   * genera una persona: un sitio que exige eventos confiables funciona igual) y devuelve las
   * estrategias que el elemento tiene ahora, para la auto reparacion.
   *
   * Nunca lanza por un paso que no resolvio: eso es un desenlace normal ('no_localizado') que el
   * ejecutor convierte en escalada. Solo un fallo de la propia sesion se propaga.
   */
  async ejecutarPasoDeterminista(
    sesionExternaId: string,
    instruccion: InstruccionDePaso,
  ): Promise<ResultadoPasoDeterminista> {
    if (instruccion.accion === 'esperar') {
      await pausar(Math.min(instruccion.esperaMs ?? 0, ESPERA_DE_CARGA_MS));
      return { estado: 'ok', estrategias: [], indiceUsado: null, detalle: null };
    }
    return this.conPaginaCdp(sesionExternaId, async (pagina) => {
      if (instruccion.accion === 'navegar') {
        if (instruccion.url === null) {
          return { estado: 'fallo', estrategias: [], indiceUsado: null, detalle: 'navegacion sin url' } as const;
        }
        await pagina.navegar(instruccion.url);
        return { estado: 'ok', estrategias: [], indiceUsado: null, detalle: null } as const;
      }

      // PULSACION SOBRE EL FOCO: una tecla actua sobre el elemento ENFOCADO, que es la semantica
      // real del teclado y lo que ocurrio en la corrida que se aprendio (el Tab que confirma el chip
      // del destinatario cae sobre el campo que acaba de recibir el texto). No se localiza nada: la
      // receta 2017cfba moria aqui porque su paso de teclas exigia un xpath del compose viejo que en
      // sesion fresca no resuelve. Tambien cubre los pasos de teclas SIN estrategias, que es la forma
      // que dejan la grabacion y los pasos 'keys' de la traza.
      if (
        instruccion.accion === 'teclas' &&
        (instruccion.sobreElFoco === true || instruccion.estrategias.length === 0)
      ) {
        const pulsacion =
          instruccion.teclas === null ? null : parsearCombinacionDeTeclas(instruccion.teclas);
        if (pulsacion === null) {
          return { estado: 'fallo', estrategias: [], indiceUsado: null, detalle: 'combinacion de teclas no admitida' } as const;
        }
        await pagina.pulsar(pulsacion);
        await pausar(PAUSA_TRAS_ACCION_MS);
        return { estado: 'ok', estrategias: [], indiceUsado: null, detalle: null } as const;
      }

      const crudo = await pagina.evaluar(expresionResolverElemento(instruccion.estrategias));
      const elemento = crudo === null || crudo === '' ? null : leerElementoResuelto(crudo);
      if (elemento === null) {
        return {
          estado: 'no_localizado',
          estrategias: [],
          indiceUsado: null,
          detalle: 'ninguna estrategia resolvio el elemento',
        } as const;
      }

      if (instruccion.accion === 'click') {
        await pagina.click(elemento);
        await pausar(PAUSA_TRAS_ACCION_MS);
        return { estado: 'ok', estrategias: elemento.estrategias, indiceUsado: elemento.indice, detalle: null } as const;
      }

      if (instruccion.accion === 'escribir') {
        if (instruccion.texto === null) {
          return { estado: 'fallo', estrategias: [], indiceUsado: null, detalle: 'escritura sin texto' } as const;
        }
        // Click para enfocar, seleccionar lo que hubiera y sustituirlo: un campo prellenado por el
        // sitio no debe quedar concatenado con el valor nuevo.
        await pagina.click(elemento);
        await pagina.evaluar(EXPRESION_VACIAR_CAMPO_ENFOCADO);
        await pagina.pulsar({ key: 'Delete', windowsVirtualKeyCode: 46, modifiers: 0, text: null });
        await pagina.insertarTexto(instruccion.texto);
        await pausar(PAUSA_TRAS_ACCION_MS);
        return { estado: 'ok', estrategias: elemento.estrategias, indiceUsado: elemento.indice, detalle: null } as const;
      }

      const pulsacion =
        instruccion.teclas === null ? null : parsearCombinacionDeTeclas(instruccion.teclas);
      if (pulsacion === null) {
        return { estado: 'fallo', estrategias: [], indiceUsado: null, detalle: 'combinacion de teclas no admitida' } as const;
      }
      await pagina.click(elemento);
      await pagina.pulsar(pulsacion);
      await pausar(PAUSA_TRAS_ACCION_MS);
      return { estado: 'ok', estrategias: elemento.estrategias, indiceUsado: elemento.indice, detalle: null } as const;
    });
  }

  /** Attach (flatten) al primer tab de la sesion y Page.enable; devuelve el sessionId page-level. */
  private async attachPaginaInicial(cdp: ClienteCdp): Promise<string> {
    const { targetInfos } = await cdp.enviar<{ targetInfos: TargetInfo[] }>('Target.getTargets');
    const pagina = targetInfos.find((t) => t.type === 'page');
    if (!pagina) throw new Error('la sesion de navegador no expone ninguna pagina');
    const { sessionId } = await cdp.enviar<{ sessionId: string }>('Target.attachToTarget', {
      targetId: pagina.targetId,
      flatten: true,
    });
    await cdp.enviar('Page.enable', {}, sessionId);
    return sessionId;
  }

  /**
   * Captura un SCREENSHOT PNG (base64) de la pagina actual de la sesion viva, SIN navegarla ni
   * tocarla (Page.captureScreenshot es de solo lectura). Es la evidencia que el humano ve en el
   * modal del checkpoint de aprobacion (7.1e): exactamente lo que el agente tenia en pantalla.
   */
  async capturarPantalla(sesionExternaId: string): Promise<string> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      const captura = await cdp.enviar<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png' },
        sessionId,
      );
      return captura.data;
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * OBSERVA la salida de red actual (IP + pais) de la sesion viva SIN tocar la pagina de la tarea:
   * abre una PESTANA NUEVA (Target.createTarget), navega el echo ahi y la cierra. Es la
   * re-verificacion del pin POR PAIS al REANUDAR un checkpoint (7.1e): navegar la pestana principal
   * al echo destruiria el estado del checkout que la pausa preservo. Best-effort: si el echo falla
   * devuelve nulls (y el handler, sin pais observado, NO verifica -> aborta, igual que en 7.1d).
   */
  async observarSalida(sesionExternaId: string): Promise<SalidaEcho> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const { targetId } = await cdp.enviar<{ targetId: string }>('Target.createTarget', {
        url: 'about:blank',
      });
      try {
        const { sessionId } = await cdp.enviar<{ sessionId: string }>('Target.attachToTarget', {
          targetId,
          flatten: true,
        });
        await cdp.enviar('Page.enable', {}, sessionId);
        return await this.observarSalidaEnPagina(cdp, sessionId);
      } finally {
        // La pestana del echo se cierra SIEMPRE: la de la tarea queda intacta.
        await cdp.enviar('Target.closeTarget', { targetId }).catch(() => undefined);
      }
    } catch {
      return { egressIp: null, egressCountry: null };
    } finally {
      cdp.cerrar();
    }
  }

  async estadoDeSesion(sesionExternaId: string): Promise<'viva' | 'muerta'> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    return session.status === 'RUNNING' ? 'viva' : 'muerta';
  }

  /**
   * Extrae las cookies de la sesion viva por CDP (Storage.getCookies, browser-level) y las
   * serializa como el contexto a cifrar. El storage por origen queda del lado del contexto del
   * proveedor (persist); la copia cifrada local son las cookies, que son la credencial de sesion.
   */
  async extraerContexto(sesionExternaId: string): Promise<string> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const resultado = await cdp.enviar<{ cookies: unknown[] }>('Storage.getCookies');
      return JSON.stringify({ formato: 'cookies-cdp-v1', cookies: resultado.cookies });
    } finally {
      cdp.cerrar();
    }
  }

  async cerrarSesion(sesionExternaId: string): Promise<void> {
    await this.bb.sessions.update(sesionExternaId, {
      projectId: this.config.projectId,
      status: 'REQUEST_RELEASE',
    });
  }

  async borrarContexto(contextoExternoId: string): Promise<void> {
    await this.bb.contexts.delete(contextoExternoId);
  }

  private async cerrarSesionSilencioso(sesionExternaId: string): Promise<void> {
    try {
      await this.cerrarSesion(sesionExternaId);
    } catch {
      // best-effort: el timeout de 15 min del proveedor es la red de seguridad
    }
  }
}
