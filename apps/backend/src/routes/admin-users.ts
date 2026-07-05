import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireAdminRole } from '../auth/require-admin-role.js';

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

/**
 * PANEL DE ADMIN (solo lectura): GET /v1/admin/users lista a nivel PLATAFORMA todos los usuarios,
 * paginado, gateado por ROL (requireAdminRole). Es el PRIMER uso real del gate por rol del PR 1a en un
 * endpoint: un no-admin recibe 403, sin JWT 401.
 *
 * A diferencia de los demas endpoints admin (que usan requireAdmin por x-admin-token, un secreto
 * compartido sin actor), este usa el gate por ROL (JWT -> profiles.is_admin server-side), que es
 * atribuible a un sub. NO aisla por owner: el admin ve a TODOS; la proteccion es el gate, no un filtro
 * de pertenencia. El email se lee del join a auth.users con el rol de servicio (ver listUsers).
 *
 * READ-ONLY puro: no muta nada y por eso NO registra audit log (el audit es para mutaciones). Permite
 * inyectar el verifier y el repo en tests (sin red ni DB), mismo patron que jobs.ts.
 */
export function adminUsersRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    repo?: Pick<RegistrationRepository, 'isAdmin' | 'listUsers'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const repo = deps?.repo ?? new RegistrationRepository(getSql(config));

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
  };
}
