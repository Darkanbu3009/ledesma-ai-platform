import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { decryptFromToken } from '../crypto/aes-gcm.js';
import { TriggersRepository, type TriggerForDispatch } from '../triggers/triggers-repository.js';
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  URL_TOKEN_HEADER,
  verifyIncomingHmac,
  verifyUrlToken,
} from '../triggers/trigger-auth.js';

// Limite de bytes del cuerpo del webhook entrante. Un evento razonable cabe de sobra; el tope corta
// cuerpos abusivos ANTES de gastar CPU en verificar la firma (el rate-limit global de plugins/security
// tambien aplica a esta ruta). El content-type parser rechaza (413) lo que exceda.
const MAX_WEBHOOK_BODY_BYTES = 65_536;

// Tope de caracteres del contexto del evento que se anexa al mensaje del agente. Acota lo que un evento
// entrante puede inyectar al prompt (el cuerpo es no confiable: quien tenga el secreto puede mandarlo).
const MAX_EVENT_CONTEXT_CHARS = 8_000;

const IncomingParamSchema = z.object({ triggerId: z.string().uuid() });

/**
 * Serializa el cuerpo del evento entrante para anexarlo como contexto al agente. JSON.parse tolerante:
 * un cuerpo vacio o no-JSON -> undefined (no se anexa nada, se ejecuta solo el payload_template). Un
 * cuerpo valido se re-serializa compacto y se TRUNCA a MAX_EVENT_CONTEXT_CHARS.
 */
function eventContext(rawBody: string): string | undefined {
  const trimmed = rawBody.trim();
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (parsed === null || parsed === undefined) return undefined;
  const serialized = JSON.stringify(parsed);
  return serialized.length > MAX_EVENT_CONTEXT_CHARS
    ? serialized.slice(0, MAX_EVENT_CONTEXT_CHARS)
    : serialized;
}

/**
 * Construye el payload del job a encolar: el payload_template del trigger (base fija, ya validada al
 * crear) MAS, si el evento entrante trae un cuerpo JSON, UN mensaje 'user' extra con esos datos como
 * contexto (lo mas util: que el evento aporte informacion al agente). El resultado conserva el shape
 * { messages, maxIterations? } que el worker valida (JobPayloadSchema), asi el job es ejecutable tal
 * cual, igual que los que encola el scheduler. Nota de seguridad: el contexto del evento es entrada no
 * confiable (posible prompt injection); va claramente delimitado y acotado en tamano.
 */
function buildJobPayload(template: unknown, rawBody: string): unknown {
  const base =
    typeof template === 'object' && template !== null ? (template as Record<string, unknown>) : {};
  const messages = Array.isArray(base.messages) ? [...base.messages] : [];
  const context = eventContext(rawBody);
  if (context !== undefined) {
    messages.push({ role: 'user', content: `Evento entrante:\n${context}` });
  }
  return {
    messages,
    ...(typeof base.maxIterations === 'number' ? { maxIterations: base.maxIterations } : {}),
  };
}

/** Extrae el url_token presentado: query param ?token= (preferido, "token en la URL") o header. */
function extractUrlToken(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, unknown> | undefined;
  if (query && typeof query.token === 'string') return query.token;
  const header = request.headers[URL_TOKEN_HEADER];
  return typeof header === 'string' ? header : undefined;
}

/**
 * Autentica el POST entrante segun el auth_mode del trigger. Devuelve true solo si la firma HMAC (con
 * ventana anti-replay) o el url_token (comparado en tiempo constante) son validos. NO lanza ni distingue
 * el motivo del fallo: el llamador responde 401 uniforme. Un secreto irrecuperable (descifrado fallido)
 * o material ausente -> false.
 */
function authenticate(
  trigger: TriggerForDispatch,
  request: FastifyRequest,
  rawBody: string,
  vaultSecret: string,
  nowSeconds: number,
): boolean {
  if (trigger.authMode === 'hmac') {
    if (trigger.hmacSecretEncrypted === null) return false;
    let secret: string;
    try {
      secret = decryptFromToken(trigger.hmacSecretEncrypted, vaultSecret);
    } catch {
      return false;
    }
    return verifyIncomingHmac({
      rawBody,
      timestampHeader: request.headers[HMAC_TIMESTAMP_HEADER],
      signatureHeader: request.headers[HMAC_SIGNATURE_HEADER],
      secret,
      nowSeconds,
    });
  }
  // url_token
  if (trigger.urlTokenHash === null) return false;
  return verifyUrlToken(extractUrlToken(request), trigger.urlTokenHash);
}

