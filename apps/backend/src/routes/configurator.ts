import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { resolveToolCatalog, WEBHOOK_TOOL_CAPABILITY } from '../tools/catalog.js';
import { AGENT_LIMITS } from '../agent/index.js';
import {
  runConfiguratorTurn,
  type ConfiguratorDeps,
} from '../configurator/configurator-service.js';

// Historial de conversacion + credenciales BYOK por request. content no vacio; role user/assistant.
// El servidor es stateless: el historial completo viaja en cada peticion. La key NO va en el body
// (viaja por el header x-provider-key, igual que /v1/run/:agentId); aqui llegan el proveedor, el
// modelo y, solo para openai-compatible, el baseUrl. El enum de providerId espeja AgentInputSchema.
const ConfiguratorBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
      .min(1)
      .max(AGENT_LIMITS.maxMessages),
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    model: z.string().min(1).max(120),
    baseUrl: z.string().url().optional(),
  })
  .refine(
    (body) => body.messages.reduce((sum, m) => sum + m.content.length, 0) <= AGENT_LIMITS.maxTotalContentChars,
    { message: `El contenido total supera ${AGENT_LIMITS.maxTotalContentChars} caracteres` },
  )
  .refine((body) => body.providerId !== 'openai-compatible' || body.baseUrl !== undefined, {
    message: 'baseUrl es requerido para el proveedor openai-compatible',
    path: ['baseUrl'],
  });

/**
 * Endpoint del CEREBRO del Configurador. Permite inyectar el verifier y la capa de modelo en tests
 * (para no llamar al modelo real en CI). En produccion usa el verifier real y la runModel real.
 */
export function configuratorRoutes(
  config: Env,
  deps?: { verifier?: JwtVerifier; runModel?: ConfiguratorDeps['runModel'] },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);

    // Cerebro del Configurador: conversa con credenciales BYOK del cliente (key por header, resto
    // por body), construye un AgentSpec estructurado y lo valida contra el catalogo resuelto.
    // Protegido con el mismo auth JWT de Supabase que /v1/agents. Stateless: el historial viaja en
    // el body, no se persiste en DB. NO crea el agente (eso es 3.5): solo conversa, arma y valida.
    app.post(
      '/v1/configurator/message',
      { bodyLimit: AGENT_LIMITS.maxBodyBytes },
      async (request: FastifyRequest, reply: FastifyReply) => {
        await requireUser(request, verifier);

        const parsed = ConfiguratorBodySchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Cuerpo de la peticion invalido', parsed.error.issues);
        }

        // BYOK: la provider key viaja por header (mismo patron que /v1/run/:agentId). Si falta,
        // 400 claro, no un 503 de plataforma: la feature ya no depende de una key propia.
        const headerKey = request.headers['x-provider-key'];
        if (typeof headerKey !== 'string' || headerKey.trim() === '') {
          throw new AppError('VALIDATION_ERROR', 400, 'Falta el header x-provider-key');
        }

        const result = await runConfiguratorTurn(
          {
            messages: parsed.data.messages,
            catalog: resolveToolCatalog(config),
            webhookCapability: WEBHOOK_TOOL_CAPABILITY,
            credentials: {
              providerId: parsed.data.providerId,
              apiKey: headerKey,
              model: parsed.data.model,
              ...(parsed.data.baseUrl !== undefined ? { baseUrl: parsed.data.baseUrl } : {}),
            },
          },
          { ...(deps?.runModel ? { runModel: deps.runModel } : {}) },
        );

        // Contrato de respuesta: { reply, spec, validation }. spec es parcial mientras se entrevista
        // y null si la salida del modelo no fue interpretable (validation.ok = false en ese caso).
        return reply.send({
          reply: result.reply,
          spec: result.spec,
          validation: result.validation,
        });
      },
    );
  };
}
