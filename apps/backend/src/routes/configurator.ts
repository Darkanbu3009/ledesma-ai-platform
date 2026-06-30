import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgentSpec, ProviderId } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { resolveStoredCredential } from '../credentials/resolve-stored-credential.js';
import { resolveToolCatalog, WEBHOOK_TOOL_CAPABILITY } from '../tools/catalog.js';
import { AGENT_LIMITS } from '../agent/index.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { validateAgentSpecStrict } from '../agents/agent-spec.js';
import {
  runConfiguratorTurn,
  type ConfiguratorDeps,
  type ConfiguratorValidation,
} from '../configurator/configurator-service.js';

// Historial de conversacion + credenciales BYOK por request. content no vacio; role user/assistant.
// El servidor es stateless: el historial completo viaja en cada peticion. La key NO va en el body
// (viaja por el header x-provider-key, igual que /v1/run/:agentId); aqui llegan el proveedor, el
// modelo y, solo para openai-compatible, el baseUrl. El enum de providerId espeja AgentInputSchema.
// `mode` elige el comportamiento del turno: 'assistant' (default, sin cambios: arma+valida y el
// humano confirma) o 'autonomous' (crea el agente solo si pasa la validacion estricta; gated por
// tier server-side). Default 'assistant' => clientes viejos siguen funcionando igual.
const ConfiguratorBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
      .min(1)
      .max(AGENT_LIMITS.maxMessages),
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    model: z.string().min(1).max(120),
    baseUrl: z.string().url().optional(),
    mode: z.enum(['assistant', 'autonomous']).default('assistant'),
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
 * Endpoint del CEREBRO del Configurador. Permite inyectar el verifier, la capa de modelo y los repos
 * en tests (para no llamar al modelo real ni a la DB en CI). En produccion usa los reales.
 */
export function configuratorRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    runModel?: ConfiguratorDeps['runModel'];
    credentialRepo?: ProviderCredentialRepository;
    /** Repo de agentes: el modo autonomo REUSA su create (mismo flujo que POST /v1/agents). */
    agentRepo?: Pick<AgentRepository, 'create'>;
    /** Repo de registro: el gate server-side lee profiles.tier por aca. */
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const credentialRepo = deps?.credentialRepo ?? new ProviderCredentialRepository(getSql(config));
    const agentRepo = deps?.agentRepo ?? new AgentRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    // Cerebro del Configurador: conversa con credenciales BYOK del cliente (key por header, resto
    // por body), construye un AgentSpec estructurado y lo valida contra el catalogo resuelto.
    // Protegido con el mismo auth JWT de Supabase que /v1/agents. Stateless: el historial viaja en
    // el body, no se persiste en DB.
    //
    // MODO ASISTENTE (default): solo conversa, arma y valida; NO crea el agente (lo confirma el
    // humano en la UI). MODO AUTONOMO: ademas, cuando el tier del usuario es 'autonomous' Y la
    // validacion ESTRICTA pasa, crea el agente automaticamente reusando el flujo de creacion; si no
    // pasa, cae de vuelta a la conversacion (nunca crea un agente invalido).
    app.post(
      '/v1/configurator/message',
      { bodyLimit: AGENT_LIMITS.maxBodyBytes },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);

        const parsed = ConfiguratorBodySchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Cuerpo de la peticion invalido', parsed.error.issues);
        }

        const autonomous = parsed.data.mode === 'autonomous';

        // GATE SERVER-SIDE: el modo autonomo exige tier 'autonomous', verificado leyendo
        // profiles.tier (NUNCA se confia en el cliente). Corre ANTES de llamar al modelo: un usuario
        // sin el plan no gasta una llamada y recibe un 403 claro. El modo asistente no lee el tier
        // (cero cambios de comportamiento para todos los tiers).
        if (autonomous) {
          const tier = await registrationRepo.getProfileTier(user.id);
          if (tier !== 'autonomous') {
            throw new AppError(
              'FORBIDDEN',
              403,
              'El modo autonomo requiere el plan correspondiente (tier autonomous)',
            );
          }
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

        const catalog = resolveToolCatalog(config);
        const result = await runConfiguratorTurn(
          {
            messages: parsed.data.messages,
            catalog,
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

        // Contrato base (igual en ambos modos): { reply, spec, validation }. spec es parcial mientras
        // se entrevista y null si la salida del modelo no fue interpretable.
        const base = {
          reply: result.reply,
          spec: result.spec,
          validation: result.validation,
        };

        // MODO ASISTENTE: termina aca, identico al comportamiento previo.
        if (!autonomous) {
          return reply.send(base);
        }

        // MODO AUTONOMO: validacion ESTRICTA sobre el spec del turno. Solo si pasa se crea el agente,
        // reusando el MISMO flujo de creacion que POST /v1/agents (repo.create con owner = usuario).
        // Si no pasa (spec incompleto/ambiguo o no interpretable), no se crea nada: el cliente sigue
        // conversando guiado por strict.errors. NUNCA se crea un agente invalido.
        const strict = validateAgentSpecStrict(result.spec as AgentSpec, catalog);
        const strictValidation: ConfiguratorValidation = strict.ok
          ? { ok: true }
          : { ok: false, errors: strict.errors };

        if (!strict.ok) {
          return reply.send({
            ...base,
            autonomous: { created: false, agent: null, validation: strictValidation },
          });
        }

        // owner_id SIEMPRE = usuario autenticado (igual que POST /v1/agents).
        const agent = await agentRepo.create({ ...strict.value, ownerId: user.id });
        return reply.send({
          ...base,
          autonomous: { created: true, agent, validation: strictValidation },
        });
      },
    );
  };
}
