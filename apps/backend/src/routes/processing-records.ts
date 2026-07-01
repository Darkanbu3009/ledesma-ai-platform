import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { ProcessingRecordRepository } from '../privacy/processing-record-repository.js';

const MAX_PURPOSE_CHARS = 2_000;
const MAX_DATA_CATEGORIES_CHARS = 2_000;

// agentId opcional: un tratamiento puede no estar ligado a un agente concreto. Si viene, debe ser uuid.
const CreateProcessingRecordSchema = z.object({
  agentId: z.string().uuid().optional(),
  purpose: z.string().trim().min(1).max(MAX_PURPOSE_CHARS),
  dataCategories: z.string().trim().min(1).max(MAX_DATA_CATEGORIES_CHARS),
});

/**
 * Endpoints del REGISTRO DE ACTIVIDADES DE TRATAMIENTO (accountability, Art 30 GDPR / responsabilidad
 * LFPDPPP), scoped por el usuario autenticado. owner_id SIEMPRE del token. El registro puede poblarse a
 * mano por el responsable; el enganche automatico con /v1/agents queda fuera de este PR (no se reescribe
 * esa ruta). Permite inyectar verifier y repo en tests.
 */
export function processingRecordRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    processingRepo?: Pick<ProcessingRecordRepository, 'createRecord' | 'listRecordsByOwner'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const processingRepo = deps?.processingRepo ?? new ProcessingRecordRepository(getSql(config));

    // Registra una actividad de tratamiento del owner.
    app.post('/v1/processing-records', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = CreateProcessingRecordSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid processing record', parsed.error.issues);
      }
      const record = await processingRepo.createRecord({
        ownerId: user.id,
        agentId: parsed.data.agentId ?? null,
        purpose: parsed.data.purpose,
        dataCategories: parsed.data.dataCategories,
      });
      return reply.status(201).send({ record });
    });

    // Lista los registros de tratamiento del owner.
    app.get('/v1/processing-records', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const records = await processingRepo.listRecordsByOwner(user.id);
      return reply.send({ records });
    });
  };
}
