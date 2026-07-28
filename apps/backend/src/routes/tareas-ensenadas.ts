import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository, marcadoresDeParametros, tierAllowsAutonomy } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { TrayectoriasWebRepository } from '../trayectorias/trayectorias-repository.js';
import { RecetasWebRepository, type RecetaWeb } from '../recetas-web/index.js';
import {
  encolarGuardadoDeJob,
  type GuardarTareaAprendidaDeps,
} from '../recetas-web/guardar-tarea-aprendida.js';

const IdParamSchema = z.object({ id: z.string().uuid() });

// Body de POST /v1/tareas-ensenadas/desde-job: el job de tarea web cuyo exito se guarda.
const DesdeJobBodySchema = z.object({ jobId: z.string().uuid() });

/**
 * TAREAS QUE EL SISTEMA YA SABE HACER (recetas_web, V035 + V037), para la consola: listar lo que el
 * usuario enseno (o lo que el sistema aprendio solo de una corrida que salio bien) y BORRARLO.
 *
 * NO ES /v1/recipes (V013). Aquella son cadenas de instrucciones de texto para un agente
 * conversacional y tienen su propia pantalla, sus propias rutas y sus propios datos; esto es la traza
 * de localizacion y accion de una navegacion aprendida. Nombres distintos a proposito en toda la pila
 * (ver la cabecera de la migracion V035): esta ruta no toca `recipes` ni al reves.
 *
 * QUE SE EXPONE Y QUE NO. Viaja lo que la pantalla necesita para que una persona reconozca la tarea:
 * el sitio, lo que ella misma escribio al ensenarla, cuando fue, cuantas veces se uso y que datos hay
 * que darle. NO viajan los pasos: son el procedimiento interno (como se localiza cada elemento) y no
 * significan nada para quien no programa. Tampoco viaja el owner (siempre es el del token).
 *
 * PERTENENCIA SIEMPRE POR EL TOKEN (requireUser): el id del path no alcanza para leer ni borrar la
 * fila de otro dueno, porque toda query del repositorio va acotada por owner_id. Un id ajeno o
 * inexistente responde igual (404): esta ruta no distingue "no existe" de "no es tuya".
 */
function toTareaEnsenadaDto(receta: RecetaWeb) {
  return {
    id: receta.id,
    dominio: receta.dominio,
    // Lo que el usuario escribio al ensenarla. Sin texto suyo (recetas aprendidas solas o anteriores
    // a V037) viaja null y la consola lo resuelve con sus propias palabras: aqui no se inventa uno.
    descripcion: receta.descripcion,
    ensenadaEn: receta.creadaEn,
    usos: receta.ejecucionesExitosas,
    ultimoUsoEn: receta.ultimaEjecucionEn,
    // Cuantas veces se ajusto sola (auto reparacion, V038): la consola lo muestra como una linea
    // discreta. 0 en toda receta anterior a la migracion.
    ajustes: receta.ajustesAutomaticos,
    // Que datos hay que darle cada vez. Sale de los pasos (marcadoresDeParametros), que es la unica
    // fuente que no puede divergir de lo que la ejecucion va a pedir de verdad.
    datosQueNecesita: marcadoresDeParametros(receta.pasos),
  };
}

export function tareasEnsenadasRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    recetasRepo?: Pick<RecetasWebRepository, 'listarActivas' | 'borrar' | 'buscarPorTrayectorias'>;
    jobsRepo?: Pick<JobsRepository, 'getSummaryForOwner' | 'createJob' | 'buscarPromocionEnVuelo'>;
    trayectoriasRepo?: Pick<TrayectoriasWebRepository, 'listarPorJob'>;
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const repo = deps?.recetasRepo ?? new RecetasWebRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const trayectoriasRepo = deps?.trayectoriasRepo ?? new TrayectoriasWebRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    app.get('/v1/tareas-ensenadas', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const tareas = await repo.listarActivas(user.id);
      return reply.send({ tareas: tareas.map(toTareaEnsenadaDto) });
    });

    // GUARDAR COMO TAREA APRENDIDA (consentimiento explicito): convierte el exito de una tarea web
    // del motor libre en una receta. Solo ENCOLA (202 + jobId del job de promocion; el worker
    // convierte); la pertenencia es SIEMPRE por el token (un job ajeno responde 404, identico a uno
    // inexistente). Gate por tier igual que la grabacion: sembrar recetas es parte de la suite
    // autonoma. La promocion JAMAS es automatica por esta via: solo corre cuando el usuario la pide.
    app.post('/v1/tareas-ensenadas/desde-job', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const body = DesdeJobBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid request', body.error.issues);
      }
      const tier = await registrationRepo.getProfileTier(user.id);
      if (!tierAllowsAutonomy(tier)) {
        throw new AppError(
          'FORBIDDEN',
          403,
          'Saving a learned task requires a plan with autonomy (Pro or Business)',
        );
      }

      const servicio: GuardarTareaAprendidaDeps = {
        jobs: jobsRepo,
        trayectorias: trayectoriasRepo,
        recetas: repo,
      };
      const resultado = await encolarGuardadoDeJob(servicio, user.id, body.data.jobId);
      if (!resultado.encolado) {
        if (resultado.motivo === 'no_encontrado') {
          throw new AppError('NOT_FOUND', 404, 'Task not found');
        }
        // IDEMPOTENCIA: una tarea ya guardada responde el EXITO existente (200), no un conflicto.
        // Reintentar un guardado que ya ocurrio no es un error del usuario ni tiene arreglo posible;
        // la consola lo refleja como guardada sin encolar nada.
        if (resultado.motivo === 'ya_guardada') {
          return reply.send({ status: 'ya_guardada' });
        }
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'La tarea no es una tarea web exitosa del agente con registro para guardar',
        );
      }
      return reply.status(202).send({ status: 'accepted', jobId: resultado.jobId });
    });

    app.delete('/v1/tareas-ensenadas/:id', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = IdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid params', parsed.error.issues);
      }
      const borrada = await repo.borrar(parsed.data.id, user.id);
      if (!borrada) {
        throw new AppError('NOT_FOUND', 404, 'Tarea ensenada no encontrada');
      }
      return reply.code(204).send();
    });
  };
}
