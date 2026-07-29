import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { esDominioDePaso } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { requireAdmin } from '../auth/require-admin.js';
import { AprendizajeSitiosRepository } from '../aprendizaje-sitios/aprendizaje-sitios-repository.js';

/**
 * Administracion MINIMA del ATLAS DE SITIOS (V040): purgar por dominio todo lo que la plataforma
 * aprendio de la estructura de un sitio. Super-admin (x-admin-token), misma fuente unica de gate que
 * el resto de los endpoints admin.
 *
 * POR QUE EXISTE Y POR QUE ES LO UNICO QUE HAY: el atlas se alimenta solo y se corrige solo (cada
 * corrida exitosa reemplaza las estrategias de la estructura que observo). La palanca que NO se puede
 * resolver sola es "este dominio quedo mal aprendido, empieza de cero": un rediseno completo, un
 * sitio retirado, o una entrada que hay que borrar por una revision. Todo lo demas seria interfaz
 * sobre datos que no tienen dueno al que mostrarselos: esta fase NO expone UI de usuario.
 *
 * NO HAY endpoint de lectura a proposito. Listar el atlas no le sirve a nadie salvo para exponer la
 * estructura agregada; purgar es una operacion, leer seria una filtracion.
 */

const PurgaSchema = z.object({
  dominio: z.string().min(1).max(253),
});

export function adminAtlasSitiosRoutes(
  config: Env,
  deps?: {
    atlasRepo?: Pick<AprendizajeSitiosRepository, 'purgarDominio'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const atlasRepo = deps?.atlasRepo ?? new AprendizajeSitiosRepository(getSql(config));

    app.post('/v1/admin/atlas-sitios/purgar', async (request: FastifyRequest, reply: FastifyReply) => {
      requireAdmin(request, config);
      const parsed = PurgaSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid purge input', parsed.error.issues);
      }
      // MISMA definicion de dominio que usan los pasos de una receta (contrato de shared): hostname en
      // minusculas, sin esquema, sin puerto y sin barra. Sin esto, un `dominio` con comodines o con
      // una URL entera se aceptaria y borraria cero filas en silencio, que es el peor desenlace de una
      // operacion de purga (el operador cree que limpio y no limpio nada).
      const dominio = parsed.data.dominio.trim().toLowerCase();
      if (!esDominioDePaso(dominio)) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid domain');
      }
      const purgadas = await atlasRepo.purgarDominio(dominio);
      return reply.send({ dominio, purgadas });
    });
  };
}
