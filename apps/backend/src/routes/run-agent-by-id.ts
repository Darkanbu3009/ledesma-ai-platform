import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NormalizedRequest, ProviderCredentials } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { createDemoRegistry } from '../tools/demo-registry.js';
import { AGENT_LIMITS } from '../agent/index.js';
import { streamAgentRun } from './sse-runner.js';

const RunByIdBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
      .min(1)
      .max(AGENT_LIMITS.maxMessages),
    maxIterations: z.number().int().positive().max(AGENT_LIMITS.maxIterationsCap).optional(),
  })
  .refine(
    (body) => body.messages.reduce((s, m) => s + m.content.length, 0) <= AGENT_LIMITS.maxTotalContentChars,
    { message: `Total content length exceeds ${AGENT_LIMITS.maxTotalContentChars} characters` },
  );

/**
 * Contrato de integracion para sistemas externos: la config del agente vive en la plataforma;
 * el integrador solo manda mensajes + su key BYOK. Devuelve el mismo SSE que /v1/agent/run.
 */
export function runAgentByIdRoutes(config: Env) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = new AgentRepository(getSql(config));

    // Plano de ejecucion: BYOK por header; el agentId (uuid) identifica la config. La proteccion
    // por token publicable por agente se agrega en una etapa de seguridad posterior.
    app.post('/v1/run/:agentId', { bodyLimit: AGENT_LIMITS.maxBodyBytes }, async (request, reply) => {
      const apiKey = request.headers['x-provider-key'];
      if (typeof apiKey !== 'string' || apiKey.trim() === '') {
        throw new AppError('VALIDATION_ERROR', 400, 'Missing x-provider-key header');
      }
      const { agentId } = request.params as { agentId: string };
      const agent = await repo.getById(agentId);
      if (!agent) {
        throw new AppError('NOT_FOUND', 404, 'Agent not found');
      }
      const parsed = RunByIdBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid request body', parsed.error.issues);
      }

      // La config guardada hoy tiene tools declarativas sin handlers: este endpoint usa el mismo
      // registro demo que /v1/agent/run hasta que llegue el cableado de tools reales.
      const registry = createDemoRegistry();
      const normalizedRequest: NormalizedRequest = {
        ...(agent.systemPrompt ? { system: agent.systemPrompt } : {}),
        messages: parsed.data.messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
        tools: registry.toToolDefinitions(),
        modelConfig: {
          model: agent.model,
          maxTokens: agent.maxTokens,
          ...(agent.temperature !== null ? { temperature: agent.temperature } : {}),
        },
      };
      const credentials: ProviderCredentials = {
        apiKey,
        ...(agent.providerId === 'openai-compatible' && agent.baseUrl ? { baseUrl: agent.baseUrl } : {}),
      };

      return streamAgentRun(
        request,
        reply,
        {
          providerId: agent.providerId,
          credentials,
          request: normalizedRequest,
          ...(parsed.data.maxIterations !== undefined ? { maxIterations: parsed.data.maxIterations } : {}),
        },
        registry.toExecutor(),
      );
    });
  };
}
