import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GRABAR_TAREA_JOB_KIND,
  JobsRepository,
  MAX_DESCRIPCION_GRABACION_CHARS,
  PROMOVER_GRABACION_JOB_KIND,
  parseGrabacionJobPayload,
  tierAllowsAutonomy,
} from '@ledesma-platform/shared';
import { mintRelayToken } from '@ledesma-platform/shared/relay-token';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { SitiosConectadosRepository } from '../sitios/index.js';
import { GrabacionesRepository, type Grabacion } from '../grabaciones/index.js';

const GrabacionIdParamSchema = z.object({ id: z.string().uuid() });

// Body de POST /v1/grabaciones: la conexion sobre la que se graba y lo que el usuario va a ensenar,
// en lenguaje llano. NO hay ningun otro campo, y en particular NINGUNO de contrasena: la sesion ya
// esta establecida por el flujo de login existente y la grabacion no la toca.
const CrearGrabacionBodySchema = z.object({
  connectionId: z.string().uuid(),
  descripcion: z.string().trim().min(1).max(MAX_DESCRIPCION_GRABACION_CHARS),
});

// Body de POST /v1/grabaciones/:id/confirmar: que pasos son datos que cambian cada vez y de que tipo.
// Solo viajan indices y marcadores; el VALOR tecleado jamas sale de la fila (y se borra al promover).
const ConfirmarGrabacionBodySchema = z.object({
  variables: z
    .array(z.object({ idx: z.number().int().min(0), marcador: z.string() }))
    .max(200)
    .optional(),
});

/**
 * DTO de una grabacion para la consola. Deriva de la fila con SOLO lo que la pagina necesita: en que
 * estado esta, la vista en vivo mientras se graba, y los pasos para que el usuario marque que datos
 * cambian cada vez. JAMAS viaja el owner (siempre es el del token) ni nada de la sesion del sitio.
 */
function toGrabacionDto(grabacion: Grabacion) {
  return {
    id: grabacion.id,
    connectionId: grabacion.connectionId,
    dominio: grabacion.dominio,
    descripcion: grabacion.descripcion,
    estado: grabacion.estado,
    motivo: grabacion.motivo,
    vistaEnVivoUrl: grabacion.vistaEnVivoUrl,
    pasos: grabacion.pasos,
    creadaEn: grabacion.creadaEn,
    actualizadaEn: grabacion.actualizadaEn,
  };
}

/**
 * GRABACION DE TAREAS: los endpoints con los que la consola le ENSENA una tarea al sistema. El usuario
 * escribe en lenguaje llano que va a ensenar, hace la tarea el mismo en la vista en vivo, dice "ya
 * termine", marca que datos cambian cada vez y guarda; a partir de ahi el sistema repite esa tarea sin
 * volver a analizar el sitio.
 *
 * ES UNA VIA COMPLEMENTARIA, no un reemplazo: el agente sigue navegando libremente cualquier sitio
 * donde el usuario ya inicio sesion. Esto existe para sembrar el procedimiento donde el agente falla de
 * forma repetida y para arrancar sin depender de una primera corrida exitosa.
 *
 * INVARIANTE INNEGOCIABLE, aplicado aqui: una grabacion SOLO se abre sobre una conexion en estado
 * 'activo'. En 'esperando_login' (el usuario esta tecleando su contrasena en la vista en vivo del
 * login) se rechaza con 400: por esta ruta no se graba ningun login. Si aun asi apareciera un campo de
 * contrasena a mitad de la grabacion, el worker corta y descarta lo capturado.
 *
 * Reglas (espejo de sitios.ts): NINGUN endpoint ejecuta nada inline (crear y confirmar solo ENCOLAN el
 * job correspondiente y responden 202 con el jobId), gate por tier server-side antes de revelar nada,
 * pertenencia SIEMPRE por el owner del token, y deps inyectables para tests sin red ni DB.
 */
