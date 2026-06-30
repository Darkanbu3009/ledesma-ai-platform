import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  ModelConfig,
  NormalizedMessage,
  NormalizedRequest,
  ProviderCredentials,
  ProviderId,
} from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { AGENT_LIMITS } from '../agent/index.js';
import { createDemoRegistry } from '../tools/demo-registry.js';
import { streamAgentRun } from './sse-runner.js';

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

export function agentRoutes(config: Env) {
  return async function (app: FastifyInstance): Promise<void> {
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

      return streamAgentRun(
        request,
        reply,
        {
          providerId,
          credentials,
          request: normalizedRequest,
          maxTokens: config.RUN_MAX_TOKENS,
          runTimeoutMs: config.RUN_TIMEOUT_SECONDS * 1000,
          ...(body.maxIterations !== undefined ? { maxIterations: body.maxIterations } : {}),
        },
        registry.toExecutor(),
      );
    });
  };
}
