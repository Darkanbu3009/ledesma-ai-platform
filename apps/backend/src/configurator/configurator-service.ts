/**
 * CEREBRO DEL AGENTE CONFIGURADOR. Servicio conversacional, sin UI, que entrevista al usuario en
 * lenguaje natural sobre el agente que quiere y, en CADA turno, devuelve:
 *  - un mensaje conversacional (reply) para el usuario, y
 *  - un AgentSpec PARCIAL en construccion (lo capturado hasta ahora) o COMPLETO cuando ya tiene
 *    todo, validado con validateAgentSpec contra el catalogo de tools resuelto.
 *
 * Corre sobre el modelo de PLATAFORMA (NO BYOK): es una funcion de la plataforma costeada por
 * nosotros, no por la key del cliente. Es ADITIVO: reusa el contrato AgentSpec, el validador y el
 * catalogo existentes; no toca el runtime de ejecucion ni la creacion real del agente (eso es 3.5).
 *
 * El cerebro NO crea el agente: solo conversa, construye el spec y lo valida.
 */

import type {
  AgentSpec,
  ModelConfig,
  NormalizedMessage,
  NormalizedRequest,
  ProviderId,
  ProviderStreamEvent,
  ResolvedToolCatalogEntry,
  WebhookToolCapability,
} from '@ledesma-platform/shared';
import { runModel, type ModelCallInput } from '../providers/index.js';
import { validateAgentSpec } from '../agents/agent-spec.js';
import { AppError } from '../errors/app-error.js';
import type { Env } from '../config/env.js';

/** Mensaje del historial de conversacion (viaja en el request; el servidor es stateless). */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** AgentSpec en construccion: cualquier subconjunto de campos del contrato real. */
export type AgentSpecDraft = Partial<AgentSpec>;

/** Resultado de validar el spec contra el catalogo (forma compacta del validador real). */
export type ConfiguratorValidation = { ok: true } | { ok: false; errors: string[] };

/** Cota de tokens de salida del turno del Configurador (reply + spec JSON; nunca es gigante). */
export const CONFIGURATOR_MAX_OUTPUT_TOKENS = 4096;

/** Mensaje de respaldo cuando la salida del modelo no se pudo interpretar (estado manejable). */
const MODEL_ERROR_REPLY =
  'Tuve un problema para procesar tu pedido. ¿Podrias reformularlo o intentarlo de nuevo?';

/**
 * Configuracion del modelo de PLATAFORMA con el que corre el Configurador. apiKey es la key PROPIA
 * de la plataforma (NO la del cliente). Hoy el unico proveedor de plataforma es Anthropic.
 */
export interface PlatformModelConfig {
  apiKey: string;
  model: string;
  providerId: ProviderId;
  maxTokens: number;
}

/**
 * Resuelve la config del modelo de plataforma desde el env. Si la key de plataforma no esta
 * configurada, lanza un AppError CLARO (503) en vez de un 500 opaco: la peticion es valida pero la
 * feature no esta disponible. Mismo patron de degradacion opcional que las tools nativas.
 */
export function getPlatformModelConfig(config: Env): PlatformModelConfig {
  const apiKey = config.PLATFORM_ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      503,
      'El modelo de plataforma del Configurador no esta configurado. ' +
        'Falta la variable de entorno PLATFORM_ANTHROPIC_API_KEY.',
    );
  }
  return {
    apiKey,
    model: config.PLATFORM_MODEL,
    providerId: 'anthropic',
    maxTokens: CONFIGURATOR_MAX_OUTPUT_TOKENS,
  };
}

/** Entrada de un turno del Configurador. El historial viaja en el request (servidor stateless). */
export interface ConfiguratorTurnInput {
  messages: ConversationMessage[];
  /** Catalogo de tools resuelto (resolveToolCatalog): lo que el cerebro puede ofrecer y validar. */
  catalog: ResolvedToolCatalogEntry[];
  /** Capacidad de webhook tools custom (para guiar al modelo y describir el contrato). */
  webhookCapability: WebhookToolCapability;
  /** Cancelacion (desconexion del cliente, timeout). */
  signal?: AbortSignal;
}

