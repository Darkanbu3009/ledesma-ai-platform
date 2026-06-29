import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ToolCatalogResponse } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { resolveToolCatalog, WEBHOOK_TOOL_CAPABILITY } from '../tools/catalog.js';

/** Permite inyectar el verifier en tests. */
export function toolCatalogRoutes(config: Env, deps?: { verifier?: JwtVerifier }) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);

    // Catalogo de tools de plataforma: enumera las capacidades que un agente puede tener para que
    // el Configurador sepa que ensamblar. SOLO LECTURA (no escribe en DB). Protegido con el mismo
    // auth JWT de Supabase que /v1/agents. La disponibilidad de cada nativa se resuelve segun env.
    app.get('/v1/tools/catalog', async (request: FastifyRequest, reply: FastifyReply) => {
      await requireUser(request, verifier);
      const response: ToolCatalogResponse = {
        tools: resolveToolCatalog(config),
        webhookCapability: WEBHOOK_TOOL_CAPABILITY,
      };
      return reply.send(response);
    });
  };
}
