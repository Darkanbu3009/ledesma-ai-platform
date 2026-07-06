import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { AgentRunRepository } from '../agents/run-repository.js';
import { ScheduledTaskRepository } from '../scheduling/scheduled-tasks-repository.js';
import { TriggersRepository } from '../triggers/triggers-repository.js';
import { RecipeRepository } from '../recipes/recipes-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireAdminRole } from '../auth/require-admin-role.js';
import {
  DashboardQuerySchema,
  buildDashboardSummary,
  resolveRange,
  type DashboardSummaryRepos,
} from '../dashboard/summary.js';

// Paginacion del listado: 50 es el TECHO duro por pagina (cota defensiva contra scans grandes) y 20 el
// tamano por defecto, mismos numeros que el resto de los listados (jobs). Se acota server-side: el cliente
// no puede pedir mas de 50.
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Cota de longitud del termino de busqueda (defensiva, no funcional): un search enorme no aporta.
const MAX_SEARCH = 200;

// Querystring: paginacion + busqueda opcional. limit/offset llegan como strings, por eso z.coerce; ambos
// con default y acotados (limit 1..50, offset >= 0). search se trimea y se acota; vacio -> sin filtro (se
// normaliza en el handler para no responder 400 cuando la UI limpia el buscador).
const ListUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().max(MAX_SEARCH).optional(),
});

// El :id de la ficha/actividad es un usuario OBJETIVO arbitrario que se usa SERVER-SIDE como owner. Se
// valida como uuid (mismo criterio que el resto de los :id del backend, p.ej. credentials/recipes): un id
// mal formado se rechaza con 400 ANTES de tocar ningun repo. La validacion corre DESPUES del gate admin,
// asi que un no-admin nunca llega a ver un 400 (siempre 403): el poder cross-owner es exclusivo de admins.
const UserIdParamSchema = z.object({ id: z.string().uuid() });

/**
 * PANEL DE ADMIN (solo lectura), gateado por ROL (requireAdminRole): un no-admin recibe 403, sin JWT 401.
 * Reune las tres lecturas del panel de usuarios a nivel PLATAFORMA:
 *   - GET /v1/admin/users            -> LISTA paginada de todos los usuarios (con email del join).
 *   - GET /v1/admin/users/:id        -> FICHA de un usuario objetivo (profile+email+subscription+usage).
 *   - GET /v1/admin/users/:id/activity -> ACTIVIDAD del usuario objetivo (los tres ejes del dashboard).
 *
 * A diferencia de los demas endpoints admin (que usan requireAdmin por x-admin-token, un secreto compartido
 * sin actor), este usa el gate por ROL (JWT -> profiles.is_admin server-side), que es atribuible a un sub.
 * NO aisla por owner: el admin ve/consulta a CUALQUIERA; la proteccion es el gate, no un filtro de
 * pertenencia. El :id de la ficha/actividad es poder cross-owner POR DISENO, confinado por el gate admin.
 * El email se lee del join a auth.users con el rol de servicio.
 *
 * READ-ONLY puro: no muta nada y por eso NO registra audit log (el audit es para mutaciones). La FICHA reusa
 * la variante admin de loadState (RegistrationRepository.getUserDetail) y la ACTIVIDAD reusa la agregacion
 * compartida del dashboard (buildDashboardSummary) con ownerId=:id, SIN tocar el route /v1/dashboard del
 * usuario. Permite inyectar el verifier y los repos en tests (sin red ni DB), mismo patron que dashboard.ts.
 */
export function adminUsersRoutes(
  config: Env,
  // Los repos por owner de la actividad se toman del contrato compartido (DashboardSummaryRepos), el mismo
  // que consume buildDashboardSummary, para no repetir aca la lista de Pick. Partial: se inyectan en tests
  // y se construyen por defecto en produccion.
  deps?: {
    verifier?: JwtVerifier;
    repo?: Pick<RegistrationRepository, 'isAdmin' | 'listUsers' | 'getUserDetail'>;
    /** Reloj inyectable para el default de rango de la actividad (tests deterministas). Ausente -> Date real. */
    now?: () => Date;
  } & Partial<DashboardSummaryRepos>,
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const repo = deps?.repo ?? new RegistrationRepository(getSql(config));
    const runRepo = deps?.runRepo ?? new AgentRunRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const scheduledRepo = deps?.scheduledRepo ?? new ScheduledTaskRepository(getSql(config));
    const triggersRepo = deps?.triggersRepo ?? new TriggersRepository(getSql(config));
    const recipesRepo = deps?.recipesRepo ?? new RecipeRepository(getSql(config));
    const clock = deps?.now ?? (() => new Date());

    // Lista todos los usuarios de la plataforma (mas nuevos primero), paginado y con busqueda opcional.
    app.get('/v1/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
      // Gate por ROL: 401 sin/invalido JWT, 403 si el sub no es super-admin. Se valida ANTES de tocar
      // el querystring o el repo de datos.
      await requireAdminRole(request, verifier, repo);

      const parsed = ListUsersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid query', parsed.error.issues);
      }
      const { limit, offset } = parsed.data;
      // Vacio o solo espacios (ya trimeado) -> sin filtro, no un search por cadena vacia.
      const search =
        parsed.data.search !== undefined && parsed.data.search !== '' ? parsed.data.search : undefined;

      const { users, total } = await repo.listUsers({ limit, offset, search });
      return reply.send({
        users,
        pagination: {
          limit,
          offset,
          total,
          // Con el total exacto del count(*) over(), hasMore es preciso: hay mas si aun no llegamos al final.
          hasMore: offset + users.length < total,
        },
      });
    });

    // FICHA de un usuario objetivo: profile (con is_admin) + email + subscription + usageCounter. 404 si no
    // existe. Read-only, leido server-side con el rol de servicio (reusa la variante admin de loadState).
    app.get(
      '/v1/admin/users/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        // Gate primero: un no-admin recibe 403 sin importar si el :id es valido (nunca un 400 revelador).
        await requireAdminRole(request, verifier, repo);

        const parsed = UserIdParamSchema.safeParse(request.params);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid user id', parsed.error.issues);
        }

        const detail = await repo.getUserDetail(parsed.data.id);
        if (detail === null) {
          throw new AppError('NOT_FOUND', 404, 'User not found');
        }
        return reply.send(detail);
      },
    );

    // ACTIVIDAD del usuario objetivo: los tres ejes del dashboard (actividad, operaciones, gasto) PERO con
    // ownerId=:id. Reusa la agregacion compartida (buildDashboardSummary) sin duplicar buildSpend y sin
    // tocar el route /v1/dashboard del usuario. Rango ?from/?to opcional (default 30 dias), como el dashboard.
    app.get(
      '/v1/admin/users/:id/activity',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        // Gate primero (403 no-admin / 401 sin JWT) antes de validar el :id o el rango.
        await requireAdminRole(request, verifier, repo);

        const parsedParams = UserIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid user id', parsedParams.error.issues);
        }
        const parsedQuery = DashboardQuerySchema.safeParse(request.query);
        if (!parsedQuery.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid dashboard range', parsedQuery.error.issues);
        }
        const range = resolveRange(parsedQuery.data, clock());

        // El owner es el :id objetivo (poder cross-owner confinado por el gate admin). La agregacion es la
        // MISMA que la del dashboard del usuario; solo cambia de quien es el resumen.
        const summary = await buildDashboardSummary(
          { runRepo, jobsRepo, scheduledRepo, triggersRepo, recipesRepo },
          parsedParams.data.id,
          range,
        );
        return reply.send(summary);
      },
    );
  };
}
