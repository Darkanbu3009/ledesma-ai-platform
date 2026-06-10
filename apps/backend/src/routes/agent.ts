import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  AgentEvent,
  ModelConfig,
  NormalizedMessage,
  NormalizedRequest,
  ProviderCredentials,
  ProviderId,
} from '@ledesma-platform/shared';
import { AppError } from '../errors/app-error.js';
import { runAgent, AGENT_LIMITS } from '../agent/index.js';
import { ProviderError } from '../providers/index.js';
import { createDemoRegistry } from '../tools/demo-registry.js';

const RunBodySchema = z
  .object({
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    model: z.string().min(1),
    system: z.string().optional(),
    maxTokens: z.number().int().positive().max(32000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
      .min(1)
      .max(AGENT_LIMITS.maxMessages),
    maxIterations: z.number().int().positive().max(AGENT_LIMITS.maxIterationsCap).optional(),
  })
  .refine(
    (body) => {
      const total =
        (body.system?.length ?? 0) +
        body.messages.reduce((sum, message) => sum + message.content.length, 0);
      return total <= AGENT_LIMITS.maxTotalContentChars;
    },
    { message: `Total content length exceeds ${AGENT_LIMITS.maxTotalContentChars} characters` },
  );

type RunBody = z.infer<typeof RunBodySchema>;

function buildNormalizedRequest(body: RunBody, tools: NormalizedRequest['tools']): NormalizedRequest {
  const messages: NormalizedMessage[] = body.messages.map((message) => ({
    role: message.role,
    content: [{ type: 'text', text: message.content }],
  }));

  const modelConfig: ModelConfig = {
    model: body.model,
    maxTokens: body.maxTokens ?? 1024,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
  };

  return {
    ...(body.system !== undefined ? { system: body.system } : {}),
    messages,
    tools,
    modelConfig,
  };
}

function sseWrite(reply: FastifyReply, payload: { event?: string; data: unknown }): void {
  if (payload.event !== undefined) {
    reply.raw.write(`event: ${payload.event}\n`);
  }
  reply.raw.write(`data: ${JSON.stringify(payload.data)}\n\n`);
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/agent/run', { bodyLimit: AGENT_LIMITS.maxBodyBytes }, async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-provider-key'];
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new AppError('VALIDATION_ERROR', 400, 'Missing x-provider-key header');
    }
    const baseUrlHeader = request.headers['x-provider-base-url'];
    const baseUrl = typeof baseUrlHeader === 'string' && baseUrlHeader.trim() !== '' ? baseUrlHeader : undefined;

    const parsed = RunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 400, 'Invalid request body', parsed.error.issues);
    }
    const body = parsed.data;

    const credentials: ProviderCredentials = { apiKey, ...(baseUrl !== undefined ? { baseUrl } : {}) };
    const providerId: ProviderId = body.providerId;

    const registry = createDemoRegistry();
    const normalizedRequest = buildNormalizedRequest(body, registry.toToolDefinitions());

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
      {
        providerId,
        credentials,
        request: normalizedRequest,
        signal: controller.signal,
        ...(body.maxIterations !== undefined ? { maxIterations: body.maxIterations } : {}),
      },
      { executeTool: registry.toExecutor() },
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
  });
}