export function grabacionesRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    grabacionesRepo?: Pick<GrabacionesRepository, 'crear' | 'obtener' | 'terminar'>;
    sitiosRepo?: Pick<SitiosConectadosRepository, 'obtenerPorId'>;
    jobsRepo?: Pick<JobsRepository, 'createJob' | 'obtenerSesionDeGrabacion'>;
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const grabacionesRepo = deps?.grabacionesRepo ?? new GrabacionesRepository(getSql(config));
    const sitiosRepo = deps?.sitiosRepo ?? new SitiosConectadosRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    /** Gate por tier: ensenarle una tarea es parte de la suite autonoma, igual que conectar sitios. */
    async function requireAutonomy(ownerId: string): Promise<void> {
      const tier = await registrationRepo.getProfileTier(ownerId);
      if (!tierAllowsAutonomy(tier)) {
        throw new AppError('FORBIDDEN', 403, 'Teaching a task requires a plan with autonomy (Pro or Business)');
      }
    }

    /** Resuelve la grabacion del owner por el :id de la ruta. Invalido -> 400; ajena/inexistente -> 404. */
    async function resolveGrabacionParam(
      request: FastifyRequest<{ Params: { id: string } }>,
      ownerId: string,
    ): Promise<Grabacion> {
      const params = GrabacionIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid recording id', params.error.issues);
      }
      const grabacion = await grabacionesRepo.obtener(params.data.id, ownerId);
      if (!grabacion) throw new AppError('NOT_FOUND', 404, 'Recording not found');
      return grabacion;
    }

    // ABRIR: crea la fila en 'grabando' y encola kind:'grabar_tarea'. El worker abre la sesion de
    // navegador con el pais pineado y el contexto cifrado del sitio, publica la vista en vivo en la
    // fila y captura lo que el usuario hace. Sin agente ni credencial (V026): no ejecuta ningun modelo.
    app.post('/v1/grabaciones', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const body = CrearGrabacionBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid recording request', body.error.issues);
      }
      await requireAutonomy(user.id);

      const sitio = await sitiosRepo.obtenerPorId(body.data.connectionId, user.id);
      if (!sitio) throw new AppError('NOT_FOUND', 404, 'Site not found');
      // EL INVARIANTE: solo sobre un sitio YA ACTIVO. Un sitio en 'esperando_login' es exactamente la
      // pantalla donde el usuario teclea su contrasena, y ahi no se graba nada.
      if (sitio.estado !== 'activo') {
        throw new AppError('VALIDATION_ERROR', 400, 'Site is not connected');
      }

      const grabacion = await grabacionesRepo.crear({
        ownerId: user.id,
        connectionId: sitio.id,
        dominio: sitio.dominio,
        descripcion: body.data.descripcion,
      });

      // El payload se valida con el MISMO parser que usara el worker: lo que no pasaria alla no se
      // encola aqui.
      const parsed = parseGrabacionJobPayload({
        kind: GRABAR_TAREA_JOB_KIND,
        connectionId: sitio.id,
        grabacionId: grabacion.id,
      });
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid recording request', [
          { message: parsed.error },
        ]);
      }

      const job = await jobsRepo.createJob({
        agentId: null,
        ownerId: user.id,
        credentialId: null,
        payload: parsed.data,
      });
      return reply
        .status(202)
        .send({ status: 'accepted', jobId: job.id, grabacion: toGrabacionDto(grabacion) });
    });

    // LEER: la consola hace polling de esto para saber cuando aparece la vista en vivo, y despues para
    // traer los pasos capturados que el usuario tiene que revisar.
    app.get(
      '/v1/grabaciones/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const grabacion = await resolveGrabacionParam(request, user.id);
        return reply.send({ grabacion: toGrabacionDto(grabacion) });
      },
    );

    // TERMINAR: el usuario dice "ya termine". Es una transicion CONDICIONADA en la base; el worker lo
    // ve en su siguiente sondeo, cierra la captura y guarda los pasos. Una grabacion que ya no estaba
    // 'grabando' (terminada dos veces, o descartada por un campo de contrasena) responde 409.
    app.post(
      '/v1/grabaciones/:id/terminar',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const grabacion = await resolveGrabacionParam(request, user.id);
        const terminada = await grabacionesRepo.terminar(grabacion.id, user.id);
        if (!terminada) {
          throw new AppError('CONFLICT', 409, 'Recording is no longer in progress');
        }
        return reply.send({ status: 'ok' });
      },
    );

    // TOKEN DEL RELAY DE TECLADO MOVIL para la GRABACION (espejo de POST /v1/sitios/:id/relay-token):
    // la vista en vivo de la grabacion es el mismo screencast que la del login, asi que en tactil el
    // teclado nativo tampoco se levanta. Este endpoint ACUNA el mismo token efimero de un solo uso,
    // ligado a (owner, conexion, sesion del proveedor DE LA GRABACION); no releva nada ni habla con
    // Browserbase. La sesion viva la publico el worker como resultado intermedio del job
    // kind:'grabar_tarea' (jobs.resultado, V026), y se lee acotada por owner y solo con el job aun
    // corriendo. El relay no gana ningun privilegio: recibe la MISMA terna que en el login.
    app.post(
      '/v1/grabaciones/:id/relay-token',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const grabacion = await resolveGrabacionParam(request, user.id);

        // Solo tiene sentido con la grabacion EN CURSO y su vista en vivo ya publicada (la captura
        // instalada). En cualquier otro momento no hay sesion que relevar: 400 inmediato y claro.
        if (grabacion.estado !== 'grabando' || grabacion.vistaEnVivoUrl === null) {
          throw new AppError('VALIDATION_ERROR', 400, 'Recording has no live view in progress');
        }

        // Feature opcional: sin el secreto compartido o la URL publica del relay, el canal no existe.
        // La consola cae al aviso de "hazlo desde una computadora" (el flujo previo en tactil).
        if (config.RELAY_TOKEN_SECRET === undefined || config.RELAY_PUBLIC_URL === undefined) {
          throw new AppError('RELAY_NO_DISPONIBLE', 501, 'Assisted mobile keyboard relay is not configured');
        }

        const sesionExternaId = await jobsRepo.obtenerSesionDeGrabacion(grabacion.id, user.id);
        if (sesionExternaId === null) {
          throw new AppError('VALIDATION_ERROR', 400, 'Recording has no live view in progress');
        }

        const { token, expiresAt, bindingKey } = mintRelayToken(
          { ownerId: user.id, connectionId: grabacion.connectionId, sesionExternaId },
          config.RELAY_TOKEN_SECRET,
        );
        return reply.status(201).send({ token, expiresAt, relayUrl: config.RELAY_PUBLIC_URL, hs: bindingKey });
      },
    );

    // CONFIRMAR: el usuario ya marco que datos cambian cada vez. Encola kind:'promover_grabacion'; el
    // worker calcula la firma del objetivo con el MISMO mecanismo que la promocion automatica, borra de
    // la grabacion los valores marcados como variables y crea la receta.
    app.post(
      '/v1/grabaciones/:id/confirmar',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const grabacion = await resolveGrabacionParam(request, user.id);
        if (grabacion.estado !== 'terminada') {
          throw new AppError('VALIDATION_ERROR', 400, 'Recording is not ready to be saved');
        }
        const body = ConfirmarGrabacionBodySchema.safeParse(request.body ?? {});
        if (!body.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recording request', body.error.issues);
        }

        // El parser del payload es el MISMO que corre el worker: valida los marcadores contra el
        // vocabulario del contrato de recetas y rechaza indices repetidos.
        const parsed = parseGrabacionJobPayload({
          kind: PROMOVER_GRABACION_JOB_KIND,
          grabacionId: grabacion.id,
          variables: body.data.variables ?? [],
        });
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recording request', [
            { message: parsed.error },
          ]);
        }

        const job = await jobsRepo.createJob({
          agentId: null,
          ownerId: user.id,
          credentialId: null,
          payload: parsed.data,
        });
        return reply.status(202).send({ status: 'accepted', jobId: job.id });
      },
    );
  };
}