/** Dependencias inyectables del cerebro (para tests: se mockea la llamada al modelo). */
export interface ConfiguratorDeps {
  platform: PlatformModelConfig;
  /** Capa de modelo. Inyectable para tests; por defecto la real (providers/run-model). */
  runModel?: (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent>;
}

/**
 * Salida de un turno del Configurador. Siempre trae reply, spec y validation para que la capa
 * superior (y la futura UI) sepan que decir y si el spec esta listo para crear. modelError se
 * setea SOLO cuando la salida del modelo no se pudo interpretar: distingue "spec aun incompleto"
 * de "fallo del modelo", sin crashear.
 */
export interface ConfiguratorTurnResult {
  reply: string;
  /** Spec parcial/completo capturado, o null si la salida del modelo no fue interpretable. */
  spec: AgentSpecDraft | null;
  /** El propio modelo cree que ya capturo todo. Señal: validation.ok es la compuerta real. */
  complete: boolean;
  /** Resultado de validateAgentSpec sobre spec contra el catalogo resuelto. */
  validation: ConfiguratorValidation;
  /** Detalle tecnico cuando la salida del modelo fue invalida (JSON malformado, error de red). */
  modelError?: string;
}

/**
 * Ejecuta UN turno del Configurador: arma la peticion al modelo de plataforma (system prompt del
 * Configurador con el catalogo inyectado + el historial), parsea de forma SEGURA la salida JSON,
 * valida el spec resultante con validateAgentSpec y devuelve el shape estable. Nunca crashea por
 * salida malformada del modelo ni por fallos del proveedor: devuelve un estado de error manejable.
 */
export async function runConfiguratorTurn(
  input: ConfiguratorTurnInput,
  deps: ConfiguratorDeps,
): Promise<ConfiguratorTurnResult> {
  const runModelFn = deps.runModel ?? runModel;
  const modelConfig: ModelConfig = { model: deps.platform.model, maxTokens: deps.platform.maxTokens };
  const request: NormalizedRequest = {
    system: buildConfiguratorSystemPrompt(input.catalog, input.webhookCapability),
    messages: toNormalizedMessages(input.messages),
    modelConfig,
  };

  let rawText: string;
  try {
    rawText = await collectText(
      runModelFn({
        providerId: deps.platform.providerId,
        credentials: { apiKey: deps.platform.apiKey },
        request,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
  } catch (error) {
    // El proveedor fallo (red, auth, rate limit). Estado manejable: el endpoint no devuelve 500.
    return modelErrorResult(
      `No se pudo contactar el modelo de plataforma: ${errorMessage(error)}`,
    );
  }

  const parsed = parseModelOutput(rawText);
  if (!parsed.ok) {
    return modelErrorResult(parsed.error);
  }

  // El validador real es defensivo con specs parciales/malformados: sobre un spec incompleto
  // devuelve ok:false con los campos faltantes, lo que tambien es util para la UI.
  const result = validateAgentSpec(parsed.value.spec as unknown as AgentSpec, input.catalog);
  const validation: ConfiguratorValidation = result.ok
    ? { ok: true }
    : { ok: false, errors: result.errors };

  return {
    reply: parsed.value.reply,
    spec: parsed.value.spec as unknown as AgentSpecDraft,
    complete: parsed.value.complete,
    validation,
  };
}

function modelErrorResult(error: string): ConfiguratorTurnResult {
  return {
    reply: MODEL_ERROR_REPLY,
    spec: null,
    complete: false,
    validation: {
      ok: false,
      errors: ['No se pudo construir un AgentSpec valido a partir de la respuesta del modelo'],
    },
    modelError: error,
  };
}

function toNormalizedMessages(messages: ConversationMessage[]): NormalizedMessage[] {
  return messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] }));
}

/** Acumula el texto del stream del proveedor (streaming-only) en una sola cadena. */
async function collectText(stream: AsyncIterable<ProviderStreamEvent>): Promise<string> {
  let text = '';
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      text += event.text;
    }
  }
  return text;
}

interface ParsedModelOutput {
  reply: string;
  spec: Record<string, unknown>;
  complete: boolean;
}

/**
 * Parsea la salida del modelo de forma SEGURA hacia { reply, spec, complete }. El modelo debe
 * devolver un unico objeto JSON; si trae fences de markdown o prosa alrededor, se intenta extraer
 * el objeto. Cualquier salida no interpretable devuelve ok:false con un detalle (no se lanza).
 */
function parseModelOutput(
  text: string,
): { ok: true; value: ParsedModelOutput } | { ok: false; error: string } {
  const parsed = safeParseJsonObject(text);
  if (!parsed.ok) {
    return parsed;
  }
  const obj = parsed.value;

  if (typeof obj.reply !== 'string') {
    return { ok: false, error: 'La salida del modelo no incluye un campo "reply" de texto' };
  }

  // spec puede faltar al inicio de la conversacion: se trata como draft vacio (aun no se capturo
  // nada). Si viene pero no es objeto, es una violacion del contrato -> error manejable.
  let spec: Record<string, unknown>;
  const specRaw = obj.spec;
  if (specRaw === undefined || specRaw === null) {
    spec = {};
  } else if (isPlainObject(specRaw)) {
    spec = specRaw;
  } else {
    return { ok: false, error: 'El campo "spec" de la salida del modelo no es un objeto' };
  }

  return { ok: true, value: { reply: obj.reply, spec, complete: obj.complete === true } };
}

/**
 * JSON.parse seguro a un objeto plano. Intenta primero el texto completo (caso feliz: el modelo
 * solo devolvio JSON) y, si falla, intenta extraer el primer objeto { ... } embebido (fences de
 * markdown, prosa alrededor). Nunca lanza: devuelve un resultado discriminado.
 */
