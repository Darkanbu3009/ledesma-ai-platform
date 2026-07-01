import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { TriggersRepository, type TriggerMetadata } from '../triggers/triggers-repository.js';
import { encryptToToken } from '../crypto/aes-gcm.js';
import {
  generateHmacSecret,
  generateUrlToken,
  hashUrlToken,
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
} from '../triggers/trigger-auth.js';
import { publicBaseUrl, webhookUrl } from '../triggers/webhook-url.js';
import { AGENT_LIMITS } from '../agent/index.js';

// Ventana anti-replay (segundos) que el endpoint entrante hmac aplica; se reporta al usuario al crear el
// trigger para que su cliente firme con un timestamp fresco. Mismo default que verifyWebhookSignature.
const HMAC_TOLERANCE_SECONDS = 300;

// Plantilla de payload: el MISMO shape que ejecuta el worker (apps/worker JobPayloadSchema) y que el
// body de /v1/run/:agentId. messages no vacio (role user/assistant, content no vacio); maxIterations
// opcional. Es la base que se ejecuta al dispararse (el evento entrante puede agregar contexto, ver
// routes/incoming-triggers.ts), asi que debe ser ejecutable tal cual.
const PayloadTemplateSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
    .min(1)
    .max(AGENT_LIMITS.maxMessages),
  maxIterations: z.number().int().positive().max(AGENT_LIMITS.maxIterationsCap).optional(),
});

const CreateTriggerSchema = z.object({
  agentId: z.string().uuid(),
  credentialId: z.string().uuid(),
  authMode: z.enum(['hmac', 'url_token']),
  payloadTemplate: PayloadTemplateSchema,
});

// PATCH: activar/desactivar y/o ROTAR el secreto/token. Al menos uno presente. No permite cambiar
// agente/credencial/authMode/payload (eso seria crear otro trigger): mantiene el alcance del PATCH.
const UpdateTriggerSchema = z
  .object({
    isActive: z.boolean().optional(),
    rotate: z.boolean().optional(),
  })
  .refine((body) => body.isActive !== undefined || body.rotate === true, {
    message: 'al menos un campo (isActive o rotate) es requerido',
  });

const TriggerIdParamSchema = z.object({ id: z.string().uuid() });

/** Instrucciones de firma que se muestran junto a un trigger 'hmac' (sin secreto): que headers mandar. */
const HMAC_SIGNATURE_INFO = {
  algorithm: 'HMAC-SHA256',
  // El cliente firma "{timestamp}.{rawBody}" con su secreto y manda el hex en x-ledesma-signature
  // (acepta el hex a secas o con prefijo "v1="). El timestamp Unix (segundos) va en x-ledesma-timestamp.
  signedPayload: '{timestamp}.{rawBody}',
  signatureFormat: 'v1=<hexdigest>',
  timestampHeader: HMAC_TIMESTAMP_HEADER,
  signatureHeader: HMAC_SIGNATURE_HEADER,
  toleranceSeconds: HMAC_TOLERANCE_SECONDS,
} as const;

/** Vista de un trigger en el LISTADO: metadata + la URL entrante. Para 'hmac' agrega como firmar. */
function toListView(base: string, trigger: TriggerMetadata) {
  return {
    ...trigger,
    // Para 'url_token' la URL NO lleva el token: el token en claro no se persiste (solo su hash) y solo
    // se muestra una vez al crear/rotar. El cliente adjunta su token (?token=...) al disparar.
    webhookUrl: webhookUrl(base, trigger.id),
    ...(trigger.authMode === 'hmac' ? { signature: HMAC_SIGNATURE_INFO } : {}),
  };
}

/**
 * Endpoints CRUD de TRIGGERS POR EVENTO (gestion), todos scoped por el usuario autenticado (requireUser,
 * mismo auth JWT que /v1/agents). El owner_id SIEMPRE sale del token.
 *
 * Reglas clave (mismo modelo que /v1/scheduled-tasks):
 *  - GATE POR TIER server-side en la CREACION: un trigger dispara ejecucion autonoma; solo el tier
 *    'autonomous' puede crearlos. Se lee profiles.tier (nunca se confia en el cliente). El worker vuelve
 *    a gatear por tier al ejecutar el job encolado (defensa en profundidad), por eso PATCH/DELETE no
 *    re-gatean.
 *  - PERTENENCIA: el agente y la credencial deben ser del owner (no se dispara un recurso ajeno).
 *  - SECRETO UNA SOLA VEZ: al crear/rotar se GENERA el secreto HMAC (cifrado con VAULT_SECRET) o el
 *    url_token (guardado hasheado) y se DEVUELVE en claro una unica vez; despues nunca se vuelve a
 *    mostrar (el listado jamas expone material de auth).
 *
 * Permite inyectar el verifier y los repos en tests (sin red ni DB en CI).
 */
