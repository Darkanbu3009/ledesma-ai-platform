import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CONECTAR_SITIO_JOB_KIND,
  CONFIRMAR_CONEXION_JOB_KIND,
  DESCONECTAR_SITIO_JOB_KIND,
  JobsRepository,
  dominioDeUrl,
  parseSitioJobPayload,
  tierAllowsAutonomy,
} from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { SitiosConectadosRepository, type SitioConectado } from '../sitios/index.js';

const SitioIdParamSchema = z.object({ id: z.string().uuid() });

// Body de POST /v1/sitios/conectar: la URL de login es LA UNICA entrada humana del flujo. La forma
// completa (URL http(s) valida) la impone parseSitioJobPayload, el MISMO validador que consumira el
// worker: lo que se encola es exactamente lo que 7.1b sabe ejecutar.
const ConectarSitioBodySchema = z.object({ url: z.string().min(1).max(2000) });

/**
 * DTO de un sitio conectado para la UI (respuesta de GET /v1/sitios). Deriva del SitioConectado del
 * repo de 7.1a con SOLO lo que la pagina necesita: identidad (id/dominio), ciclo de vida (estado,
 * fechas) y la vistaEnVivoUrl del login EN CURSO (solo poblada en 'esperando_login'; confirmar y el
 * barrido la limpian). JAMAS viaja el contexto de sesion (ni cifrado ni en claro), ni los ids del
 * proveedor, ni la terna de red pineada: nada de eso es asunto del navegador del usuario.
 */
function toSitioDto(sitio: SitioConectado) {
  return {
    id: sitio.id,
    dominio: sitio.dominio,
    estado: sitio.estado,
    vistaEnVivoUrl: sitio.vistaEnVivoUrl,
    creadoEn: sitio.creadoEn,
    ultimoUsoEn: sitio.ultimoUsoEn,
  };
}

/**
 * SITIOS CONECTADOS (Fase 7.1c): los endpoints que la pagina "Sitios conectados" de la consola usa
 * para conectar, confirmar, listar y desconectar. NINGUNO ejecuta nada inline: conectar/confirmar/
 * desconectar solo ENCOLAN el job correspondiente de 7.1b (mismo JobsRepository.createJob que
 * recetas/scheduler/triggers, con agentId/credentialId NULOS por V026: estos jobs no ejecutan ningun
 * modelo) y responden 202 con el jobId para que el front haga polling (GET /v1/jobs/:id).
 *
 * PRINCIPIO NO NEGOCIABLE (espejo de 7.1a/7.1b): el login lo hace el USUARIO, no la plataforma. Por
 * aqui viaja UNA URL de login y NADA mas: no existe ningun campo de contrasena en ningun schema de
 * esta ruta, y la vista en vivo apunta DIRECTO al proveedor del navegador remoto -- lo que el usuario
 * teclea alli jamas pasa por este backend ni por este dominio.
 *
 * Reglas (espejo de recipes.ts):
 *  - GATE POR TIER server-side: la conexion de sitios es parte de la suite autonoma (el worker
 *    re-gatea al ejecutar; defensa en profundidad). Corre ANTES de revelar recursos.
 *  - PERTENENCIA: owner_id SIEMPRE del token (requireUser); un sitio ajeno/inexistente -> 404.
 *  - Deps inyectables (verifier/repos) para tests sin red ni DB, igual que el resto de las rutas.
 */
