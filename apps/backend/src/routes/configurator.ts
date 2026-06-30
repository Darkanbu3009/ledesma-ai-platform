import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ProviderId } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { resolveStoredCredential } from '../credentials/resolve-stored-credential.js';
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
  deps?: {
    verifier?: JwtVerifier;
    runModel?: ConfiguratorDeps['runModel'];
    credentialRepo?: ProviderCredentialRepository;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const credentialRepo = deps?.credentialRepo ?? new ProviderCredentialRepository(getSql(config));

    // Cerebro del Configurador: conversa con credenciales BYOK del cliente (key por header, resto
    // por body), construye un AgentSpec estructurado y lo valida contra el catalogo resuelto.
    // Protegido con el mismo auth JWT de Supabase que /v1/agents. Stateless: el historial viaja en
    // el body, no se persiste en DB. NO crea el agente (eso es 3.5): solo conversa, arma y valida.
    app.post(
      '/v1/configurator/message',
      { bodyLimit: AGENT_LIMITS.maxBodyBytes },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);

        const parsed = ConfiguratorBodySchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Cuerpo de la peticion invalido', parsed.error.issues);
        }

        // Fuente de la key, con PRECEDENCIA explicita:
        //  1) x-provider-key (key BYOK al momento) GANA si esta presente: providerId/model/baseUrl
        //     vienen del body, comportamiento existente sin cambios.
        //  2) si no hay key al momento, x-credential-id resuelve una credencial GUARDADA del usuario
        //     (la plataforma tiene identidad de usuario aqui via requireUser): su providerId y baseUrl
        //     son autoritativos y la key sale descifrada de la boveda; el model sigue viniendo del body.
        //  3) si no hay ninguna -> 400 claro (no un 503 de plataforma).
        const headerKey = request.headers['x-provider-key'];
        const credentialIdHeader = request.headers['x-credential-id'];

        let providerId: ProviderId = parsed.data.providerId;
        let apiKey: string;
        let baseUrl: string | undefined = parsed.data.baseUrl;

        if (typeof headerKey === 'string' && headerKey.trim() !== '') {
          apiKey = headerKey;
        } else if (typeof credentialIdHeader === 'string' && credentialIdHeader.trim() !== '') {
          const credential = await resolveStoredCredential(
            credentialRepo,
            user.id,
            credentialIdHeader,
            config.VAULT_SECRET,
          );
          apiKey = credential.apiKey;
          providerId = credential.providerId;
          baseUrl = credential.baseUrl ?? undefined;
        } else {
          throw new AppError('VALIDATION_ERROR', 400, 'Falta el header x-provider-key o x-credential-id');
        }

        const result = await runConfiguratorTurn(
          {
            messages: parsed.data.messages,
            catalog: resolveToolCatalog(config),
            webhookCapability: WEBHOOK_TOOL_CAPABILITY,
            credentials: {
              providerId,
              apiKey,
              model: parsed.data.model,
              ...(baseUrl !== undefined ? { baseUrl } : {}),
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
