import {
  clasificarFalloDeAccesoAlModelo,
  marcaDeFalloDeModelo,
  type ClaseDeFalloDeModelo,
} from './fallo-modelo.js';
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
 * un elementId /^\d+$/, RESUELVE a que frame pertenece ese id buscandolo entre los ids rotulados
 * [frame-id] del arbol que viajo al modelo: si el id existe en EXACTAMENTE UN frame, se normaliza a
 * `<frame>-<id>`, se re-valida contra el MISMO esquema zod de la llamada y se devuelve la salida
 * rescatada, logueando la normalizacion. Si el id existe en varios frames o en ninguno (ambiguedad
 * real), o el texto es ilegible, o el esquema sigue rechazando, se re-lanza el error original: nunca
 * se inventa nada. El caso Gmail (multiples iframes SIEMPRE, id valido del frame principal) queda
 * cubierto: antes la regla exigia un unico frame y en Gmail no operaba jamas.
 */

/** El patron del esquema de act/observe de Stagehand (lib/inference.js). */
const PATRON_ID_VALIDO = /^\d+-\d+$/;

/** Un id "pelon": solo digitos, sin el prefijo de frame. */
const PATRON_ID_PELON = /^\d+$/;

/** Ids prefijados tal como se rotulan en el arbol enviado al modelo: [frame-backendNodeId]. */
const PATRON_ID_ROTULADO = /\[(\d+)-(\d+)\]/g;

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
 * EN QUE FRAMES rotula el arbol enviado cada backendNodeId: mapa id -> conjunto de frames. Es la
 * base de la resolucion multiframe: un id pelon solo se puede normalizar si el arbol lo rotula en
 * EXACTAMENTE un frame.
 */
export function framesPorId(mensajes: unknown): Map<string, Set<string>> {
  const textos: string[] = [];
  textosDeMensajes(mensajes, textos);
  const mapa = new Map<string, Set<string>>();
  for (const texto of textos) {
    for (const match of texto.matchAll(PATRON_ID_ROTULADO)) {
      const frame = match[1];
      const id = match[2];
      if (frame === undefined || id === undefined) continue;
      const frames = mapa.get(id) ?? new Set<string>();
      frames.add(frame);
      mapa.set(id, frames);
    }
  }
  return mapa;
}

/**
 * El frame al que pertenece un id pelon, si el arbol lo rotula en EXACTAMENTE UN frame. Devuelve
 * null si el id aparece en varios frames o en ninguno: esa es la ambiguedad REAL en la que
 * normalizar seria adivinar (conservador a proposito).
 */
export function resolverFrameDeId(id: string, frames: Map<string, Set<string>>): string | null {
  const conjunto = frames.get(id);
  if (conjunto === undefined || conjunto.size !== 1) return null;
  return [...conjunto][0] ?? null;
}

/**
 * Recorre una salida parseada y normaliza TODO `elementId` pelon al frame que la resolucion le
 * asigne (`<frame>-<id>`). Devuelve la copia normalizada, la lista de ids resueltos (con su destino,
 * para el log) y los que quedaron SIN resolver (ambiguos o ausentes del arbol): con uno solo sin
 * resolver, el llamador no rescata nada.
 */
