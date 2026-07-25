import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import {
  POLITICA_EJECUCION_DEFAULT,
  PoliticasEjecucionRepository,
  type PoliticaEjecucion,
} from '../politicas/politicas-ejecucion-repository.js';

/**
 * POLITICA DE EJECUCION (V034): la cara HTTP de los tres ajustes que el usuario configura UNA sola
 * vez y que deciden si una accion que no se puede deshacer se ejecuta o se detiene. El worker lee la
 * misma fila al iniciar cada tarea web.
 *
 * Garantias:
 *  - El owner SIEMPRE sale del token (requireUser). El body NUNCA trae owner: no hay forma de leer
 *    ni de escribir la politica de otro usuario aunque se envie un owner_id inventado.
 *  - GET sin fila devuelve los DEFAULTS y `configurada: false`, y NO crea nada: leer no escribe.
 *  - El tope se valida server-side (numero finito, >= 0 y acotado) y los dominios se normalizan;
 *    el cliente no puede guardar un tope raro que despues rompa la comparacion del worker.
 */

/** Techo del tope configurable (MXN). Cota defensiva: por encima el limite deja de ser un limite. */
const MAX_TOPE_MXN = 10_000_000;

/** Cotas de la lista de dominios excluidos (una lista, no un catalogo). */
const MAX_SITIOS_EXCLUIDOS = 50;
const MAX_DOMINIO_CHARS = 253;

/**
 * Dominio valido y ya normalizado (minusculas, sin protocolo, sin path ni puerto). Se compara contra
 * el `dominio` de sitios_conectados, que se guarda con el mismo formato.
 */
const DOMINIO_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Normaliza lo que el usuario escribio en el campo de dominios: acepta que pegue una URL completa o
 * que agregue espacios/mayusculas. Cualquier cosa que no quede como un dominio valido se RECHAZA
 * (400) en vez de guardarse a medias: un dominio mal guardado seria una exclusion que no protege.
 */
function normalizarDominio(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

const PoliticaBodySchema = z.object({
  ejecutarAccionesIrreversibles: z.boolean(),
  topeMontoSinConfirmacion: z.number().finite().min(0).max(MAX_TOPE_MXN),
  sitiosExcluidos: z.array(z.string().min(1).max(MAX_DOMINIO_CHARS)).max(MAX_SITIOS_EXCLUIDOS),
});

/** DTO publico (camelCase; sin owner: siempre es el que consulta). */
function toPoliticaDto(politica: PoliticaEjecucion | null) {
  if (politica === null) {
    return { ...POLITICA_EJECUCION_DEFAULT, configurada: false };
  }
  return {
    ejecutarAccionesIrreversibles: politica.ejecutarAccionesIrreversibles,
    topeMontoSinConfirmacion: politica.topeMontoSinConfirmacion,
    sitiosExcluidos: politica.sitiosExcluidos,
    configurada: true,
  };
}

export function politicasEjecucionRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    politicasRepo?: Pick<PoliticasEjecucionRepository, 'obtenerPorOwner' | 'guardar'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const politicasRepo = deps?.politicasRepo ?? new PoliticasEjecucionRepository(getSql(config));

    // La politica del usuario actual. Sin fila configurada devuelve los defaults (y no crea nada).
    app.get('/v1/politicas-ejecucion', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const politica = await politicasRepo.obtenerPorOwner(user.id);
      return reply.send({ politica: toPoliticaDto(politica) });
    });

    // Guarda los tres ajustes. Reemplaza la politica completa (no hay parches parciales: son tres
    // ajustes que el usuario ve juntos en una sola pantalla).
    app.put('/v1/politicas-ejecucion', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const body = PoliticaBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid body', body.error.issues);
      }
      const dominios: string[] = [];
      for (const crudo of body.data.sitiosExcluidos) {
        const dominio = normalizarDominio(crudo);
        if (!DOMINIO_REGEX.test(dominio) || dominio.length > MAX_DOMINIO_CHARS) {
          throw new AppError('VALIDATION_ERROR', 400, `Dominio invalido: ${crudo.slice(0, 80)}`);
        }
        if (!dominios.includes(dominio)) dominios.push(dominio);
      }
      const politica = await politicasRepo.guardar(user.id, {
        ejecutarAccionesIrreversibles: body.data.ejecutarAccionesIrreversibles,
        topeMontoSinConfirmacion: body.data.topeMontoSinConfirmacion,
        sitiosExcluidos: dominios,
      });
      return reply.send({ politica: toPoliticaDto(politica) });
    });
  };
}