export function triggerRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    triggerRepo?: Pick<
      TriggersRepository,
      'createTrigger' | 'listByOwner' | 'getForOwner' | 'updateForOwner' | 'deleteForOwner'
    >;
    agentRepo?: Pick<AgentRepository, 'getByIdForOwner'>;
    credentialRepo?: Pick<ProviderCredentialRepository, 'existsForOwner'>;
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const triggerRepo = deps?.triggerRepo ?? new TriggersRepository(getSql(config));
    const agentRepo = deps?.agentRepo ?? new AgentRepository(getSql(config));
    const credentialRepo = deps?.credentialRepo ?? new ProviderCredentialRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    // Crea un trigger. Gate por tier 'autonomous'; valida pertenencia de agente/credencial; genera el
    // material de auth segun authMode y lo devuelve en claro UNA vez. owner_id SIEMPRE = usuario del token.
    app.post('/v1/triggers', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const parsed = CreateTriggerSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid trigger', parsed.error.issues);
      }

      // GATE SERVER-SIDE: crear un trigger exige tier 'autonomous'. Corre antes de tocar la DB: un
      // usuario sin el plan recibe 403 y no genera secretos ni crea nada.
      const tier = await registrationRepo.getProfileTier(user.id);
      if (tier !== 'autonomous') {
        throw new AppError('FORBIDDEN', 403, 'Triggers require the autonomous plan (tier autonomous)');
      }

      // PERTENENCIA: agente y credencial deben ser del owner. Referencia ajena/inexistente -> NOT_FOUND
      // (no se revela la existencia de recursos de otros).
      const agent = await agentRepo.getByIdForOwner(parsed.data.agentId, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      const credentialExists = await credentialRepo.existsForOwner(user.id, parsed.data.credentialId);
      if (!credentialExists) throw new AppError('NOT_FOUND', 404, 'Credential not found');

      const base = publicBaseUrl(config, request);

      if (parsed.data.authMode === 'hmac') {
        // Genera el secreto HMAC, lo cifra con VAULT_SECRET (nunca en claro en reposo) y lo devuelve una
        // sola vez para que el cliente firme sus POST.
        const hmacSecret = generateHmacSecret();
        const trigger = await triggerRepo.createTrigger({
          ownerId: user.id,
          agentId: parsed.data.agentId,
          credentialId: parsed.data.credentialId,
          authMode: 'hmac',
          hmacSecretEncrypted: encryptToToken(hmacSecret, config.VAULT_SECRET),
          payloadTemplate: parsed.data.payloadTemplate,
        });
        return reply.status(201).send({
          trigger,
          webhookUrl: webhookUrl(base, trigger.id),
          // Se muestra UNA sola vez (como una API key): no se puede recuperar despues.
          hmacSecret,
          signature: HMAC_SIGNATURE_INFO,
        });
      }

      // url_token: genera un token impredecible, guarda solo su hash y devuelve la URL con el token una
      // sola vez.
      const urlToken = generateUrlToken();
      const trigger = await triggerRepo.createTrigger({
        ownerId: user.id,
        agentId: parsed.data.agentId,
        credentialId: parsed.data.credentialId,
        authMode: 'url_token',
        urlTokenHash: hashUrlToken(urlToken),
        payloadTemplate: parsed.data.payloadTemplate,
      });
      return reply.status(201).send({
        trigger,
        // La URL incluye el token una sola vez: es lo que el cliente pega en su sistema.
        webhookUrl: webhookUrl(base, trigger.id, urlToken),
        urlToken,
      });
    });

    // Lista los triggers del owner (metadata + URL entrante), SIN material de auth.
    app.get('/v1/triggers', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const triggers = await triggerRepo.listByOwner(user.id);
      const base = publicBaseUrl(config, request);
      return reply.send({ triggers: triggers.map((t) => toListView(base, t)) });
    });

    // Activa/desactiva y/o ROTA el secreto/token de un trigger del owner. Al rotar, devuelve el nuevo
    // secreto/token una sola vez (como al crear).
    app.patch(
      '/v1/triggers/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);

        const params = TriggerIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid trigger id', params.error.issues);
        }
        const parsed = UpdateTriggerSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid trigger update', parsed.error.issues);
        }

        const current = await triggerRepo.getForOwner(params.data.id, user.id);
        if (!current) throw new AppError('NOT_FOUND', 404, 'Trigger not found');

        const isActive = parsed.data.isActive ?? current.isActive;

        // ROTACION: regenera el material segun el authMode del trigger. El nuevo valor (cifrado/hasheado)
        // se pasa al UPDATE (que lo pisa via coalesce); el secreto/token en claro se devuelve una vez.
        let newHmacSecret: string | undefined;
        let newUrlToken: string | undefined;
        let hmacSecretEncrypted: string | undefined;
        let urlTokenHash: string | undefined;
        if (parsed.data.rotate === true) {
          if (current.authMode === 'hmac') {
            newHmacSecret = generateHmacSecret();
            hmacSecretEncrypted = encryptToToken(newHmacSecret, config.VAULT_SECRET);
          } else {
            newUrlToken = generateUrlToken();
            urlTokenHash = hashUrlToken(newUrlToken);
          }
        }

        const updated = await triggerRepo.updateForOwner(params.data.id, user.id, {
          isActive,
          hmacSecretEncrypted,
          urlTokenHash,
        });
        if (!updated) throw new AppError('NOT_FOUND', 404, 'Trigger not found');

        const base = publicBaseUrl(config, request);
        return reply.send({
          trigger: toListView(base, updated),
          // Solo si se roto: el nuevo secreto/token en claro, una sola vez.
          ...(newHmacSecret !== undefined ? { hmacSecret: newHmacSecret } : {}),
          ...(newUrlToken !== undefined
            ? { urlToken: newUrlToken, webhookUrl: webhookUrl(base, updated.id, newUrlToken) }
            : {}),
        });
      },
    );

    // Borra un trigger del owner. Acotado al owner: solo borra los propios.
    app.delete(
      '/v1/triggers/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = TriggerIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid trigger id', params.error.issues);
        }
        const removed = await triggerRepo.deleteForOwner(params.data.id, user.id);
        if (!removed) throw new AppError('NOT_FOUND', 404, 'Trigger not found');
        return reply.status(204).send();
      },
    );
  };
}
