import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentEvent } from '@ledesma-platform/shared';
import { runAgent, type AgentRunInput, type ToolExecutor, DEFAULT_RUN_TIMEOUT_SECONDS } from '../agent/index.js';
import { ProviderError } from '../providers/index.js';

/** Desenlace de una corrida: SOLO metadatos (tokens, status, duracion). Nunca contenido. */
export interface AgentRunOutcome {
  status: 'completed' | 'error' | 'aborted';
  inputTokens: number;
  outputTokens: number;
  /** Tokens escritos a la cache de prompt (Anthropic: cache_creation_input_tokens). 0 sin caching. */
  cacheWriteTokens: number;
  /** Tokens leidos de la cache de prompt (Anthropic: cache_read_input_tokens). 0 sin caching. */
  cacheReadTokens: number;
  stopReason: string | null;
  errorCode: string | null;
  durationMs: number;
}

function sseWrite(reply: FastifyReply, payload: { event?: string; data: unknown }): void {
  if (payload.event !== undefined) {
    reply.raw.write(`event: ${payload.event}\n`);
  }
  reply.raw.write(`data: ${JSON.stringify(payload.data)}\n\n`);
}

/**
 * Streaming SSE compartido del loop agentico. Toma control manual de la respuesta (hijack),
 * re-emite cada AgentEvent como SSE, cierra con un evento done y traduce ProviderError a un
 * evento error sin filtrar credenciales. Si el cliente se desconecta a mitad del stream, aborta
 * el run. Lo consumen /v1/agent/run y /v1/run/:agentId.
 *
 * Si se pasa onRunFinished, al cerrar reporta el desenlace de la corrida (solo metadatos) sin
 * afectar el flujo SSE: cualquier error del callback se traga.
 */