export function normalizarIdsPelones(
  valor: unknown,
  frames: Map<string, Set<string>>,
): { valor: unknown; normalizados: string[]; sinResolver: string[] } {
  const normalizados: string[] = [];
  const sinResolver: string[] = [];
  const recorrer = (nodo: unknown, profundidad = 0): unknown => {
    if (profundidad > 8) return nodo;
    if (Array.isArray(nodo)) return nodo.map((item) => recorrer(item, profundidad + 1));
    if (typeof nodo !== 'object' || nodo === null) return nodo;
    const copia: Record<string, unknown> = {};
    for (const [clave, contenido] of Object.entries(nodo)) {
      if (clave === 'elementId' && typeof contenido === 'string' && PATRON_ID_PELON.test(contenido)) {
        const frame = resolverFrameDeId(contenido, frames);
        if (frame === null) {
          sinResolver.push(contenido);
          copia[clave] = contenido;
        } else {
          normalizados.push(`${contenido} -> ${frame}-${contenido}`);
          copia[clave] = `${frame}-${contenido}`;
        }
        continue;
      }
      copia[clave] = recorrer(contenido, profundidad + 1);
    }
    return copia;
  };
  return { valor: recorrer(valor), normalizados, sinResolver };
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
 * Intenta RESCATAR la salida rechazada: parsea el texto crudo, resuelve el frame de cada elementId
 * pelon contra el arbol enviado y re-valida contra el esquema zod de la llamada. null = no
 * rescatable (el llamador re-lanza el error original).
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
  const { valor, normalizados, sinResolver } = normalizarIdsPelones(crudo, framesPorId(params.mensajes));
  if (normalizados.length === 0 && sinResolver.length === 0) return null;
  if (sinResolver.length > 0) {
    params.logger.warn(
      'tarea web: el modelo devolvio un elementId sin prefijo que no aparece en exactamente un frame del arbol; no se normaliza',
      { elementIds: sinResolver },
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
    'tarea web: el modelo devolvio elementId sin prefijo; el id aparece en un solo frame del arbol y se normalizo a <frame>-<id>',
    { elementIds: normalizados },
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

/**
 * MIDDLEWARE DE MODELO (FIX B y C, jul 2026). La instalacion de arriba envuelve el cliente LLM DE
 * INSTANCIA de un Stagehand ya inicializado, pero Stagehand puede crear MAS clientes por su cuenta
 * (resolveLlmClient ante cualquier override de modelo por llamada) y el rescate solo actua DESPUES
 * del rechazo de esquema. Este middleware entra por el UNICO punto de paso obligatorio que la API
 * publica de Stagehand ofrece: `model.middleware` (construirOpcionesStagehand), que LLMProvider
 * aplica con wrapLanguageModel a TODO LanguageModelV2 que cree para esa instancia -- el cliente
 * inicial, los overrides por llamada y el modelo del bucle del agente. Ningun camino, presente o
 * futuro, puede nacer sin el.
 *
 *  - FIX B (wrapGenerate): normaliza el elementId pelon en la salida cruda ANTES de que el esquema
 *    de act/observe la valide, con la MISMA regla conservadora del rescate: el id tiene que aparecer
 *    en exactamente un frame del prompt. El fallo ya no llega a producirse; el rescate de instancia
 *    queda de segunda red.
 *  - FIX C (transformParams): las llamadas de inferencia con esquema (act, observe, extract) viajan
 *    sin ninguna marca de cache de prompt (el cliente aisdk de Stagehand no marca nada; en
 *    produccion, 28 jul 2026, cachedInputTokens llego en 0). Se marca el ULTIMO mensaje de sistema
 *    como cacheable -- el mismo patron del bucle del agente (costo-modelo.ts): el prefijo estable
 *    (tools + system, identico llamada a llamada) deja de pagarse como entrada nueva. Las llamadas
 *    que YA llevan una marca (las del bucle del agente, marcadas por prepareStep) no se tocan.
 *
 * Tipos ESTRUCTURALES a proposito (mismo criterio que costo-modelo.ts): el worker no depende del
 * paquete `ai`; el unico punto que cruza estos tipos con los reales es construirOpcionesStagehand.
 */

/** Forma estructural de un mensaje del prompt del AI SDK (LanguageModelV2Prompt). */
interface MensajeDePrompt {
  role?: string;
  content?: unknown;
  providerOptions?: Record<string, Record<string, unknown>> | undefined;
}

/** Forma estructural de los parametros de una llamada del AI SDK (LanguageModelV2CallOptions). */
export interface ParametrosDeLlamadaDeModelo {
  prompt?: unknown;
  [clave: string]: unknown;
}

/** Forma estructural de una parte generada: texto directo o tool-call con el JSON en `input`. */
interface ParteGenerada {
  type?: string;
  text?: unknown;
  input?: unknown;
}

/** Resultado estructural de doGenerate: solo se toca `content`, el resto viaja intacto. */
export interface ResultadoDeGeneracion {
  content?: unknown;
  [clave: string]: unknown;
}

export interface MiddlewareDeModelo {
  transformParams(opciones: {
    type: string;
    params: ParametrosDeLlamadaDeModelo;
  }): Promise<ParametrosDeLlamadaDeModelo>;
  wrapGenerate(opciones: {
    doGenerate: () => PromiseLike<ResultadoDeGeneracion>;
    params: ParametrosDeLlamadaDeModelo;
  }): Promise<ResultadoDeGeneracion>;
}

/** elementId pelon dentro del JSON crudo de una salida ("elementId":"123", sin prefijo de frame). */
const PATRON_ID_PELON_EN_JSON = /("elementId"\s*:\s*")(\d+)(")/g;

/**
 * Normaliza los elementId pelones de un texto JSON crudo, sin parsearlo (la validacion viene
 * despues), resolviendo el frame de cada uno contra el arbol enviado. Un id que no se pueda
 * resolver queda tal cual y se reporta en `sinResolver`.
 */
export function normalizarIdsPelonesEnTexto(
  texto: string,
  frames: Map<string, Set<string>>,
): { texto: string; normalizados: string[]; sinResolver: string[] } {
  const normalizados: string[] = [];
  const sinResolver: string[] = [];
  const normalizado = texto.replace(
    PATRON_ID_PELON_EN_JSON,
    (todo, antes: string, id: string, despues: string) => {
      const frame = resolverFrameDeId(id, frames);
      if (frame === null) {
        sinResolver.push(id);
        return todo as string;
      }
      normalizados.push(`${id} -> ${frame}-${id}`);
      return `${antes}${frame}-${id}${despues}`;
    },
  );
  return { texto: normalizado, normalizados, sinResolver };
}

/** ¿Algun mensaje del prompt YA lleva una marca de cache de Anthropic? (el bucle del agente marca). */
function llevaMarcaDeCache(prompt: readonly unknown[]): boolean {
  return prompt.some((mensaje) => {
    const opciones = (mensaje as MensajeDePrompt | null)?.providerOptions;
    return opciones?.['anthropic']?.['cacheControl'] !== undefined;
  });
}

/**
 * FIX C: marca el ULTIMO mensaje de sistema como fin del prefijo cacheable. Devuelve los mismos
 * parametros si la llamada ya lleva marcas (bucle del agente) o no tiene mensaje de sistema.
 */
export function conCacheEnElPrefijo(params: ParametrosDeLlamadaDeModelo): ParametrosDeLlamadaDeModelo {
  const prompt = params.prompt;
  if (!Array.isArray(prompt) || llevaMarcaDeCache(prompt)) return params;
  let ultimoSistema = -1;
  for (let i = 0; i < prompt.length; i++) {
    if ((prompt[i] as MensajeDePrompt | null)?.role === 'system') ultimoSistema = i;
  }
  if (ultimoSistema === -1) return params;
  const mensajes = prompt.map((mensaje, i) => {
    if (i !== ultimoSistema) return mensaje as unknown;
    const original = mensaje as MensajeDePrompt;
    return {
      ...original,
      providerOptions: {
        ...(original.providerOptions ?? {}),
        anthropic: {
          ...(original.providerOptions?.['anthropic'] ?? {}),
          cacheControl: { type: 'ephemeral' },
        },
      },
    };
  });
  return { ...params, prompt: mensajes };
}

/**
 * FIX B: normaliza los elementId pelones de las partes generadas (texto directo y tool-calls, que es
 * donde viaja la salida estructurada con Anthropic). Devuelve null si no habia nada que normalizar.
 * Misma regla conservadora del rescate: cada id se resuelve contra los ids rotulados del prompt y
 * solo se normaliza si aparece en EXACTAMENTE un frame; con un id ambiguo o ausente no se toca nada
 * y la validacion decide.
 */
export function normalizarSalidaGenerada(
  resultado: ResultadoDeGeneracion,
  prompt: unknown,
  logger: Logger,
): ResultadoDeGeneracion | null {
  const contenido = resultado.content;
  if (!Array.isArray(contenido)) return null;
  const frames = framesPorId(prompt);
  const resueltos: string[] = [];
  const ambiguos: string[] = [];
  for (const parte of contenido) {
    const { text, input } = (parte ?? {}) as ParteGenerada;
    for (const texto of [text, input]) {
      if (typeof texto !== 'string') continue;
      const { normalizados, sinResolver } = normalizarIdsPelonesEnTexto(texto, frames);
      resueltos.push(...normalizados);
      ambiguos.push(...sinResolver);
    }
  }
  if (resueltos.length === 0 && ambiguos.length === 0) return null;
  if (ambiguos.length > 0) {
    logger.warn(
      'tarea web: el modelo devolvio un elementId sin prefijo que no aparece en exactamente un frame del arbol; no se normaliza',
      { elementIds: ambiguos },
    );
    return null;
  }
  const nuevoContenido = contenido.map((parte) => {
    const { text, input } = (parte ?? {}) as ParteGenerada;
    if (typeof text === 'string' && normalizarIdsPelonesEnTexto(text, frames).normalizados.length > 0) {
      return { ...(parte as object), text: normalizarIdsPelonesEnTexto(text, frames).texto };
    }
    if (typeof input === 'string' && normalizarIdsPelonesEnTexto(input, frames).normalizados.length > 0) {
      return { ...(parte as object), input: normalizarIdsPelonesEnTexto(input, frames).texto };
    }
    return parte as unknown;
  });
  // Solo numeros del arbol de accesibilidad: la normalizacion no arrastra contenido de la pagina.
  logger.warn(
    'tarea web: el modelo devolvio elementId sin prefijo; el id aparece en un solo frame del arbol y se normalizo a <frame>-<id>',
    { elementIds: resueltos },
  );
  return { ...resultado, content: nuevoContenido };
}

/**
 * FIX B (jul 2026): CORTA EL REINTENTO INTERNO DEL MOTOR ante un fallo de acceso al modelo.
 *
 * El AI SDK reintenta CADA llamada hasta 2 veces (`maxRetries` default 2, backoff 2s/4s y respeto del
 * `retry-after` hasta 60 s) siempre que el error sea un APICallError con `isRetryable === true`.
 * Stagehand llama a generateText/generateObject SIN pasar `maxRetries`, y su superficie publica no lo
 * expone: no hay opcion que acotar. Este middleware es el unico punto de paso obligatorio de TODA
 * llamada del motor, y corre DENTRO del bucle de reintento, asi que es donde si se puede intervenir.
 *
 * Al detectar el fallo se relanza un Error PLANO (no un APICallError): el bucle de reintento del AI
 * SDK solo reintenta APICallError retryables, asi que con esto propaga en el acto en vez de dormir el
 * backoff. El mensaje lleva la MARCA `[MODELO_SIN_ACCESO:clase]` porque `agent.execute` de Stagehand
 * atrapa el error y lo devuelve como texto: la marca es lo unico que sobrevive ese canal.
 *
 * NUNCA cambia el desenlace de un error que no se pueda clasificar con certeza: ese se relanza tal
 * cual y el reintento del motor sigue exactamente como hoy.
 *
 * ALCANCE: solo `wrapGenerate`, que es por donde pasan TODAS las llamadas que este worker hace al
 * modelo (el bucle del agente corre por generateText y act/observe/extract por generateObject; la
 * variante en streaming de Stagehand, `agent.stream`, no se usa desde aqui). Si algun dia se usara,
 * agregar `wrapStream` con el mismo cuerpo.
 */
function conMarcaDeFalloDeModelo(clase: ClaseDeFalloDeModelo, error: unknown): Error {
  const original = error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido';
  return new Error(`${marcaDeFalloDeModelo(clase)} ${original}`);
}

/**
 * El middleware que construirOpcionesStagehand cuelga de `model.middleware`. Nunca lanza por su
 * cuenta: cualquier duda deja pasar la llamada tal cual (es una red de seguridad, no un requisito).
 * La UNICA excepcion es el fallo de acceso al modelo, que se relanza marcado (ver arriba).
 */
export function crearMiddlewareDeModelo(logger: Logger): MiddlewareDeModelo {
  return {
    transformParams: async ({ params }) => {
      try {
        return conCacheEnElPrefijo(params);
      } catch {
        return params;
      }
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      let resultado: ResultadoDeGeneracion;
      try {
        resultado = await doGenerate();
      } catch (error) {
        const clase = clasificarFalloDeAccesoAlModelo(error);
        if (clase === null) throw error;
        // Sin el mensaje del proveedor en los campos del log: va dentro del error, que ya esta
        // sanitizado antes de llegar al last_error del job.
        logger.error(
          'tarea web: la llave del modelo no tiene saldo o no es valida; se corta la corrida sin reintentar',
          { clase },
        );
        throw conMarcaDeFalloDeModelo(clase, error);
      }
      try {
        return normalizarSalidaGenerada(resultado, params.prompt, logger) ?? resultado;
      } catch {
        return resultado;
      }
    },
  };
}

/** Exportado para los tests: el patron que el esquema del motor acepta. */
export { PATRON_ID_VALIDO };
