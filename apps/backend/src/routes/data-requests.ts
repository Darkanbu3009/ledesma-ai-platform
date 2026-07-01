import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { requireAdmin } from '../auth/require-admin.js';
import { DataSubjectRequestRepository } from '../privacy/data-subject-request-repository.js';
import { ConsentRepository } from '../privacy/consent-repository.js';
import { ProcessingRecordRepository } from '../privacy/processing-record-repository.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { RetentionRepository, type EraseResult } from '../retention/retention-repository.js';

const MAX_DETAILS_CHARS = 5_000;
const MAX_NOTE_CHARS = 2_000;

const CreateDataRequestSchema = z.object({
  request_type: z.enum(['access', 'rectification', 'cancellation', 'opposition', 'erasure']),
  details: z.string().trim().max(MAX_DETAILS_CHARS).optional(),
});

const RequestIdParamSchema = z.object({ id: z.string().uuid() });

// Resolucion admin: nuevo estado + nota opcional. `erase` (opt-in) dispara el borrado de datos operativos
// del titular cuando la solicitud es de tipo 'erasure' (Parte F). Sin `erase`, resolver solo cambia estado.
const ResolveDataRequestSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'rejected']),
  resolution_note: z.string().trim().max(MAX_NOTE_CHARS).optional(),
  erase: z.boolean().optional(),
});

/**
 * Endpoints de DERECHOS DEL TITULAR / ARCO (Fase 5.6), scoped por el usuario autenticado. owner_id SIEMPRE
 * del token. Tipos: access/rectification/cancellation/opposition (ARCO mexicano) + erasure (GDPR).
 *
 *  - POST /v1/data-requests: crea una solicitud (queda 'pending').
 *  - GET  /v1/data-requests: lista las solicitudes del titular con su estado.
 *  - GET  /v1/data-requests/export: 'access' AUTOMATICO self-service: exporta los datos personales/de
 *    cumplimiento que la plataforma tiene del titular (perfil, consentimientos, solicitudes, registros de
 *    tratamiento) como JSON. La resolucion del resto de tipos es manual (admin).
 *  - POST /v1/admin/data-requests/:id/resolve: super-admin resuelve una solicitud; con `erase` sobre una
 *    de tipo 'erasure', borra los datos OPERATIVOS del titular (runs, jobs, tareas, triggers, recetas,
 *    registros de tratamiento) reusando el mecanismo de retencion. Perfil/credenciales/agentes: manual.
 *
 * REPORTE de que quedo automatico vs manual: 'access' es automatico (export). 'erasure' de datos
 * operativos es semi-automatico (admin lo dispara con `erase`). Rectificacion/cancelacion/oposicion y el
 * borrado de perfil/credenciales/agentes: manuales (el admin resuelve y anota).
 */
export function dataSubjectRequestRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    requestRepo?: Pick<
      DataSubjectRequestRepository,
      'createRequest' | 'listRequestsByOwner' | 'getRequestById' | 'updateStatus'
    >;
    consentRepo?: Pick<ConsentRepository, 'listConsentsByOwner'>;
    processingRepo?: Pick<ProcessingRecordRepository, 'listRecordsByOwner'>;
    registrationRepo?: Pick<RegistrationRepository, 'getState'>;
    retentionRepo?: Pick<RetentionRepository, 'eraseOwnerOperationalData'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const requestRepo = deps?.requestRepo ?? new DataSubjectRequestRepository(getSql(config));
    const consentRepo = deps?.consentRepo ?? new ConsentRepository(getSql(config));
    const processingRepo = deps?.processingRepo ?? new ProcessingRecordRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));
    const retentionRepo = deps?.retentionRepo ?? new RetentionRepository(getSql(config));

    // Crea una solicitud de derechos del titular. owner del token.
    app.post('/v1/data-requests', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = CreateDataRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid data request', parsed.error.issues);
      }
      const created = await requestRepo.createRequest({
        ownerId: user.id,
        requestType: parsed.data.request_type,
        details: parsed.data.details ?? null,
      });
      return reply.status(201).send({ request: created });
    });

    // 'access' self-service: exporta los datos del titular que la plataforma tiene. Ruta ESTATICA antes que
    // cualquier futura /:id, sin conflicto hoy.
    app.get('/v1/data-requests/export', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const [state, consents, dataRequests, processingRecords] = await Promise.all([
        registrationRepo.getState(user.id),
        consentRepo.listConsentsByOwner(user.id),
        requestRepo.listRequestsByOwner(user.id),
        processingRepo.listRecordsByOwner(user.id),
      ]);
      return reply.send({
        export: {
          subjectId: user.id,
          profile: state.profile,
          organization: state.organization,
          consents,
          dataRequests,
          processingRecords,
        },
      });
    });

    // Lista las solicitudes del titular.
    app.get('/v1/data-requests', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const requests = await requestRepo.listRequestsByOwner(user.id);
      return reply.send({ requests });
    });

    // Resolucion admin de una solicitud (super-admin). Con `erase` sobre una 'erasure', borra datos
    // operativos del titular y lo anota en la nota de resolucion.
    app.post(
      '/v1/admin/data-requests/:id/resolve',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        requireAdmin(request, config);
        const params = RequestIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid request id', params.error.issues);
        }
        const parsed = ResolveDataRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid resolution', parsed.error.issues);
        }

        const existing = await requestRepo.getRequestById(params.data.id);
        if (!existing) throw new AppError('NOT_FOUND', 404, 'Data request not found');

        let note = parsed.data.resolution_note ?? null;
        let erased: EraseResult | undefined;
        // El borrado real solo aplica a solicitudes de erasure y cuando el admin lo pide explicitamente.
        if (parsed.data.erase === true && existing.requestType === 'erasure') {
          erased = await retentionRepo.eraseOwnerOperationalData(existing.ownerId);
          const summary = `datos operativos borrados: ${JSON.stringify(erased)}`;
          note = note ? `${note} | ${summary}` : summary;
        }

        const updated = await requestRepo.updateStatus(params.data.id, parsed.data.status, note);
        if (!updated) throw new AppError('NOT_FOUND', 404, 'Data request not found');
        return reply.send({ request: updated, ...(erased ? { erased } : {}) });
      },
    );
  };
}
