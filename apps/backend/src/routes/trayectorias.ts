import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import {
  TrayectoriasWebRepository,
  type TrayectoriaConPasos,
  type PasoTrayectoria,
} from '../trayectorias/trayectorias-repository.js';

const ListQuerySchema = z.object({ jobId: z.string().uuid() });

/** DTO de un paso: lo que la UI muestra (accion, selector, url, exito), SIN ids internos de mas. */
function toPasoDto(paso: PasoTrayectoria) {
  return {
    idx: paso.idx,
    accion: paso.accion,
    selector: paso.selector,
    valorCensurado: paso.valorCensurado,
    url: paso.url,
    exito: paso.exito,
  };
}

/** DTO de una trayectoria con sus pasos. Sin owner (el aislamiento ya lo dio la query). */
function toTrayectoriaDto(t: TrayectoriaConPasos) {
  return {
    id: t.id,
    jobId: t.jobId,
    connectionId: t.connectionId,
    dominio: t.dominio,
    objetivo: t.objetivo,
    estado: t.estado,
    iniciadaEn: t.iniciadaEn,
    terminadaEn: t.terminadaEn,
    duracionMs: t.duracionMs,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    pasos: t.pasos.map(toPasoDto),
  };
}

/**
 * TRAYECTORIAS de tareas web (Fase F, V030), SOLO LECTURA: GET /v1/trayectorias?jobId=... devuelve
 * las ejecuciones del motor registradas para UN job del usuario, cada una con sus pasos censurados.
 * La pagina de actividad la usa para abrir una tarea web y ver que hizo el agente (accion, selector,
 * url, exito). NO hay promocion a receta ni replay aqui (paso 2, PR futuro).
 *
 * Scoped por requireUser: el owner_id SIEMPRE sale del token. Un job ajeno devuelve lista vacia (el
 * WHERE owner_id del repositorio no distingue "no existe" de "no es tuyo": misma respuesta). El
 * contenido ya viene CENSURADO desde el worker; este endpoint no re-censura ni expone nada extra.
 */
export function trayectoriasRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    trayectoriasRepo?: Pick<TrayectoriasWebRepository, 'listarPorJobConPasos'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const repo = deps?.trayectoriasRepo ?? new TrayectoriasWebRepository(getSql(config));

    app.get('/v1/trayectorias', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = ListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid query', parsed.error.issues);
      }
      const trayectorias = await repo.listarPorJobConPasos(parsed.data.jobId, user.id);
      return reply.send({ trayectorias: trayectorias.map(toTrayectoriaDto) });
    });
  };
}
