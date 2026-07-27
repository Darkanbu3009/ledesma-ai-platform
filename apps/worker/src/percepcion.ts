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
 * PRESUPUESTO DE CONTEXTO: las lineas pendientes se entregan por turno con un tope duro
 * (MAX_LINEAS_POR_TURNO); el costo por corrida importa y este canal no puede crecer sin cota.
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
}

/** PUERTO de lectura: lo implementa el handler sobre browserbase.percibirPagina. Nunca lanza. */
export interface PerceptorDePagina {
  percibir(): Promise<PercepcionDePagina | null>;
}

/** Tope DURO de lineas de percepcion que se adjuntan al contexto del agente por turno. */
export const MAX_LINEAS_POR_TURNO = 10;

/** Tope del descriptor de un campo o una accion dentro de una linea (el contexto ya viene acotado). */
const MAX_DESCRIPTOR_CHARS = 90;

/** Prefijo de TODAS las lineas: el agente debe distinguirlas del contenido de la pagina. */
export const PREFIJO_PERCEPCION = 'PERCEPCION DEL SISTEMA';

/**
 * Construye la expresion de percepcion COMPONIENDO el lector de campos existente (EXPRESION_LEER_CAMPOS
 * de browserbase.ts, que llega por parametro para no crear un ciclo de imports): mismos campos, mismos
 * chips, mas la huella (URL, titulo, nodos) y el descriptor del elemento con foco. Solo lectura.
 */
export function construirExpresionPercepcion(expresionCampos: string): string {
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
  return JSON.stringify({
    url: String(location.href || '').slice(0, 500),
    titulo: String(document.title || '').slice(0, 200),
    nodos: document.querySelectorAll('*').length,
    foco: foco,
    campos: campos,
  });
})()`;
}

/** Parsea (tolerante) lo que la expresion devolvio. null = no se pudo leer; jamas lanza. */
export function parsearPercepcion(crudo: string | null): PercepcionDePagina | null {
  if (crudo === null || crudo === '') return null;
  try {
    const parsed: unknown = JSON.parse(crudo);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { url, titulo, nodos, foco, campos } = parsed as {
      url?: unknown;
      titulo?: unknown;
      nodos?: unknown;
      foco?: unknown;
      campos?: unknown;
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
    return { url, titulo, nodos, foco: typeof foco === 'string' && foco !== '' ? foco : null, campos: listaCampos };
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
 * ¿El contexto del campo donde aterrizo el texto corresponde al objetivo que el agente declaro?
 * Best-effort deliberado: sin tokens utiles no se afirma discrepancia (la linea de aterrizaje ya
 * le muestra al agente donde quedo el texto, que es la informacion que importa).
 */
export function coincideConObjetivoDeclarado(
  descripcion: string,
  textoTecleado: string,
  contextoDelCampo: string,
): boolean | null {
  const tokens = tokensDelObjetivoDeclarado(descripcion, textoTecleado);
  if (tokens.length === 0) return null;
  const contexto = contextoDelCampo.toLowerCase();
  return tokens.some((token) => contexto.includes(token));
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
} | null {
  if (typeof result !== 'object' || result === null) return null;
  const envoltorio = result as { output?: unknown; playwrightArguments?: unknown };
  const salida =
    typeof envoltorio.output === 'object' && envoltorio.output !== null
      ? (envoltorio.output as { playwrightArguments?: unknown })
      : envoltorio;
  const accion = salida.playwrightArguments;
  if (typeof accion !== 'object' || accion === null) return null;
  const { method, arguments: argumentos } = accion as { method?: unknown; arguments?: unknown };
  if (typeof method !== 'string') return null;
  return {
    method,
    argumentos: Array.isArray(argumentos)
      ? argumentos.filter((a): a is string => typeof a === 'string')
      : [],
  };
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

/** Control de percepcion de UNA corrida del motor: acumula lineas y las entrega por turno. */
export interface ControlDePercepcion {
  /** Toma la huella INICIAL (el "antes" del primer paso). Best-effort: nunca lanza. */
  inicializar(): Promise<void>;
  /** Corre la percepcion que corresponda al paso recien terminado. Best-effort: nunca lanza. */
  alTerminarPaso(evento: EventoDePasoPercibido): Promise<void>;
  /** Drena las lineas pendientes (acotadas a MAX_LINEAS_POR_TURNO) para el siguiente turno. */
  tomarLineas(): string[];
}

/**
 * Crea el control de percepcion de una corrida. La huella "antes" de cada paso es la percepcion
 * leida DESPUES del paso anterior (entre pasos nadie mas toca la pagina: solo actua el agente), y la
 * inicial se toma al arrancar la corrida. Todo es best-effort: si una lectura falla, ese paso queda
 * sin percepcion y la tarea sigue igual.
 */
export function crearControlDePercepcion(params: {
  percibir: () => Promise<PercepcionDePagina | null>;
  logger?: Logger | undefined;
}): ControlDePercepcion {
  let previa: PercepcionDePagina | null = null;
  let cola: string[] = [];

  const percibirSeguro = async (): Promise<PercepcionDePagina | null> => {
    try {
      return await params.percibir();
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
    alTerminarPaso: async (evento: EventoDePasoPercibido): Promise<void> => {
      const paso = interpretarPaso(evento);
      if (paso.tipo === 'ignorar') return;
      const actual = await percibirSeguro();
      if (actual === null) return;
      if (paso.tipo === 'click' && previa !== null && mismaHuella(previa, actual)) {
        cola.push(lineaDeClickSinEfecto(paso.descripcion));
      }
      if (paso.tipo === 'escritura') {
        cola.push(
          ...lineasDeAterrizaje({ percepcion: actual, texto: paso.texto, descripcion: paso.descripcion }),
        );
      }
      previa = actual;
    },
    tomarLineas: (): string[] => {
      const lineas = cola.slice(0, MAX_LINEAS_POR_TURNO);
      cola = [];
      return lineas;
    },
  };
}
