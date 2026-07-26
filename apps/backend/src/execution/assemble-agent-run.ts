import type { NormalizedMessage, NormalizedRequest, ProviderCredentials } from '@ledesma-platform/shared';
import { agenteTieneToolDeSitios, webhookToolsDe, type AgentConfig } from '../agents/types.js';
import type { AgentRunInput, ToolExecutor } from '../agent/index.js';
import { createDemoRegistry } from '../tools/demo-registry.js';
import { createWebhookExecutor, storedToolsToDefinitions } from '../tools/webhook-tools.js';
import { createNativeExecutor, nativeToolsToDefinitions, NATIVE_TOOL_NAMES } from '../tools/native-tools.js';
import {
  BLOQUE_SEPARACION_INSTRUCCION_CONTENIDO,
  createSitioToolsExecutor,
  sitioToolsToDefinitions,
  textoLiteralDelUsuario,
  SITIO_TOOL_NAMES,
  type SitioToolsContext,
  type SitioToolsDeps,
} from '../tools/sitio-tools.js';

/**
 * Credencial YA RESUELTA que la capa recibe. La RESOLUCION queda AFUERA a proposito: cada llamador la
 * resuelve como sabe (el route HTTP la saca de un header / token de sesion / boveda con sus tres ramas;
 * el worker autonomo la sacara solo de la boveda por owner+credential). La capa solo necesita la key
 * en claro y, opcionalmente, el baseUrl de una credencial GUARDADA.
 */
export interface ResolvedCredential {
  /** API key en claro. NUNCA se loguea ni se persiste; solo se pasa a la capa de modelo. */
  apiKey: string;
  /**
   * baseUrl de una credencial GUARDADA (boveda): para openai-compatible MANDA sobre agent.baseUrl
   * (la credencial define el endpoint atado a su key). undefined/null cuando la key viene de un
   * header / token de sesion -> cae al baseUrl del agente.
   */
  baseUrl?: string | null;
}

/** Config del worker nativo de plataforma (mismo origen que WEB_WORKER_URL / WEB_WORKER_SECRET). */
export interface NativeToolsConfig {
  workerUrl?: string;
  workerSecret?: string;
}

/** Cortes del motor de ejecucion (mismo origen que RUN_MAX_TOKENS / RUN_TIMEOUT_SECONDS). */
export interface RunLimitsConfig {
  /** Cap de tokens acumulados (input + output) del run. */
  maxTokens: number;
  /** Deadline de pared del run, en milisegundos. */
  runTimeoutMs: number;
}

export interface AssembleAgentRunParams {
  /** Config del agente ya cargada de la base (autoritativa: providerId/model/baseUrl/tools/...). */
  agent: AgentConfig;
  /** Credencial ya resuelta por el llamador. */
  credential: ResolvedCredential;
  /** Mensajes ya normalizados (el route les incorpora adjuntos; el worker los arma de su payload). */
  messages: NormalizedMessage[];
  nativeTools: NativeToolsConfig;
  limits: RunLimitsConfig;
  /** Cota de iteraciones del loop. Si se omite, runAgent usa su default. */
  maxIterations?: number;
  /** Sumidero de advertencias (colision de tools, fallos de webhook). Por defecto no-op. */
  warn?: (message: string) => void;
  /**
   * TOOLS DE SITIOS CONECTADOS (7.1d), OPCIONALES: se inyectan SOLO cuando el llamador puede
   * establecer el contexto de tenancy completo (owner + credencial de la BOVEDA con la que el
   * worker ejecutara la tarea) Y el agente tiene la herramienta de sitios ACTIVADA en su config
   * (entrada kind:'sitios_conectados' en agent.tools, la que persiste la UI de Herramientas).
   * El route las pasa unicamente en el camino x-credential-id; los
   * demas caminos (key al momento / token de sesion / worker) quedan INTACTOS sin este parametro.
   * Cuando esta presente, ademas se appendea al system prompt el bloque de separacion
   * instruccion-vs-contenido (unica alteracion permitida de los flujos existentes).
   */
  sitios?: {
    context: SitioToolsContext;
    deps: SitioToolsDeps;
  };
}

export interface AssembledAgentRun {
  /** Todo lo que runAgent necesita, listo para streamAgentRun (HTTP) o para invocar sin HTTP. */
  input: AgentRunInput;
  /** Ejecutor de tools con dispatch por nombre (nativas con precedencia, luego cliente/demo). */
  executeTool: ToolExecutor;
}

/**
 * Ensamblado REUTILIZABLE de una corrida de agente, SIN dependencia de HTTP. Dado un agente cargado,
 * una credencial ya resuelta y los mensajes normalizados, construye: (1) el executeTool (tools nativas
 * de plataforma + tools de cliente por webhook + registro demo, con dedupe de precedencia nativa) y
 * (2) el NormalizedRequest desde la config del agente. Devuelve el AgentRunInput + el executeTool listos
 * para runAgent.
 *
 * Pensada para DOS llamadores: el route handler /v1/run/:agentId (que ya resolvio la credencial de uno
 * de sus tres orígenes y la transporta por SSE) y el worker autonomo (PR 5.2, que resuelve la credencial
 * de la boveda y aplica su propio deadline). Por eso la resolucion de credencial queda afuera y la capa
 * recibe la key ya en claro.
 */