/**
 * ENDPOINT ENTRANTE PUBLICO de los TRIGGERS POR EVENTO (Fase 5.4). Ruta SIN JWT de usuario: un evento
 * externo no lo tiene. La seguridad es lo critico -> autentica cada POST antes de encolar nada.
 *
 * Flujo (POST /webhooks/triggers/:triggerId):
 *  1. Resuelve el trigger por :id. Inexistente O inactivo -> 404 GENERICO (no revela cual, no filtra la
 *     existencia de un trigger).
 *  2. Autentica segun auth_mode: 'hmac' (firma + anti-replay) o 'url_token' (tiempo constante). Invalido
 *     -> 401.
 *  3. Si autentica: ENCOLA un job 'pending' con agent_id/owner_id/credential_id del trigger y el payload
 *     (template + datos del evento), EXACTAMENTE como el scheduler. NO ejecuta el agente aqui (el worker
 *     lo toma). El worker re-gatea por tier al ejecutar, asi que si el owner perdio 'autonomous' el job
 *     se rechaza alla (red de seguridad; no hace falta re-verificar tier aqui).
 *  4. Marca last_triggered_at y responde 202 Accepted.
 *
 * RAW BODY: la verificacion HMAC necesita el cuerpo CRUDO (Fastify por defecto parsea JSON y lo pierde).
 * Se registra un content-type parser con parseAs:'string' ENCAPSULADO en este plugin (no afecta al resto
 * de la app): request.body llega como string sin parsear, y la ruta lo usa tal cual para la firma y
 * parsea el JSON aparte para el contexto del evento.
 *
 * RATE LIMITING: el rate-limit global (plugins/security.ts, @fastify/rate-limit) cubre esta ruta. Un
 * limite por-trigger mas fino queda como mejora futura.
 */
export function incomingTriggerRoutes(
  config: Env,
  deps?: {
    triggerRepo?: Pick<TriggersRepository, 'getByIdForDispatch' | 'markTriggered'>;
    jobsRepo?: Pick<JobsRepository, 'createJob'>;
    /** Reloj (Unix segundos) inyectable para tests deterministas del anti-replay. Default: ahora. */
    clock?: () => number;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const triggerRepo = deps?.triggerRepo ?? new TriggersRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const clock = deps?.clock ?? (() => Math.floor(Date.now() / 1000));

    // RAW BODY encapsulado: parseAs:'string' entrega el cuerpo sin parsear. 'application/json' OVERRIDE
    // del parser JSON heredado (que lo consumiria); '*' cubre cualquier otro content-type. Solo aplica a
    // este contexto de plugin: las demas rutas conservan su parseo JSON normal.
    const rawBodyParser = (_req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
      done(null, body);
    };
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: MAX_WEBHOOK_BODY_BYTES },
      rawBodyParser,
    );
    app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: MAX_WEBHOOK_BODY_BYTES }, rawBodyParser);

    app.post(
      '/webhooks/triggers/:triggerId',
      async (request: FastifyRequest<{ Params: { triggerId: string } }>, reply: FastifyReply) => {
        // Un :id malformado no puede existir: 404 generico (mismo trato que inexistente, sin filtrar).
        const params = IncomingParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('NOT_FOUND', 404, 'Not found');
        }

        const trigger = await triggerRepo.getByIdForDispatch(params.data.triggerId);
        // 404 GENERICO para inexistente O inactivo: no se revela cual de los dos.
        if (trigger === null || !trigger.isActive) {
          throw new AppError('NOT_FOUND', 404, 'Not found');
        }

        const rawBody = typeof request.body === 'string' ? request.body : '';

        if (!authenticate(trigger, request, rawBody, config.VAULT_SECRET, clock())) {
          throw new AppError('UNAUTHORIZED', 401, 'Unauthorized');
        }

        // Encola el job EXACTAMENTE como el scheduler: status 'pending' (default de la tabla), sin
        // scheduled_for (ASAP). NO se ejecuta el agente aqui.
        await jobsRepo.createJob({
          agentId: trigger.agentId,
          ownerId: trigger.ownerId,
          credentialId: trigger.credentialId,
          payload: buildJobPayload(trigger.payloadTemplate, rawBody),
        });
        await triggerRepo.markTriggered(trigger.id);

        // 202: aceptado y encolado; el worker lo ejecutara async.
        return reply.status(202).send({ status: 'accepted' });
      },
    );
  };
}