export function sitiosRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    sitiosRepo?: Pick<SitiosConectadosRepository, 'listarPorOwner' | 'obtenerPorId'>;
    jobsRepo?: Pick<JobsRepository, 'createJob'>;
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const sitiosRepo = deps?.sitiosRepo ?? new SitiosConectadosRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    /** Gate por tier compartido por las tres mutaciones (listar es de solo lectura y no gatea). */
    async function requireAutonomy(ownerId: string): Promise<void> {
      const tier = await registrationRepo.getProfileTier(ownerId);
      if (!tierAllowsAutonomy(tier)) {
        throw new AppError('FORBIDDEN', 403, 'Connected sites require a plan with autonomy (Pro or Business)');
      }
    }

    /** Resuelve el sitio del owner por el :id de la ruta. Invalido -> 400; ajeno/inexistente -> 404. */
    async function resolveSitioParam(
      request: FastifyRequest<{ Params: { id: string } }>,
      ownerId: string,
    ): Promise<SitioConectado> {
      const params = SitioIdParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid site id', params.error.issues);
      }
      const sitio = await sitiosRepo.obtenerPorId(params.data.id, ownerId);
      if (!sitio) throw new AppError('NOT_FOUND', 404, 'Site not found');
      return sitio;
    }

    // CONECTAR: encola kind:'conectar_sitio' con la URL que pego el usuario. El worker abre la sesion
    // de navegador y deja la fila en 'esperando_login' con la vista en vivo; el front hace polling del
    // job (GET /v1/jobs/:id) y de la lista hasta ver esa fila, y abre el modal de login.
    app.post('/v1/sitios/conectar', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const body = ConectarSitioBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid site url', body.error.issues);
      }
      // El payload se valida con el MISMO parser que usara el worker (URL http(s) bien formada): lo
      // que no pasaria en 7.1b no se encola. El rechazo es un 400 claro, no un job que morira.
      const parsed = parseSitioJobPayload({ kind: CONECTAR_SITIO_JOB_KIND, url: body.data.url });
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid site url', [{ message: parsed.error }]);
      }

      await requireAutonomy(user.id);

      const job = await jobsRepo.createJob({
        agentId: null,
        ownerId: user.id,
        credentialId: null,
        payload: parsed.data,
      });

      // 202: aceptado y encolado. El dominio derivado acompaña para que el front identifique la fila
      // que aparecera en la lista (la conexion es unica por owner+dominio).
      return reply.status(202).send({
        status: 'accepted',
        jobId: job.id,
        dominio: dominioDeUrl(body.data.url),
      });
    });

    // LISTAR: los sitios del owner, metadata minima para la lista de la UI. Sin gate por tier (ver lo
    // propio no es premium, igual que /v1/jobs) y, por diseno del repo de 7.1a, sin blobs ni contexto.
    app.get('/v1/sitios', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const sitios = await sitiosRepo.listarPorOwner(user.id);
      return reply.send({ sitios: sitios.map(toSitioDto) });
    });

    // CONFIRMAR: el usuario avisa que YA inicio sesion en la vista en vivo. Encola
    // kind:'confirmar_conexion'; el worker hereda el contexto, lo cifra y marca 'activo'.
    app.post(
      '/v1/sitios/:id/confirmar',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const sitio = await resolveSitioParam(request, user.id);

        // Confirmar solo tiene sentido con un login EN CURSO: en cualquier otro estado el job de 7.1b
        // fallaria si o si (PermanentExecutionError); mejor un 400 inmediato y claro que un job muerto.
        if (sitio.estado !== 'esperando_login') {
          throw new AppError('VALIDATION_ERROR', 400, 'Site has no login in progress');
        }

        const job = await jobsRepo.createJob({
          agentId: null,
          ownerId: user.id,
          credentialId: null,
          payload: { kind: CONFIRMAR_CONEXION_JOB_KIND, connectionId: sitio.id },
        });
        return reply.status(202).send({ status: 'accepted', jobId: job.id });
      },
    );

    // DESCONECTAR: encola kind:'desconectar_sitio' (el borrado ARCO: proveedor + constancia en
    // data_subject_requests + fila local). Es PERMANENTE; la UI pide confirmacion antes de llamar.
    app.delete(
      '/v1/sitios/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const sitio = await resolveSitioParam(request, user.id);

        const job = await jobsRepo.createJob({
          agentId: null,
          ownerId: user.id,
          credentialId: null,
          payload: { kind: DESCONECTAR_SITIO_JOB_KIND, connectionId: sitio.id },
        });
        return reply.status(202).send({ status: 'accepted', jobId: job.id });
      },
    );
  };
}
