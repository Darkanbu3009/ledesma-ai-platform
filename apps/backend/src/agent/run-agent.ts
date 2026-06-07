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
import { validateAgentRun } from './limits.js';

export const DEFAULT_MAX_ITERATIONS = 10;

export interface AgentRunInput {
  providerId: ProviderId;
  credentials: ProviderCredentials;
  request: NormalizedRequest;
  signal?: AbortSignal;
  /** Cota de iteraciones del loop (llamadas al modelo). Por defecto DEFAULT_MAX_ITERATIONS. */
  maxIterations?: number;
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
  validateAgentRun({ request: input.request, maxIterations: input.maxIterations });

  const runModelFn = deps.runModel ?? runModel;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const messages: NormalizedMessage[] = [...input.request.messages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

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
          }
          break;
        }
        default:
          break;
      }
    }

    const usage: TokenUsage = { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };

    if (stopReason !== 'tool_use' || toolCalls.length === 0) {
      yield { type: 'stop', reason: stopReason, usage };
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
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}
