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
import { mintRelayToken } from '@ledesma-platform/shared/relay-token';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { SitiosConectadosRepository, type SitioConectado } from '../sitios/index.js';

const SitioIdParamSchema = z.object({ id: z.string().uuid() });

// Querystring de DELETE /v1/sitios/:id: force=true pide el BORRADO FORZADO (garantizado). Solo el
// literal 'true' activa el modo; cualquier otro valor (ausente, 'false', basura) es el flujo
// limpio. Se acepta tambien la clave repetida (?force=true&force=true llega como array): una
// peticion que pidio force en cualquiera de sus valores JAMAS se degrada en silencio al flujo
// limpio.
const SitioDeleteQuerySchema = z.object({
  force: z.union([z.string(), z.array(z.string())]).optional(),
});

/** ¿La querystring pide el borrado forzado? true si CUALQUIER valor de force es el literal 'true'. */
function pideBorradoForzado(query: unknown): boolean {
  const parsed = SitioDeleteQuerySchema.safeParse(query);
  if (!parsed.success) return false;
  const force = parsed.data.force;
  if (force === undefined) return false;
  return Array.isArray(force) ? force.includes('true') : force === 'true';
}

// Body de POST /v1/sitios/conectar: la URL de login es LA UNICA entrada humana del flujo, mas el
// pais OPCIONAL que la consola deriva del navegador del usuario (Intl). La forma completa (URL
// http(s) valida + pais ISO-2) la impone parseSitioJobPayload, el MISMO validador que consumira el
// worker: lo que se encola es exactamente lo que 7.1b sabe ejecutar.
const ConectarSitioBodySchema = z.object({
  url: z.string().min(1).max(2000),
  pais: z.string().regex(/^[A-Za-z]{2}$/).optional(),
});

/**
 * Deriva el PAIS del usuario (ISO 3166-1 alpha-2) para pinear la salida de red de la conexion:
 * 1. el `pais` explicito del body (la consola manda el declarado en el perfil), o
 * 2. el pais DECLARADO en el perfil del usuario (profiles.pais, V029; la consola lo captura una vez
 *    antes de la primera conexion y es editable en la configuracion del perfil), o
 * 3. la region del primer tag de Accept-Language, completada con los likely subtags de CLDR via
 *    Intl.Locale#maximize (built-in de Node/ICU: 'es-AR' -> AR, 'en' -> US). Ultimo recurso
 *    best-effort para clientes sin perfil actualizado. Cero dependencias externas ni geo-IP.
 * null = no derivable: el endpoint responde 400 pidiendo declarar el pais, JAMAS pinea un default
 * silencioso (pinear el pais equivocado condena todas las tareas futuras del dominio).
 */
