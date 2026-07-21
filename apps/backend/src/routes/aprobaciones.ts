import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import {
  AprobacionesWebRepository,
  type AprobacionWeb,
} from '../aprobaciones/aprobaciones-repository.js';

/**
 * CHECKPOINTS DE APROBACION HUMANA de tareas web (Fase 7.1e): la cara HTTP de aprobaciones_web
 * (V027). El worker crea el checkpoint y PAUSA el job; aca el humano lo lista, lo aprueba o lo
 * rechaza, y la decision devuelve el job a 'pending' para que el worker reanude LA MISMA sesion.
 *
 * Garantias:
 *  - Scoped por requireUser: el owner_id SIEMPRE sale del token, nunca del cliente.
 *  - La decision es COMPARE-AND-SET en el repositorio ('pendiente' y no expirada): un doble click,
 *    una carrera con el barrido de expiradas o un replay reciben 409, jamas una doble decision.
 *  - TODA decision registra su intervencion Art.22 (intervenciones_art22): quien, cuando y que vio.
 *  - Este backend NUNCA ejecuta la accion: solo registra la decision. El unico camino que ejecuta
 *    una accion financiera es el worker reanudando con una aprobacion en estado 'aprobada'.
 */

const MAX_INSTRUCCION_CHARS = 2_000;

const AprobacionIdParamSchema = z.object({ id: z.string().uuid() });

const ListarQuerySchema = z.object({
  estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'expirada']).optional(),
});

const RechazarBodySchema = z.object({
  instruccion: z.string().trim().min(1).max(MAX_INSTRUCCION_CHARS).optional(),
});

/** DTO publico de una aprobacion (camelCase; sin owner: siempre es el que consulta). */
function toAprobacionDto(a: AprobacionWeb) {
  return {
    id: a.id,
    jobId: a.jobId,
    connectionId: a.connectionId,
    accionTipo: a.accionTipo,
    descripcion: a.descripcion,
    screenshotPath: a.screenshotPath,
    estado: a.estado,
    instruccionRechazo: a.instruccionRechazo,
    decididaEn: a.decididaEn,
    creadaEn: a.creadaEn,
    expiraEn: a.expiraEn,
  };
}

export function aprobacionesRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    aprobacionesRepo?: Pick<
      AprobacionesWebRepository,
      'listarPorOwner' | 'decidir' | 'registrarIntervencion'
    >;
    jobsRepo?: Pick<JobsRepository, 'reanudarDePausado'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const aprobacionesRepo = deps?.aprobacionesRepo ?? new AprobacionesWebRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));

    /**
     * Aplica una decision con el CAS del repositorio, registra la intervencion Art.22 y devuelve el
     * job pausado a 'pending' para que el worker reanude. El registro Art.22 va ANTES de reanudar:
     * un job jamas se reanuda sin la constancia de quien decidio y que vio.
     */
    async function decidir(
      request: FastifyRequest,
      estado: 'aprobada' | 'rechazada',
      instruccion?: string,
    ): Promise<{ aprobacion: ReturnType<typeof toAprobacionDto>; jobReanudado: boolean }> {
      const user = await requireUser(request, verifier);
      const params = AprobacionIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid approval id', params.error.issues);
      }

      const aprobacion = await aprobacionesRepo.decidir(params.data.id, user.id, {
        estado,
        decididaPor: user.id,
        instruccion: instruccion ?? null,
      });
      if (!aprobacion) {
        // Inexistente/ajena, ya decidida o expirada: el CAS no distingue y no hace falta (en ningun
        // caso hay nada que decidir). 409 con mensaje accionable.
        throw new AppError(
          'CONFLICT',
          409,
          'La aprobacion no existe, ya fue decidida o expiro; refresca la lista',
        );
      }

      await aprobacionesRepo.registrarIntervencion({
        ownerId: user.id,
        aprobacionId: aprobacion.id,
        decision: estado,
        decididaPor: user.id,
        descripcion: aprobacion.descripcion,
        screenshotPath: aprobacion.screenshotPath,
        instruccion: instruccion ?? null,
      });

      const jobReanudado = await jobsRepo.reanudarDePausado(aprobacion.jobId, user.id);
      if (!jobReanudado) {
        request.log.warn(
          { aprobacionId: aprobacion.id, jobId: aprobacion.jobId },
          'aprobacion decidida pero el job no estaba pausado (no se reanudo)',
        );
      }
      return { aprobacion: toAprobacionDto(aprobacion), jobReanudado };
    }

    // Lista las aprobaciones del owner (mas nuevas primero), filtrables por estado. La consola
    // consulta ?estado=pendiente en polling para el banner/modal.
    app.get('/v1/aprobaciones', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = ListarQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid query', parsed.error.issues);
      }
      const aprobaciones = await aprobacionesRepo.listarPorOwner(user.id, parsed.data.estado);
      return reply.send({ aprobaciones: aprobaciones.map(toAprobacionDto) });
    });

    // Aprueba: la accion pendiente queda AUTORIZADA y el worker reanuda la misma sesion y la ejecuta.
    app.post(
      '/v1/aprobaciones/:id/aprobar',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const resultado = await decidir(request, 'aprobada');
        return reply.send(resultado);
      },
    );

    // Rechaza. Sin instruccion: la tarea aborta limpia. Con instruccion: la tarea continua con ese
    // ajuste como mensaje del usuario, SIN ejecutar la accion original.
    app.post(
      '/v1/aprobaciones/:id/rechazar',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = RechazarBodySchema.safeParse(request.body ?? {});
        if (!body.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid body', body.error.issues);
        }
        const resultado = await decidir(request, 'rechazada', body.data.instruccion);
        return reply.send(resultado);
      },
    );
  };
}
