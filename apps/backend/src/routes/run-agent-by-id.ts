import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NormalizedRequest, ProviderCredentials } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { verifySessionToken } from '../auth/session-token.js';
import { getSql } from '../db/client.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { AgentRunRepository } from '../agents/run-repository.js';
import { createDemoRegistry } from '../tools/demo-registry.js';
import { createWebhookExecutor, storedToolsToDefinitions } from '../tools/webhook-tools.js';
import { createNativeExecutor, nativeToolsToDefinitions, NATIVE_TOOL_NAMES } from '../tools/native-tools.js';
import { AGENT_LIMITS, type ToolExecutor } from '../agent/index.js';
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
    const runRepo = new AgentRunRepository(getSql(config));

    // Plano de ejecucion: BYOK por header o token de sesion efimero; el agentId (uuid)
    // identifica la config.
    app.post('/v1/run/:agentId', { bodyLimit: AGENT_LIMITS.maxBodyBytes }, async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      // El token de sesion (emitido en /v1/session-tokens) trae la key cifrada y va atado a
      // este agentId; cualquier fallo (corrupto, expirado, de otro agente) responde 401 generico.
      const sessionToken = request.headers['x-session-token'];
      let apiKey: string;
      if (typeof sessionToken === 'string' && sessionToken !== '') {
        apiKey = verifySessionToken(sessionToken, agentId, config.SESSION_TOKEN_SECRET).providerKey;
      } else {
        const headerKey = request.headers['x-provider-key'];
        if (typeof headerKey !== 'string' || headerKey.trim() === '') {
          throw new AppError('VALIDATION_ERROR', 400, 'Missing x-provider-key header');
        }
        apiKey = headerKey;
      }
      const agent = await repo.getById(agentId);
      if (!agent) {
        throw new AppError('NOT_FOUND', 404, 'Agent not found');
      }
      const parsed = RunByIdBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid request body', parsed.error.issues);
      }

      // Tools nativas de plataforma: se inyectan en TODOS los agentes cuando el worker esta
      // configurado (ambas env vars). Las tools de cliente se ejecutan por webhook (firmadas con el
      // secreto del agente); si no hay ni nativas ni stored tools, se mantiene el registro demo
      // (mismo comportamiento que /v1/agent/run).
      const workerUrl = config.WEB_WORKER_URL;
      const workerSecret = config.WEB_WORKER_SECRET;
      const nativasActivas = Boolean(workerUrl && workerSecret);
      const hasStoredTools = agent.tools.length > 0;

      // Defs del modelo: nativas (si activas) + las del cliente. El demo solo cuando no hay ninguna.
      const nativeDefs = nativasActivas ? nativeToolsToDefinitions() : [];
      const clientDefs = hasStoredTools ? storedToolsToDefinitions(agent.tools) : [];
      const registry = !nativasActivas && !hasStoredTools ? createDemoRegistry() : null;

      // Dedupe defensivo: las nativas tienen precedencia; el modelo nunca recibe dos tools con el
      // mismo name (el prefijo reservado platform_ ya lo evita al crear, esto es cinturon y tirantes).
      const nativeNames = new Set(nativeDefs.map((d) => d.name));
      const clientDefsSinColision = clientDefs.filter((d) => {
        if (nativeNames.has(d.name)) {
          request.log.warn(`tool de cliente '${d.name}' descartada por colision con una tool nativa de la plataforma`);
          return false;
        }
        return true;
      });
      const toolDefinitions = registry
        ? registry.toToolDefinitions()
        : [...nativeDefs, ...clientDefsSinColision];

      // Ejecutor con dispatch por nombre: las nativas van primero (defensa anti-colision), el resto
      // al ejecutor de cliente (webhook o demo). El flujo de cliente queda intacto.
      const clientExec = hasStoredTools
        ? createWebhookExecutor(agent.tools, agent.webhookSecret, undefined, {
            warn: (message) => request.log.warn(message),
          })
        : registry
          ? registry.toExecutor()
          : null;
      const nativeExec =
        workerUrl && workerSecret
          ? createNativeExecutor(workerUrl, workerSecret, undefined, {
              warn: (message) => request.log.warn(message),
            })
          : null;
      const executeTool: ToolExecutor = (call, abortSignal) => {
        if (nativeExec && NATIVE_TOOL_NAMES.has(call.name)) return nativeExec(call, abortSignal);
        if (clientExec) return clientExec(call, abortSignal);
        return Promise.resolve({ content: `Tool desconocida: ${call.name}`, isError: true });
      };
      const normalizedRequest: NormalizedRequest = {
        ...(agent.systemPrompt ? { system: agent.systemPrompt } : {}),
        messages: parsed.data.messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
        tools: toolDefinitions,
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
        executeTool,
        // Registro fire-and-forget de la corrida (solo metadatos): la corrida del cliente JAMAS
        // falla por el registro; si el insert falla solo se deja un warn.
        (outcome) => {
          void runRepo
            .record({
              agentId: agent.id,
              ownerId: agent.ownerId,
              providerId: agent.providerId,
              model: agent.model,
              inputTokens: outcome.inputTokens,
              outputTokens: outcome.outputTokens,
              stopReason: outcome.stopReason,
              status: outcome.status,
              errorCode: outcome.errorCode,
              durationMs: outcome.durationMs,
            })
            .catch((error) => {
              request.log.warn(
                { err: { message: error instanceof Error ? error.message : 'unknown' } },
                'run record failed',
              );
            });
        },
      );
    });
  };
}
