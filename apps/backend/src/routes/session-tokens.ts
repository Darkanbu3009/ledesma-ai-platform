import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { createSessionToken, SESSION_TOKEN_LIMITS } from '../auth/session-token.js';

const SessionTokenBodySchema = z.object({
  agentId: z.string().uuid(),
  ttlSeconds: z.number().int().positive().max(SESSION_TOKEN_LIMITS.maxTtlSeconds).optional(),
});

/**
 * Plano de ejecucion (sin JWT): el servidor del integrador intercambia su provider key por un
 * token efimero para integracion directa desde su frontend. El token cifra la key del cliente
 * (AES-256-GCM); la plataforma no persiste nada (stateless): la unica mitigacion ante fuga del
 * token es su expiracion corta.
 */
export function sessionTokenRoutes(config: Env) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = new AgentRepository(getSql(config));

    app.post('/v1/session-tokens', async (request, reply) => {
      const providerKey = request.headers['x-provider-key'];
      if (typeof providerKey !== 'string' || providerKey.trim() === '') {
        throw new AppError('VALIDATION_ERROR', 400, 'Missing x-provider-key header');
      }
      const parsed = SessionTokenBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid request body', parsed.error.issues);
      }
      const agent = await repo.getById(parsed.data.agentId);
      if (!agent) {
        throw new AppError('NOT_FOUND', 404, 'Agent not found');
      }
      const result = createSessionToken(
        {
          agentId: parsed.data.agentId,
          providerKey,
          ...(parsed.data.ttlSeconds !== undefined ? { ttlSeconds: parsed.data.ttlSeconds } : {}),
        },
        config.SESSION_TOKEN_SECRET,
      );
      return reply.send(result);
    });
  };
}
