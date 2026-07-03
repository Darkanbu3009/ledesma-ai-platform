import type {
  AgentEvent,
  ContentBlock,
  NormalizedMessage,
  NormalizedRequest,
  ProviderCredentials,
  ProviderId,
  ProviderStreamEvent,
  StopReason,
  TokenUsage,
} from '@ledesma-platform/shared';
import { runModel, type ModelCallInput } from '../providers/index.js';
import type { ToolCall, ToolExecutor } from './tool-executor.js';
import { validateAgentRun, DEFAULT_RUN_MAX_TOKENS } from './limits.js';

export const DEFAULT_MAX_ITERATIONS = 10;

export interface AgentRunInput {
  providerId: ProviderId;
  credentials: ProviderCredentials;
  request: NormalizedRequest;
  signal?: AbortSignal;
  /** Cota de iteraciones del loop (llamadas al modelo). Por defecto DEFAULT_MAX_ITERATIONS. */
  maxIterations?: number;
  /**
   * Cap de tokens ACUMULADOS (input + output) a traves de las iteraciones del run. Al alcanzarlo, el
   * loop corta limpio con stop reason 'token_cap'. Por defecto DEFAULT_RUN_MAX_TOKENS.
   */
  maxTokens?: number;
  /**
   * Timeout global de pared del run, en milisegundos. NO lo consume runAgent (el loop): lo aplica la
   * capa de transporte (sse-runner) sobre el AbortController de la peticion completa. Vive aca para
   * co-ubicar los tres limites del run (iteraciones, tokens, tiempo) en un solo contrato de entrada.
   */
  runTimeoutMs?: number;
}

export interface AgentDeps {
  /** Ejecuta una tool solicitada por el modelo (lo provee el registro de P2.2). */
  executeTool: ToolExecutor;
  /** Capa de modelo. Inyectable para tests; por defecto la real (P1.5). */
  runModel?: (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent>;
}

/**
 * Loop agentico generico. Opera contra la capa de modelo (cualquier proveedor) y un executor de
 * tools. Re-emite el texto y las tool_use del modelo, ejecuta las tools, reinyecta sus resultados
 * y repite hasta que el modelo termina o se alcanza la cota de iteraciones. Emite un unico stop
 * final con el uso acumulado. Los errores del modelo o de las tools se PROPAGAN como excepcion.
 * No persiste ni loguea credenciales: solo las pasa por parametro a la capa de modelo.
 */
export async function* runAgent(input: AgentRunInput, deps: AgentDeps): AsyncIterable<AgentEvent> {
  validateAgentRun({
    request: input.request,
    maxIterations: input.maxIterations,
    maxTokens: input.maxTokens,
  });

  const runModelFn = deps.runModel ?? runModel;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxTokens = input.maxTokens ?? DEFAULT_RUN_MAX_TOKENS;

  const messages: NormalizedMessage[] = [...input.request.messages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  // Acumulados de prompt caching a traves de las iteraciones. Se suman igual que input/output y solo se
  // adjuntan a la usage final cuando son > 0, para no alterar la forma del conteo cuando no hubo caching.
  let totalCacheWriteTokens = 0;
  let totalCacheReadTokens = 0;

  const accumulatedUsage = (): TokenUsage => ({
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    ...(totalCacheWriteTokens > 0 ? { cacheWriteTokens: totalCacheWriteTokens } : {}),
    ...(totalCacheReadTokens > 0 ? { cacheReadTokens: totalCacheReadTokens } : {}),
  });

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const turnRequest: NormalizedRequest = { ...input.request, messages };
    const stream = runModelFn({
      providerId: input.providerId,
      credentials: input.credentials,
      request: turnRequest,
      signal: input.signal,
    });

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    let stopReason: StopReason = 'end_turn';

    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          textParts.push(event.text);
          yield { type: 'text_delta', text: event.text };
          break;
        }
        case 'tool_use': {
          const call: ToolCall = { id: event.id, name: event.name, input: event.input };
          toolCalls.push(call);
          yield { type: 'tool_use', id: call.id, name: call.name, input: call.input };
          break;
        }
        case 'stop': {
          stopReason = event.reason;
          if (event.usage) {
            totalInputTokens += event.usage.inputTokens;
            totalOutputTokens += event.usage.outputTokens;
            totalCacheWriteTokens += event.usage.cacheWriteTokens ?? 0;
            totalCacheReadTokens += event.usage.cacheReadTokens ?? 0;
          }
          break;
        }
        default:
          break;
      }
    }

    const usage: TokenUsage = accumulatedUsage();

    if (stopReason !== 'tool_use' || toolCalls.length === 0) {
      yield { type: 'stop', reason: stopReason, usage };
      return;
    }

    // Cap de tokens del run: se evalua ENTRE iteraciones, con el uso acumulado de los turnos ya
    // recibidos (no a media respuesta). Si el modelo todavia quiere tools pero ya superamos el cap,
    // cortamos limpio sin ejecutar la ronda excedente, igual que max_iterations.
    if (totalInputTokens + totalOutputTokens >= maxTokens) {
      yield { type: 'stop', reason: 'token_cap', usage };
      return;
    }

    if (iteration === maxIterations - 1) {
      // Se alcanzo la cota y el modelo aun quiere tools: parar sin ejecutar la ronda excedente.
      yield { type: 'stop', reason: 'max_iterations', usage };
      return;
    }

    const assistantContent: ContentBlock[] = [];
    const joinedText = textParts.join('');
    if (joinedText !== '') {
      assistantContent.push({ type: 'text', text: joinedText });
    }
    for (const call of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    const toolResultBlocks: ContentBlock[] = [];
    for (const call of toolCalls) {
      const result = await deps.executeTool(call, input.signal);
      yield {
        type: 'tool_result',
        toolUseId: call.id,
        content: result.content,
        isError: result.isError,
      };
      toolResultBlocks.push({
        type: 'tool_result',
        toolUseId: call.id,
        content: result.content,
        isError: result.isError,
      });
    }
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Salvaguarda (cubre maxIterations <= 0): si el for no emitio stop, cerrar por cota.
  yield {
    type: 'stop',
    reason: 'max_iterations',
    usage: accumulatedUsage(),
  };
}
