import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository, type JobSummary } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { AprobacionesWebRepository } from '../aprobaciones/aprobaciones-repository.js';

// Paginacion del historial: 50 es el TECHO duro por pagina (cota defensiva contra scans grandes) y 20
// el tamano por defecto. Se acota server-side: el cliente no puede pedir mas de 50.
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// last_error puede contener texto largo del modelo o stack traces (ver JobsRepository.markFailed). En el
// LISTADO se TRUNCA a un tamano legible: ver el detalle completo no es el objetivo de esta version de
// solo lectura, y evita volcar dato potencialmente sensible del proveedor a la UI.
const MAX_LAST_ERROR_CHARS = 500;

// Los estados de la cola (mismos que el CHECK de V008 + 'pausado' de V027). Literales para Zod.
const JobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'pausado']);

// Querystring del listado: filtro opcional por estado + paginacion. limit/offset llegan como strings del
// querystring, por eso z.coerce; ambos con default y acotados (limit <= 50, offset >= 0).
const JobIdParamSchema = z.object({ id: z.string().uuid() });

const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Trunca last_error a un largo razonable, marcando el recorte. null pasa tal cual (nunca fallo). */
function truncateError(text: string | null): string | null {
  if (text === null) return null;
  if (text.length <= MAX_LAST_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_LAST_ERROR_CHARS)}...`;
}

/**
 * DTO de una ejecucion para el historial (respuesta de GET /v1/jobs). Deriva del JobSummary del repo:
 * SIN el payload (dato sensible: mensajes del usuario / snapshots de recetas) y con last_error truncado.
 */
function toJobActivity(job: JobSummary) {
  return {
    id: job.id,
    type: job.type,
    agentId: job.agentId,
    status: job.status,
    attempts: job.attempts,
    lastError: truncateError(job.lastError),
    scheduledFor: job.scheduledFor,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/**
 * OBSERVABILIDAD de la ejecucion autonoma (solo lectura): GET /v1/jobs lista el historial de ejecuciones
 * del usuario autenticado (recetas, tareas programadas y triggers materializan jobs en la cola V008).
 * Scoped por requireUser: el owner_id SIEMPRE sale del token, nunca del cliente.
 *
 * SIN gate por tier: ver el historial PROPIO es para todos los planes. Los jobs solo existen si en algun
 * momento se tuvo el plan que los crea, pero mirar lo que ya corrio no es una funcion premium (a
 * diferencia de CREAR recetas/tareas, que si gatea por tier en sus rutas).
 *
 * NO expone el payload completo ni permite reintentar/borrar (eso es un PR futuro): es una vista de solo
 * lectura. Permite inyectar el verifier y el repo en tests (sin red ni DB en CI).
 */
export function jobsRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    jobsRepo?: Pick<JobsRepository, 'listByOwner' | 'getSummaryForOwner' | 'cancelarPorUsuario'>;
    aprobacionesRepo?: Pick<
      AprobacionesWebRepository,
      'cerrarPendientePorCancelacion' | 'registrarIntervencion'
    >;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const aprobacionesRepo = deps?.aprobacionesRepo ?? new AprobacionesWebRepository(getSql(config));

    // Lista el historial de ejecuciones del owner (mas nuevas primero), paginado y filtrable por estado.
    app.get('/v1/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const parsed = ListJobsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid query', parsed.error.issues);
      }
      const { limit, offset, status } = parsed.data;

      const jobs = await jobsRepo.listByOwner(user.id, { limit, offset, status });
      return reply.send({
        jobs: jobs.map(toJobActivity),
        pagination: {
          limit,
          offset,
          // Heuristica sin un count() extra: una pagina LLENA sugiere que puede haber mas. La UI la usa
          // para mostrar (o no) el boton "cargar mas".
          hasMore: jobs.length === limit,
        },
      });
    });

    // DETALLE de UN job del owner, para que la UI haga POLLING del estado de un job que ella misma
    // encolo (p.ej. conectar/confirmar/desconectar un sitio, 7.1c). MISMO DTO seguro que el listado
    // (sin payload, last_error truncado) y mismo aislamiento: un job ajeno o inexistente -> 404.
    app.get(
      '/v1/jobs/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = JobIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid job id', params.error.issues);
        }
        const job = await jobsRepo.getSummaryForOwner(params.data.id, user.id);
        if (!job) throw new AppError('NOT_FOUND', 404, 'Job not found');
        return reply.send({ job: toJobActivity(job) });
      },
    );

    // CANCELAR (terminar) un job PROPIO desde la consola. Solo acepta jobs del owner del token en
    // 'pending' | 'running' | 'pausado': el repositorio los cierra como 'failed' con el prefijo
    // CANCELADO_POR_USUARIO (D1: sin estado nuevo ni migracion) en un UPDATE atomico. Un job ya
    // terminado responde 409 sin efectos; uno ajeno o inexistente, 404 (jamas se toca ni se revela).
    // Si el job estaba 'pausado' (checkpoint de aprobacion), su aprobacion pendiente queda cerrada
    // como cancelada por el usuario (rechazada + marca) con su constancia Art.22; la sesion de
    // navegador que el checkpoint mantuvo viva la cierra el barrido del worker al reclamar la marca.
    // Un job 'running' lo detecta el propio worker en su siguiente latido y aborta la corrida.
    app.post(
      '/v1/jobs/:id/cancelar',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = JobIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid job id', params.error.issues);
        }

        const resultado = await jobsRepo.cancelarPorUsuario(params.data.id, user.id);
        if (resultado.resultado === 'no_encontrado') {
          throw new AppError('NOT_FOUND', 404, 'Job not found');
        }
        if (resultado.resultado === 'conflicto') {
          throw new AppError('CONFLICT', 409, 'La tarea ya termino; no hay nada que cancelar');
        }

        if (resultado.estadoPrevio === 'pausado') {
          const aprobacion = await aprobacionesRepo.cerrarPendientePorCancelacion(
            params.data.id,
            user.id,
            user.id,
          );
          if (aprobacion) {
            await aprobacionesRepo.registrarIntervencion({
              ownerId: user.id,
              aprobacionId: aprobacion.id,
              decision: 'rechazada',
              decididaPor: user.id,
              descripcion: aprobacion.descripcion,
              screenshotPath: aprobacion.screenshotPath,
              instruccion: aprobacion.instruccionRechazo,
            });
          }
        }

        const job = await jobsRepo.getSummaryForOwner(params.data.id, user.id);
        return reply.send({ job: job ? toJobActivity(job) : null });
      },
    );
  };
}