function safeParseJsonObject(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, error: 'El modelo devolvio una respuesta vacia' };
  }

  const candidates = [trimmed];
  const extracted = extractJsonObject(trimmed);
  if (extracted !== null && extracted !== trimmed) {
    candidates.push(extracted);
  }

  let lastError = 'La salida del modelo no es un objeto JSON valido';
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isPlainObject(value)) {
        return { ok: true, value };
      }
      lastError = 'La salida del modelo no es un objeto JSON';
    } catch (error) {
      lastError = `La salida del modelo no es JSON valido: ${errorMessage(error)}`;
    }
  }
  return { ok: false, error: lastError };
}

/** Recorta desde el primer "{" hasta el ultimo "}" (heuristica para JSON envuelto en prosa). */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido';
}

/**
 * Construye el system prompt del Configurador con el catalogo de tools INYECTADO. Redaccion base en
 * espanol (afinable): instruye al modelo a entrevistar, a ofrecer SOLO tools del catalogo o webhook
 * tools custom, y a devolver SIEMPRE el contrato JSON exacto { reply, spec, complete }.
 */
export function buildConfiguratorSystemPrompt(
  catalog: ResolvedToolCatalogEntry[],
  webhookCapability: WebhookToolCapability,
): string {
  const available = catalog.filter((entry) => entry.available);
  const toolsBlock =
    available.length === 0
      ? 'No hay tools nativas disponibles en este momento. NO propongas ninguna tool nativa.'
      : available
          .map(
            (entry) =>
              `- name: "${entry.name}" | ${entry.title}: ${entry.description} ` +
              `(cuando usarla: ${entry.whenToUse})`,
          )
          .join('\n');
  const webhookRules = webhookCapability.requiredFields
    .map((field) => `    - ${field.field}: ${field.rule}`)
    .join('\n');

  return [
    'Sos el Configurador: un asistente de la plataforma que entrevista al usuario, en espanol y en',
    'lenguaje natural, para disenar un agente de IA a su medida. Tu unico trabajo es CONVERSAR para',
    'capturar lo que el agente debe ser y, en cada turno, ir construyendo un AgentSpec estructurado.',
    'NO creas el agente; solo conversas y armas la especificacion.',
    '',
    'QUE TENES QUE CAPTURAR a lo largo de la conversacion:',
    '- Proposito: para que sirve el agente. Mapealo a "name" (corto y claro) y "description".',
    '- Comportamiento: como debe actuar, su tono, sus limites y sus instrucciones. Mapealo a',
    '  "systemPrompt" (las instrucciones del agente que se va a crear, NO estas instrucciones tuyas).',
    '- Tools: que herramientas necesita. Proponelas SOLO si hacen falta para el proposito.',
    '',
    'TOOLS NATIVAS DISPONIBLES (referencialas por su name EXACTO; no inventes otras):',
    toolsBlock,
    '',
    'TOOLS WEBHOOK CUSTOM: si el usuario necesita una capacidad que no existe entre las nativas y',
    'tiene un endpoint HTTPS propio que la implemente, podes definir una webhook tool cumpliendo:',
    webhookRules,
    '',
    'REGLAS DE TOOLS:',
    '- Una tool nativa se REFERENCIA: { "kind": "native", "name": "<name del catalogo>" }.',
    '- Una webhook tool se DEFINE: { "kind": "webhook", "name", "description", "inputSchema", "url" }.',
    '- NUNCA referencies una tool nativa que no este en la lista de arriba.',
    '- No incluyas tools si el agente no las necesita; tools es opcional.',
    '',
    'PROVEEDOR Y MODELO: el AgentSpec requiere "providerId" y "model". Salvo que el usuario pida algo',
    'distinto, usa por defecto providerId "anthropic" y model "claude-sonnet-4-6". providerId valido:',
    '"anthropic", "openai" u "openai-compatible" (este ultimo exige ademas "baseUrl").',
    '',
    'FORMATO DE SALIDA (OBLIGATORIO): respondes SIEMPRE con UN UNICO objeto JSON y NADA MAS (sin',
    'texto antes o despues, sin markdown, sin fences). El objeto tiene exactamente estas claves:',
    '  {',
    '    "reply": "<tu mensaje conversacional para el usuario, en espanol>",',
    '    "spec": { <AgentSpec parcial con lo capturado hasta ahora> },',
    '    "complete": <true SOLO cuando ya tenes lo minimo (name, providerId, model) y el usuario',
    '                 confirmo que esta listo; en cualquier otro caso false>',
    '  }',
    '',
    'El objeto "spec" usa SOLO estas claves del contrato AgentSpec (omite las que aun no capturaste):',
    '  name (string, requerido), description (string), systemPrompt (string), providerId (string,',
    '  requerido), model (string, requerido), maxTokens (entero), temperature (0..2), baseUrl',
    '  (string, solo openai-compatible), tools (arreglo de tools como se describio arriba).',
    'No agregues claves desconocidas al spec: serian rechazadas por el validador.',
    '',
    'ESTILO: una pregunta o paso a la vez, claro y amable. Avanza el spec en cada turno con lo que',
    'el usuario ya te dijo, aunque todavia falte informacion (spec parcial es esperado y correcto).',
  ].join('\n');
}
