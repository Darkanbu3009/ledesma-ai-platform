import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { resolveToolCatalog, WEBHOOK_TOOL_CAPABILITY } from '../tools/catalog.js';
import { AGENT_LIMITS } from '../agent/index.js';
import {
  getPlatformModelConfig,
  runConfiguratorTurn,
  type ConfiguratorDeps,
} from '../configurator/configurator-service.js';

// Historial de conversacion: mismos limites defensivos que el run de agentes. content no vacio;
// role user/assistant. El servidor es stateless: el historial completo viaja en cada peticion.
const ConfiguratorBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
      .min(1)
      .max(AGENT_LIMITS.maxMessages),
  })
  .refine(
    (body) => body.messages.reduce((sum, m) => sum + m.content.length, 0) <= AGENT_LIMITS.maxTotalContentChars,
    { message: `El contenido total supera ${AGENT_LIMITS.maxTotalContentChars} caracteres` },
  );

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

    // Cerebro del Configurador: conversa sobre el modelo de PLATAFORMA (NO BYOK), construye un
    // AgentSpec estructurado y lo valida contra el catalogo resuelto. Protegido con el mismo auth
    // JWT de Supabase que /v1/agents. Stateless: el historial viaja en el body, no se persiste en
    // DB. NO crea el agente (eso es la bifurcacion de 3.5): solo conversa, arma el spec y lo valida.
    app.post(
      '/v1/configurator/message',
      { bodyLimit: AGENT_LIMITS.maxBodyBytes },
      async (request: FastifyRequest, reply: FastifyReply) => {
        await requireUser(request, verifier);

        const parsed = ConfiguratorBodySchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Cuerpo de la peticion invalido', parsed.error.issues);
        }

        // Si la key de plataforma no esta configurada, lanza un AppError CLARO (503), no un 500
        // opaco. Se resuelve por peticion para reflejar cambios de env sin reiniciar el proceso.
        const platform = getPlatformModelConfig(config);

        const result = await runConfiguratorTurn(
          {
            messages: parsed.data.messages,
            catalog: resolveToolCatalog(config),
            webhookCapability: WEBHOOK_TOOL_CAPABILITY,
          },
          { platform, ...(deps?.runModel ? { runModel: deps.runModel } : {}) },
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