export async function streamAgentRun(
  request: FastifyRequest,
  reply: FastifyReply,
  input: AgentRunInput,
  executeTool: ToolExecutor,
  onRunFinished?: (outcome: AgentRunOutcome) => void,
): Promise<FastifyReply> {
  const startedAt = Date.now();

  // Cancelacion en desconexion del cliente.
  const controller = new AbortController();

  // Bandera para distinguir el cierre normal de la respuesta (que provocamos nosotros al terminar
  // de escribir el stream) de una desconexion real del cliente.
  let finished = false;
  // Distingue la DESCONEXION del cliente (socket ya muerto: no se debe escribir nada) de NUESTRO
  // aborto por timeout (socket vivo: cerramos limpio con stop 'timeout' + done). Ambos disparan el
  // mismo AbortController, por eso necesitamos esta bandera aparte para no escribir a un socket
  // cerrado si ambos ocurren casi a la vez.
  let clientGone = false;

  // Tomamos control manual del ciclo de respuesta: a partir de aca escribimos el SSE directamente
  // sobre reply.raw. hijack evita que Fastify intente serializar/enviar (y advierta) al cerrar.
  reply.hijack();
  // writeHead se salta el pipeline de Fastify, asi que arrastramos los headers que los plugins
  // (CORS, helmet) ya dejaron en reply: sin esto el navegador bloquea la lectura del stream.
  const existingHeaders: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) {
      existingHeaders[name] = value as string | string[];
    }
  }
  reply.raw.writeHead(200, {
    ...existingHeaders,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Solo abortamos si la respuesta se cierra ANTES de que terminemos de escribir, es decir cuando
  // el cliente corta la conexion con el stream todavia activo. El cierre que provocamos al llamar
  // reply.raw.end() no cancela porque para entonces finished ya es true.
  reply.raw.on('close', () => {
    if (!finished) {
      clientGone = true;
      controller.abort();
    }
  });

  // TIMEOUT GLOBAL del run (deadline de pared sobre la peticion completa). Al vencer, abortamos el
  // run reusando el MISMO AbortController que la desconexion del cliente, pero marcamos timedOut: eso
  // distingue nuestro corte por tiempo (cierre LIMPIO: stop 'timeout' + done) del cierre silencioso
  // de una desconexion real. El timer se limpia en el finally (clearTimeout), sin fugas.
  const runTimeoutMs = input.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_SECONDS * 1000;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, runTimeoutMs);

  const stream: AsyncIterable<AgentEvent> = runAgent(
    { ...input, signal: controller.signal },
    { executeTool },
  );

  // Metadatos del desenlace para onRunFinished. errorCode no nulo marca que entramos al catch.
  let inputTokens = 0;
  let outputTokens = 0;
  // Prompt caching: se reportan aparte porque cache_read (~0.1x) y cache_write (~1.25x) tienen precios
  // distintos del input pleno. 0 cuando el proveedor no cachea (usage sin estos campos).
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let stopReason: string | null = null;
  let errorCode: string | null = null;
  // Marca que el loop emitio su stop natural (runAgent emite uno solo, al final). Distingue el fin
  // por cuenta propia del corte por timeout/desconexion.
  let sawStop = false;

  // Cierre LIMPIO por timeout: un stop con razon clara + done, igual que cualquier corte controlado
  // (max_iterations, token_cap). No es un error: nunca emite el evento error. El uso reportado es el
  // acumulado visto hasta el corte (0 si el timeout llego antes del primer stop natural).
  const writeTimeoutClose = (): void => {
    stopReason = 'timeout';
    const stop: AgentEvent = { type: 'stop', reason: 'timeout', usage: { inputTokens, outputTokens } };
    sseWrite(reply, { data: stop });
    sseWrite(reply, { event: 'done', data: {} });
  };

  try {
    for await (const event of stream) {
      if (controller.signal.aborted) {
        break;
      }
      if (event.type === 'stop') {
        sawStop = true;
        stopReason = event.reason;
        inputTokens = event.usage.inputTokens;
        outputTokens = event.usage.outputTokens;
        cacheWriteTokens = event.usage.cacheWriteTokens ?? 0;
        cacheReadTokens = event.usage.cacheReadTokens ?? 0;
      }
      sseWrite(reply, { data: event });
    }
    if (clientGone) {
      // Desconexion del cliente: cierre silencioso, el socket ya no existe (no escribir nada).
    } else if (sawStop) {
      // El run termino por cuenta propia (stop natural ya escrito): cerramos con done normal.
      sseWrite(reply, { event: 'done', data: {} });
    } else if (timedOut) {
      // El loop corto al abortar por timeout sin lanzar: cierre limpio con razon 'timeout'.
      writeTimeoutClose();
    }
  } catch (error) {
    if (timedOut && !clientGone) {
      // El abort por timeout hizo que el provider/loop lanzara (p.ej. AbortError). NO es un error
      // real del run: cerramos limpio con la razon 'timeout', sin evento error ni errorCode.
      writeTimeoutClose();
    } else {
      errorCode = error instanceof ProviderError ? error.code : 'UNKNOWN';
      if (!clientGone && !timedOut) {
        if (error instanceof ProviderError) {
          sseWrite(reply, {
            event: 'error',
            data: {
              code: error.code,
              message: error.message,
              providerId: error.providerId,
              ...(error.status !== undefined ? { status: error.status } : {}),
            },
          });
        } else {
          sseWrite(reply, { event: 'error', data: { code: 'UNKNOWN', message: 'Internal error during agent run' } });
        }
      }
      request.log.error(
        { err: error instanceof Error ? { name: error.name, message: error.message } : 'unknown' },
        'agent run failed',
      );
    }
  } finally {
    // Marcamos finished ANTES de end(): asi el evento close que dispara end() ve finished=true y
    // no aborta. El orden importa. Limpiamos el timer del timeout aca para no dejar timers colgados
    // cuando el run termina (normal, error o desconexion) antes de vencer el deadline.
    finished = true;
    clearTimeout(timeoutTimer);
    if (onRunFinished) {
      try {
        onRunFinished({
          // 'aborted' queda solo para la desconexion real del cliente. Un timeout cierra LIMPIO (stop
          // 'timeout' + done), asi que cuenta como 'completed' con su stopReason, igual que
          // max_iterations/token_cap.
          status: clientGone
            ? 'aborted'
            : timedOut
              ? 'completed'
              : errorCode !== null
                ? 'error'
                : 'completed',
          inputTokens,
          outputTokens,
          cacheWriteTokens,
          cacheReadTokens,
          stopReason,
          errorCode,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // El reporte del desenlace es best-effort: jamas interrumpe el cierre del stream.
      }
    }
    reply.raw.end();
  }

  return reply;
}
