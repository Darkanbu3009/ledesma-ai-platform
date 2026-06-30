import type { NormalizedMessage, NormalizedRequest, ProviderCredentials } from '@ledesma-platform/shared';
import type { AgentConfig } from '../agents/types.js';
import type { AgentRunInput, ToolExecutor } from '../agent/index.js';
import { createDemoRegistry } from '../tools/demo-registry.js';
import { createWebhookExecutor, storedToolsToDefinitions } from '../tools/webhook-tools.js';
import { createNativeExecutor, nativeToolsToDefinitions, NATIVE_TOOL_NAMES } from '../tools/native-tools.js';

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
  const hasStoredTools = agent.tools.length > 0;

  // Defs del modelo: nativas (si activas) + las del cliente. El demo solo cuando no hay ninguna.
  const nativeDefs = nativasActivas ? nativeToolsToDefinitions() : [];
  const clientDefs = hasStoredTools ? storedToolsToDefinitions(agent.tools) : [];
  const registry = !nativasActivas && !hasStoredTools ? createDemoRegistry() : null;

  // Dedupe defensivo: las nativas tienen precedencia; el modelo nunca recibe dos tools con el mismo
  // name (el prefijo reservado platform_ ya lo evita al crear, esto es cinturon y tirantes).
  const nativeNames = new Set(nativeDefs.map((d) => d.name));
  const clientDefsSinColision = clientDefs.filter((d) => {
    if (nativeNames.has(d.name)) {
      warn(`tool de cliente '${d.name}' descartada por colision con una tool nativa de la plataforma`);
      return false;
    }
    return true;
  });
  const toolDefinitions = registry
    ? registry.toToolDefinitions()
    : [...nativeDefs, ...clientDefsSinColision];

  // Ejecutor con dispatch por nombre: las nativas van primero (defensa anti-colision), el resto al
  // ejecutor de cliente (webhook o demo). El flujo de cliente queda intacto.
  const clientExec = hasStoredTools
    ? createWebhookExecutor(agent.tools, agent.webhookSecret, undefined, { warn })
    : registry
      ? registry.toExecutor()
      : null;
  const nativeExec =
    workerUrl && workerSecret
      ? createNativeExecutor(workerUrl, workerSecret, undefined, { warn })
      : null;
  const executeTool: ToolExecutor = (call, abortSignal) => {
    if (nativeExec && NATIVE_TOOL_NAMES.has(call.name)) return nativeExec(call, abortSignal);
    if (clientExec) return clientExec(call, abortSignal);
    return Promise.resolve({ content: `Tool desconocida: ${call.name}`, isError: true });
  };

  const normalizedRequest: NormalizedRequest = {
    ...(agent.systemPrompt ? { system: agent.systemPrompt } : {}),
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