export function derivarPaisDeConexion(
  bodyPais: string | undefined,
  paisPerfil: string | null,
  acceptLanguage: string | undefined,
): string | null {
  if (bodyPais !== undefined) return bodyPais.toUpperCase();
  if (paisPerfil !== null && /^[A-Za-z]{2}$/.test(paisPerfil)) return paisPerfil.toUpperCase();
  const primerTag = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim();
  if (!primerTag) return null;
  try {
    const region = new Intl.Locale(primerTag).maximize().region;
    return region && /^[A-Z]{2}$/.test(region) ? region : null;
  } catch {
    return null;
  }
}

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
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier' | 'getProfilePais'>;
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
      // El pais que se pineara a la conexion: explicito del body, o el DECLARADO en el perfil (V029),
      // o derivado de Accept-Language como ultimo recurso. La lectura del perfil solo ocurre cuando el
      // body no lo trae. Sin pais NO se encola nada: pinear un default silencioso condenaria las
      // tareas del dominio. El rechazo lleva codigo propio (PAIS_REQUERIDO) y un mensaje accionable
      // para el usuario final en ES y EN (la consola ademas lo traduce por codigo): la solucion es
      // declarar el pais en el perfil, no un detalle tecnico del body.
      const paisPerfil = body.data.pais === undefined ? await registrationRepo.getProfilePais(user.id) : null;
      const pais = derivarPaisDeConexion(
        body.data.pais,
        paisPerfil,
        request.headers['accept-language'],
      );
      if (pais === null) {
        throw new AppError(
          'PAIS_REQUERIDO',
          400,
          'Indica tu pais en la configuracion de tu perfil para poder conectar sitios. / Set your country in your profile settings to connect sites.',
        );
      }

      // El payload se valida con el MISMO parser que usara el worker (URL http(s) bien formada +
      // pais ISO-2): lo que no pasaria en 7.1b no se encola. El rechazo es un 400 claro, no un job
      // que morira.
      const parsed = parseSitioJobPayload({ kind: CONECTAR_SITIO_JOB_KIND, url: body.data.url, pais });
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

    // TOKEN DEL RELAY DE TECLADO MOVIL (conocimiento minimo). SOLO en telefonos: cuando el cliente es
    // tactil, la vista en vivo del proveedor no levanta el teclado nativo, asi que el usuario teclea en
    // un campo propio de la consola y las pulsaciones se RELEVAN cifradas via el servicio relay hacia el
    // navegador remoto. Este endpoint NO releva nada ni habla con Browserbase: ACUNA un token efimero de
    // un solo uso, ligado a (owner, conexion, sesion del proveedor), con TTL corto. El SERVICIO RELAY lo
    // valida con el MISMO secreto; el backend jamas ve las pulsaciones ni la API key de Browserbase.
    //
    // El desktop NO usa esto: sigue con entrada directa al iframe (LoginEnVivoDialog). El endpoint es
    // agnostico del dispositivo (autoriza; no decide UI); es la consola la que solo lo invoca en tactil.
    app.post(
      '/v1/sitios/:id/relay-token',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const sitio = await resolveSitioParam(request, user.id);

        // El relay solo tiene sentido con un login EN CURSO y una sesion del proveedor viva. En
        // cualquier otro estado no hay nada que relevar: 400 inmediato y claro.
        if (sitio.estado !== 'esperando_login' || sitio.sesionExternaId === null) {
          throw new AppError('VALIDATION_ERROR', 400, 'Site has no login in progress');
        }

        // Feature opcional: sin el secreto compartido o la URL publica del relay, el canal no existe.
        // La consola cae al aviso de "hazlo desde una computadora" (el flujo previo en tactil).
        if (config.RELAY_TOKEN_SECRET === undefined || config.RELAY_PUBLIC_URL === undefined) {
          throw new AppError('RELAY_NO_DISPONIBLE', 501, 'Assisted mobile keyboard relay is not configured');
        }

        const { token, expiresAt } = mintRelayToken(
          { ownerId: user.id, connectionId: sitio.id, sesionExternaId: sitio.sesionExternaId },
          config.RELAY_TOKEN_SECRET,
        );

        // El token es la UNICA credencial del canal (un solo uso, TTL corto). relayUrl deja que la
        // consola descubra a donde conectar sin una env propia. Nada de esto es contenido de pulsaciones.
        return reply.status(201).send({ token, expiresAt, relayUrl: config.RELAY_PUBLIC_URL });
      },
    );

    // DESCONECTAR: encola kind:'desconectar_sitio' (el borrado ARCO: proveedor + constancia en
    // data_subject_requests + fila local). Es PERMANENTE; la UI pide confirmacion antes de llamar.
    // Con ?force=true es el BORRADO FORZADO: el worker degrada TODO fallo del proveedor a
    // best-effort y completa igual el ARCO y el borrado local (la salida garantizada para filas
    // atascadas cuya sesion/contexto remoto ya no responde).
    app.delete(
      '/v1/sitios/:id',
      async (
        request: FastifyRequest<{ Params: { id: string }; Querystring: { force?: string | string[] } }>,
        reply: FastifyReply,
      ) => {
        const user = await requireUser(request, verifier);
        await requireAutonomy(user.id);
        const sitio = await resolveSitioParam(request, user.id);
        const force = pideBorradoForzado(request.query);

        const job = await jobsRepo.createJob({
          agentId: null,
          ownerId: user.id,
          credentialId: null,
          payload: force
            ? { kind: DESCONECTAR_SITIO_JOB_KIND, connectionId: sitio.id, force: true }
            : { kind: DESCONECTAR_SITIO_JOB_KIND, connectionId: sitio.id },
        });
        return reply.status(202).send({ status: 'accepted', jobId: job.id });
      },
    );
  };
}
