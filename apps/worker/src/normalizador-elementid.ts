import type { Logger } from './logger.js';

/**
 * NORMALIZADOR DEFENSIVO DE elementId SIN PREFIJO (FIX C, complemento del parche de Stagehand).
 *
 * El parche de patches/@browserbasehq+stagehand+3.6.0.patch garantiza que el arbol de accesibilidad
 * NO le ofrezca al modelo identificadores sin el prefijo de frame. Aun asi el modelo puede QUITAR el
 * prefijo por su cuenta (el propio esquema de Stagehand lo advierte: "if the accessibility tree
 * shows [0-18372], return '0-18372', not '18372'"). Cuando eso pasa, el esquema de act/observe
 * (lib/inference.js, /^\d+-\d+$/) rechaza la salida con NoObjectGeneratedError y el fallo es
 * DETERMINISTA: el mismo arbol produce el mismo id y el mismo rechazo, hasta que el corte por
 * identificador repetido termina la corrida.
 *
 * Este complemento vive en NUESTRO codigo (no en el parche): envuelve `createChatCompletion` del
 * cliente LLM que Stagehand construyo y, cuando una llamada CON response_model falla por esquema con
 * un elementId /^\d+$/ y la pagina tiene EXACTAMENTE UN frame (todos los ids del arbol enviado
 * llevan prefijo 0-), normaliza el id a `0-<id>`, re-valida contra el MISMO esquema zod de la
 * llamada y devuelve la salida rescatada, logueando la normalizacion. Cualquier duda (varios frames,
 * texto ilegible, esquema que sigue rechazando) re-lanza el error original: nunca se inventa nada.
 */

/** El patron del esquema de act/observe de Stagehand (lib/inference.js). */
const PATRON_ID_VALIDO = /^\d+-\d+$/;

/** Un id "pelon": solo digitos, sin el prefijo de frame. */
const PATRON_ID_PELON = /^\d+$/;

/** Ids prefijados tal como se rotulan en el arbol enviado al modelo: [frame-backendNodeId]. */
const PATRON_ID_ROTULADO = /\[(\d+)-\d+\]/g;

/** Marca para no envolver dos veces el mismo cliente. */
const MARCA_INSTALADO = '__normalizadorElementIdInstalado';

/** Junta todo el texto de un arbol de mensajes (content puede ser string o partes tipadas). */
function textosDeMensajes(valor: unknown, salida: string[], profundidad = 0): void {
  if (profundidad > 6 || salida.length > 500) return;
  if (typeof valor === 'string') {
    salida.push(valor);
    return;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) textosDeMensajes(item, salida, profundidad + 1);
    return;
  }
  if (typeof valor === 'object' && valor !== null) {
    const { content, text } = valor as { content?: unknown; text?: unknown };
    textosDeMensajes(content, salida, profundidad + 1);
    textosDeMensajes(text, salida, profundidad + 1);
  }
}

/**
 * ¿El arbol que viajo al modelo describe EXACTAMENTE UN frame? Se leen los prefijos de todos los ids
 * rotulados en los mensajes: un solo frame significa que todos son 0. Sin ningun id rotulado no se
 * puede afirmar nada y la normalizacion NO procede (conservador a proposito).
 */
export function hayUnSoloFrame(mensajes: unknown): boolean {
  const textos: string[] = [];
  textosDeMensajes(mensajes, textos);
  const prefijos = new Set<string>();
  for (const texto of textos) {
    for (const match of texto.matchAll(PATRON_ID_ROTULADO)) {
      if (match[1] !== undefined) prefijos.add(match[1]);
    }
  }
  if (prefijos.size === 0) return false;
  for (const prefijo of prefijos) {
    if (prefijo !== '0') return false;
  }
  return true;
}

/**
 * Recorre una salida parseada y normaliza TODO `elementId` pelon a `0-<id>`. Devuelve la copia
 * normalizada y la lista de ids que se tocaron (solo numeros del arbol: no arrastran contenido).
 */
export function normalizarIdsPelones(valor: unknown): { valor: unknown; normalizados: string[] } {
  const normalizados: string[] = [];
  const recorrer = (nodo: unknown, profundidad = 0): unknown => {
    if (profundidad > 8) return nodo;
    if (Array.isArray(nodo)) return nodo.map((item) => recorrer(item, profundidad + 1));
    if (typeof nodo !== 'object' || nodo === null) return nodo;
    const copia: Record<string, unknown> = {};
    for (const [clave, contenido] of Object.entries(nodo)) {
      if (clave === 'elementId' && typeof contenido === 'string' && PATRON_ID_PELON.test(contenido)) {
        normalizados.push(contenido);
        copia[clave] = `0-${contenido}`;
        continue;
      }
      copia[clave] = recorrer(contenido, profundidad + 1);
    }
    return copia;
  };
  return { valor: recorrer(valor), normalizados };
}

/** ¿Hay en la salida algun elementId que el esquema fuera a aceptar tal cual o tras normalizar? */
function esRechazoDeEsquema(error: unknown, profundidad = 0): boolean {
  if (typeof error !== 'object' || error === null || profundidad > 4) return false;
  const { name, message, cause } = error as { name?: unknown; message?: unknown; cause?: unknown };
  const nombre = typeof name === 'string' ? name : '';
  if (
    nombre.includes('NoObjectGeneratedError') ||
    nombre.includes('TypeValidationError') ||
    nombre.includes('ZodError')
  ) {
    return true;
  }
  const texto = typeof message === 'string' ? message.toLowerCase() : '';
  if (texto.includes('no object generated') || texto.includes('did not match schema')) return true;
  return esRechazoDeEsquema(cause, profundidad + 1);
}

