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
import { AccountDeletionRepository } from '../account/account-deletion-repository.js';
import { createSupabaseAuthUserDeleter } from '../account/supabase-admin.js';
import { deleteAccount, type DeleteAccountResult } from '../account/account-deletion-service.js';

const MAX_DETAILS_CHARS = 5_000;
const MAX_NOTE_CHARS = 2_000;

const CreateDataRequestSchema = z.object({
  request_type: z.enum(['access', 'rectification', 'cancellation', 'opposition', 'erasure']),
  details: z.string().trim().max(MAX_DETAILS_CHARS).optional(),
});

const RequestIdParamSchema = z.object({ id: z.string().uuid() });

// Resolucion admin: nuevo estado + nota opcional. `erase` (opt-in) dispara el MOTOR DE BORRADO atomico
// sobre el titular cuando la solicitud es de tipo 'erasure' (Parte F). Sin `erase`, resolver solo cambia
// estado. `delete_auth_user` (opt-in, default false): ademas de los datos, borra la identidad (auth.users)
// via el admin API. Por default el erasure ARCO CONSERVA la identidad (solo borra datos); el borrado total
// del usuario es del endpoint self-service (pieza siguiente).
const ResolveDataRequestSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'rejected']),
  resolution_note: z.string().trim().max(MAX_NOTE_CHARS).optional(),
  erase: z.boolean().optional(),
  delete_auth_user: z.boolean().optional(),
});

/** Servicio de borrado de cuenta inyectable (motor de datos + borrado opcional de auth.users). */
export interface AccountDeletionService {
  deleteAccount(ownerId: string, opts: { deleteAuthUser: boolean }): Promise<DeleteAccountResult>;
}

/**
 * Endpoints de DERECHOS DEL TITULAR / ARCO (Fase 5.6), scoped por el usuario autenticado. owner_id SIEMPRE
 * del token. Tipos: access/rectification/cancellation/opposition (ARCO mexicano) + erasure (GDPR).
 *
 *  - POST /v1/data-requests: crea una solicitud (queda 'pending').
 *  - GET  /v1/data-requests: lista las solicitudes del titular con su estado.
 *  - GET  /v1/data-requests/export: 'access' AUTOMATICO self-service: exporta los datos personales/de
 *    cumplimiento que la plataforma tiene del titular (perfil, consentimientos, solicitudes, registros de
 *    tratamiento) como JSON. La resolucion del resto de tipos es manual (admin).
 *  - POST /v1/admin/data-requests/:id/resolve: super-admin resuelve una solicitud. Con `erase` sobre una
 *    de tipo 'erasure', dispara el MOTOR DE BORRADO ATOMICO (account-deletion): borra/anonimiza TODOS los
 *    datos del titular (las 16 tablas) en UNA transaccion -- arreglando el hallazgo H-01 de la auditoria 8
 *    (antes: 6 DELETE sueltos no atomicos + updateStatus como dos awaits separados). Con `delete_auth_user`
 *    ademas borra la identidad (auth.users). Sin `erase`, resolver solo cambia estado.
 *
 * REPORTE de que quedo automatico vs manual: 'access' es automatico (export). 'erasure' es semi-automatico
 * (admin lo dispara con `erase`) y ahora COMPLETO Y ATOMICO (incluye perfil/credenciales/agentes).
 * Rectificacion/cancelacion/oposicion: manuales (el admin resuelve y anota el estado).
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
    accountDeletion?: AccountDeletionService;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const requestRepo = deps?.requestRepo ?? new DataSubjectRequestRepository(getSql(config));
    const consentRepo = deps?.consentRepo ?? new ConsentRepository(getSql(config));
    const processingRepo = deps?.processingRepo ?? new ProcessingRecordRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));
    // Motor de borrado atomico (datos) + borrado opcional de auth.users. authDeleter es null si
    // SERVICE_ROLE_KEY no esta configurada (el motor lo reporta como 'not_configured' sin romper).
    const accountDeletion: AccountDeletionService =
      deps?.accountDeletion ??
      (() => {
        const accountRepo = new AccountDeletionRepository(getSql(config));
        const authDeleter = createSupabaseAuthUserDeleter(config);
        return {
          deleteAccount: (ownerId, opts) =>
            deleteAccount({
              ownerId,
              deleteAuthUser: opts.deleteAuthUser,
              repo: accountRepo,
              authDeleter,
              logger: app.log,
            }),
        };
      })();

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

    // Resolucion admin de una solicitud (super-admin). Con `erase` sobre una 'erasure', dispara el motor
    // de borrado ATOMICO del titular; sin `erase`, solo cambia el estado.
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

        // PATH DE BORRADO (erasure + erase=true): el motor atomico borra/anonimiza TODAS las tablas del
        // titular EN UNA transaccion -- incluida la propia data_subject_requests. Es una SOLA operacion
        // atomica: ya NO hay "borrado suelto + updateStatus" (la doble-no-atomicidad de H-01). Como la
        // solicitud se borra con el resto, no se llama updateStatus; la respuesta refleja el resultado.
        if (parsed.data.erase === true && existing.requestType === 'erasure') {
          const result = await accountDeletion.deleteAccount(existing.ownerId, {
            deleteAuthUser: parsed.data.delete_auth_user === true,
          });
          return reply.send({
            requestErased: true,
            erased: result.data,
            authUser: result.authUser,
          });
        }

        // PATH DE ESTADO (resto de tipos, o erasure sin erase): solo cambia el estado + nota.
        const note = parsed.data.resolution_note ?? null;
        const updated = await requestRepo.updateStatus(params.data.id, parsed.data.status, note);
        if (!updated) throw new AppError('NOT_FOUND', 404, 'Data request not found');
        return reply.send({ request: updated });
      },
    );
  };
}
