import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { ConsentRepository } from '../privacy/consent-repository.js';
import {
  CURRENT_DOCUMENT_VERSIONS,
  ENFORCED_DOCUMENT_TYPES,
  missingConsents,
  type DocumentType,
} from '../privacy/documents.js';

// Cota defensiva de la version (fecha ISO o semver corto). El backend NO exige que coincida con la
// vigente: guarda lo que el titular acepto y el gate (missing) compara contra la vigente. Asi un cliente
// que mande una version vieja igual queda "missing" de la vigente.
const CreateConsentSchema = z.object({
  document_type: z.enum(['privacy_notice', 'terms']),
  document_version: z.string().trim().min(1).max(64),
});

// El user-agent es evidencia opcional; se acota para no guardar cadenas patologicas.
const MAX_USER_AGENT_CHARS = 500;

/** Agrupa las versiones aceptadas por tipo de documento, para el calculo de `missing`. */
function acceptedByType(
  consents: Array<{ documentType: DocumentType; documentVersion: string }>,
): Map<DocumentType, Set<string>> {
  const map = new Map<DocumentType, Set<string>>();
  for (const c of consents) {
    const set = map.get(c.documentType) ?? new Set<string>();
    set.add(c.documentVersion);
    map.set(c.documentType, set);
  }
  return map;
}

/**
 * Endpoints de CONSENTIMIENTO (Fase 5.6), scoped por el usuario autenticado (requireUser). El owner_id
 * SIEMPRE sale del token. Consentimiento libre, especifico e informado: la consola presenta el aviso y un
 * check explicito NO pre-marcado; aqui solo se REGISTRA y se CONSULTA.
 *
 *  - POST /v1/consents: registra la aceptacion de (document_type, document_version). Idempotente por
 *    (owner, tipo, version). Captura ip/user-agent como evidencia (sin loguear datos personales).
 *  - GET /v1/consents/me: devuelve los consentimientos del titular + las versiones VIGENTES + `missing`
 *    (los documentos cuya version vigente aun no acepto). El gate de la consola usa `missing`.
 *
 * Permite inyectar el verifier y el repo en tests (sin red ni DB).
 */
export function consentRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    consentRepo?: Pick<ConsentRepository, 'recordConsent' | 'listConsentsByOwner'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const consentRepo = deps?.consentRepo ?? new ConsentRepository(getSql(config));

    // Registra la aceptacion de una version de un documento. owner del token; evidencia del request.
    app.post('/v1/consents', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = CreateConsentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid consent', parsed.error.issues);
      }
      const rawUserAgent = request.headers['user-agent'];
      const userAgent =
        typeof rawUserAgent === 'string' && rawUserAgent.trim() !== ''
          ? rawUserAgent.slice(0, MAX_USER_AGENT_CHARS)
          : null;
      const consent = await consentRepo.recordConsent({
        ownerId: user.id,
        documentType: parsed.data.document_type,
        documentVersion: parsed.data.document_version,
        // request.ip lo resuelve Fastify (respeta trustProxy si esta configurado). Evidencia, no se loguea.
        ipAddress: request.ip ?? null,
        userAgent,
      });
      return reply.status(201).send({ consent });
    });

    // Estado de consentimiento del titular: que acepto, las versiones vigentes y que le falta re-aceptar.
    app.get('/v1/consents/me', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const consents = await consentRepo.listConsentsByOwner(user.id);
      const missing = missingConsents(acceptedByType(consents));
      return reply.send({
        consents,
        current: CURRENT_DOCUMENT_VERSIONS,
        documentTypes: ENFORCED_DOCUMENT_TYPES,
        missing,
      });
    });
  };
}
