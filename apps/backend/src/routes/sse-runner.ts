import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentEvent } from '@ledesma-platform/shared';
import { runAgent, type AgentRunInput, type ToolExecutor } from '../agent/index.js';
import { ProviderError } from '../providers/index.js';

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
 */
export async function streamAgentRun(
  request: FastifyRequest,
  reply: FastifyReply,
  input: AgentRunInput,
  executeTool: ToolExecutor,
): Promise<FastifyReply> {
  // Cancelacion en desconexion del cliente.
  const controller = new AbortController();

  // Bandera para distinguir el cierre normal de la respuesta (que provocamos nosotros al terminar
  // de escribir el stream) de una desconexion real del cliente.
  let finished = false;

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
      controller.abort();
    }
  });

  const stream: AsyncIterable<AgentEvent> = runAgent(
    { ...input, signal: controller.signal },
    { executeTool },
  );

  try {
    for await (const event of stream) {
      if (controller.signal.aborted) {
        break;
      }
      sseWrite(reply, { data: event });
    }
    if (!controller.signal.aborted) {
      sseWrite(reply, { event: 'done', data: {} });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
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
  } finally {
    // Marcamos finished ANTES de end(): asi el evento close que dispara end() ve finished=true y
    // no aborta. El orden importa.
    finished = true;
    reply.raw.end();
  }

  return reply;
}