export function assembleAgentRun(params: AssembleAgentRunParams): AssembledAgentRun {
  const { agent, credential, messages, nativeTools, limits, maxIterations } = params;
  const warn = params.warn ?? (() => {});

  // Tools nativas de plataforma: se inyectan cuando el worker esta configurado (ambas env vars). Las
  // tools de cliente se ejecutan por webhook (firmadas con el secreto del agente); si no hay ni nativas
  // ni stored tools, se mantiene el registro demo (mismo comportamiento que /v1/agent/run).
  const workerUrl = nativeTools.workerUrl;
  const workerSecret = nativeTools.workerSecret;
  const nativasActivas = Boolean(workerUrl && workerSecret);
  // El agente guarda webhooks del cliente Y (opcionalmente) la activacion de sitios en el MISMO
  // arreglo; al ejecutor firmado solo le llegan los webhooks.
  const webhookTools = webhookToolsDe(agent.tools);
  const hasStoredTools = webhookTools.length > 0;
  // Tools de SITIOS CONECTADOS (7.1d): activas solo si el llamador paso el contexto completo Y el
  // agente tiene la herramienta ACTIVADA en su config (la UI de Herramientas la persiste en tools).
  const sitiosActivos = params.sitios !== undefined && agenteTieneToolDeSitios(agent.tools);

  // Defs del modelo: nativas (si activas) + sitios (si activas) + las del cliente. El demo solo
  // cuando no hay ninguna de las tres.
  const nativeDefs = nativasActivas ? nativeToolsToDefinitions() : [];
  const sitioDefs = sitiosActivos ? sitioToolsToDefinitions() : [];
  const clientDefs = hasStoredTools ? storedToolsToDefinitions(webhookTools) : [];
  const registry = !nativasActivas && !hasStoredTools && !sitiosActivos ? createDemoRegistry() : null;

  // Dedupe defensivo: las de plataforma (nativas + sitios) tienen precedencia; el modelo nunca
  // recibe dos tools con el mismo name (el prefijo reservado platform_ ya lo evita al crear, esto
  // es cinturon y tirantes).
  const platformNames = new Set([...nativeDefs.map((d) => d.name), ...sitioDefs.map((d) => d.name)]);
  const clientDefsSinColision = clientDefs.filter((d) => {
    if (platformNames.has(d.name)) {
      warn(`tool de cliente '${d.name}' descartada por colision con una tool nativa de la plataforma`);
      return false;
    }
    return true;
  });
  const toolDefinitions = registry
    ? registry.toToolDefinitions()
    : [...nativeDefs, ...sitioDefs, ...clientDefsSinColision];

  // Ejecutor con dispatch por nombre: las de plataforma van primero (defensa anti-colision), el
  // resto al ejecutor de cliente (webhook o demo). El flujo de cliente queda intacto.
  const clientExec = hasStoredTools
    ? createWebhookExecutor(webhookTools, agent.webhookSecret, undefined, { warn })
    : registry
      ? registry.toExecutor()
      : null;
  const nativeExec =
    workerUrl && workerSecret
      ? createNativeExecutor(workerUrl, workerSecret, undefined, { warn })
      : null;
  // El TEXTO LITERAL del usuario se resuelve AQUI, de los mensajes ya normalizados del run, y viaja
  // en el contexto de la tool: el modelo no participa (ver textoLiteralDelUsuario y
  // TareaWebJobPayload.textoUsuario). Un contexto que ya lo traiga puesto por su llamador manda.
  const sitioExec = sitiosActivos && params.sitios
    ? createSitioToolsExecutor(
        {
          ...params.sitios.context,
          textoUsuario: params.sitios.context.textoUsuario ?? textoLiteralDelUsuario(messages),
        },
        params.sitios.deps,
      )
    : null;
  const executeTool: ToolExecutor = (call, abortSignal) => {
    if (nativeExec && NATIVE_TOOL_NAMES.has(call.name)) return nativeExec(call, abortSignal);
    if (sitioExec && SITIO_TOOL_NAMES.has(call.name)) return sitioExec(call, abortSignal);
    if (clientExec) return clientExec(call, abortSignal);
    return Promise.resolve({ content: `Tool desconocida: ${call.name}`, isError: true });
  };

  // System prompt: el del agente, y -- SOLO con las tools de sitios activas -- el bloque de
  // separacion instruccion-vs-contenido appendeado (7.1d). Sin sitios, byte a byte igual que antes.
  const system = sitiosActivos
    ? `${agent.systemPrompt ?? ''}${BLOQUE_SEPARACION_INSTRUCCION_CONTENIDO}`.trim()
    : agent.systemPrompt;

  const normalizedRequest: NormalizedRequest = {
    ...(system ? { system } : {}),
    messages,
    tools: toolDefinitions,
    modelConfig: {
      model: agent.model,
      maxTokens: agent.maxTokens,
      ...(agent.temperature !== null ? { temperature: agent.temperature } : {}),
    },
  };

  // baseUrl para openai-compatible: con credencial GUARDADA, el baseUrl de la credencial es el endpoint
  // atado a esa key y MANDA sobre el del agente. Si no trae baseUrl (o la key vino de header/sesion),
  // cae al del agente. Otros proveedores no usan baseUrl.
  const resolvedBaseUrl =
    agent.providerId === 'openai-compatible'
      ? (credential.baseUrl ?? agent.baseUrl ?? null)
      : null;
  const credentials: ProviderCredentials = {
    apiKey: credential.apiKey,
    ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
  };

  const input: AgentRunInput = {
    providerId: agent.providerId,
    credentials,
    request: normalizedRequest,
    maxTokens: limits.maxTokens,
    runTimeoutMs: limits.runTimeoutMs,
    ...(maxIterations !== undefined ? { maxIterations } : {}),
  };

  return { input, executeTool };
}