/** El JSON crudo que el modelo devolvio, buscado en el error y en su cadena de `cause`. */
export function textoDeFalloDeEsquema(error: unknown, profundidad = 0): string | null {
  if (typeof error !== 'object' || error === null || profundidad > 4) return null;
  const { text, value, cause } = error as { text?: unknown; value?: unknown; cause?: unknown };
  if (typeof text === 'string' && text !== '') return text;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      // se sigue con la cadena de cause
    }
  }
  return textoDeFalloDeEsquema(cause, profundidad + 1);
}

/** Usage del error del AI SDK, traducido a la forma que devuelve createChatCompletion. */
function usageDeFallo(error: unknown): Record<string, number> {
  const usage =
    typeof error === 'object' && error !== null ? (error as { usage?: unknown }).usage : undefined;
  const leer = (clave: string): number => {
    if (typeof usage !== 'object' || usage === null) return 0;
    const valor = (usage as Record<string, unknown>)[clave];
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
  };
  return {
    prompt_tokens: leer('inputTokens'),
    completion_tokens: leer('outputTokens'),
    reasoning_tokens: leer('reasoningTokens'),
    cached_input_tokens: leer('cachedInputTokens'),
    total_tokens: leer('totalTokens'),
  };
}

/**
 * Intenta RESCATAR la salida rechazada: parsea el texto crudo, normaliza los elementId pelones (solo
 * con un unico frame) y re-valida contra el esquema zod de la llamada. null = no rescatable (el
 * llamador re-lanza el error original).
 */
export function rescatarSalidaConIdPelon(params: {
  error: unknown;
  mensajes: unknown;
  esquema: unknown;
  logger: Logger;
}): { data: unknown; usage: Record<string, number> } | null {
  if (!esRechazoDeEsquema(params.error)) return null;
  const texto = textoDeFalloDeEsquema(params.error);
  if (texto === null) return null;
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return null;
  }
  const { valor, normalizados } = normalizarIdsPelones(crudo);
  if (normalizados.length === 0) return null;
  if (!hayUnSoloFrame(params.mensajes)) {
    params.logger.warn(
      'tarea web: el modelo devolvio un elementId sin prefijo pero la pagina tiene varios frames; no se normaliza',
      { elementIds: normalizados },
    );
    return null;
  }
  const parse = (params.esquema as { parse?: unknown } | null)?.parse;
  if (typeof parse !== 'function') return null;
  let data: unknown;
  try {
    data = (parse as (valor: unknown) => unknown).call(params.esquema, valor);
  } catch {
    return null;
  }
  // Solo numeros del arbol de accesibilidad: la normalizacion no arrastra contenido de la pagina.
  params.logger.warn(
    'tarea web: el modelo devolvio elementId sin prefijo y habia un solo frame; se normalizo a 0-<id>',
    { elementIds: normalizados.map((id) => `${id} -> 0-${id}`) },
  );
  return { data, usage: usageDeFallo(params.error) };
}

/** Forma minima de la llamada que el wrapper inspecciona (la real es la de Stagehand). */
interface LlamadaDeCompletion {
  options?: {
    messages?: unknown;
    response_model?: { schema?: unknown } | undefined;
  };
}

/**
 * INSTALA el normalizador sobre el cliente LLM del Stagehand YA inicializado (propiedad de
 * instancia, no del modulo: no toca nada global). Devuelve true si quedo instalado. Si la version de
 * Stagehand cambiara la forma interna, simplemente no se instala y todo sigue como antes: es una red
 * de seguridad, no un requisito.
 */
export function instalarNormalizadorDeElementId(stagehand: unknown, logger: Logger): boolean {
  if (typeof stagehand !== 'object' || stagehand === null) return false;
  const cliente = (stagehand as { llmClient?: unknown }).llmClient;
  if (typeof cliente !== 'object' || cliente === null) {
    logger.warn('tarea web: el motor no expone su cliente LLM; el normalizador de elementId no se instala');
    return false;
  }
  const registro = cliente as Record<string, unknown>;
  if (registro[MARCA_INSTALADO] === true) return true;
  const original = registro['createChatCompletion'];
  if (typeof original !== 'function') {
    logger.warn(
      'tarea web: el cliente LLM del motor no expone createChatCompletion; el normalizador de elementId no se instala',
    );
    return false;
  }
  registro['createChatCompletion'] = async function (...args: unknown[]): Promise<unknown> {
    const llamada = (args[0] ?? {}) as LlamadaDeCompletion;
    const esquema = llamada.options?.response_model?.schema;
    try {
      return await (original as (...a: unknown[]) => Promise<unknown>).apply(cliente, args);
    } catch (error) {
      if (esquema === undefined) throw error;
      const rescatado = rescatarSalidaConIdPelon({
        error,
        mensajes: llamada.options?.messages,
        esquema,
        logger,
      });
      if (rescatado !== null) return rescatado;
      throw error;
    }
  };
  registro[MARCA_INSTALADO] = true;
  return true;
}

/** Exportado para los tests: el patron que el esquema del motor acepta. */
export { PATRON_ID_VALIDO };
