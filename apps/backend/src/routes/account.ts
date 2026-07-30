import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { AccountDeletionRepository } from '../account/account-deletion-repository.js';
import {
  createSupabaseAuthUserDeleter,
  createSupabaseScreenshotDeleter,
} from '../account/supabase-admin.js';
import { deleteAccount, type DeleteAccountResult } from '../account/account-deletion-service.js';

/**
 * CONFIRMACION FUERTE del borrado self-service: el usuario debe ESCRIBIR su propio email en el body.
 * Schema ESTRECHO de un unico campo whitelisted -> cualquier otra clave del body (ownerId/userId/...) se
 * DESCARTA en el parseo (zod no la incluye en data) y por tanto JAMAS puede influir en a quien se borra.
 * El owner SIEMPRE sale del token; el body solo aporta la confirmacion de intencion, nunca una identidad.
 */
const DeleteAccountBodySchema = z.object({
  confirmEmail: z.string().min(1).max(320),
});

/** Normaliza un email para comparar la confirmacion contra el del token: recorta y baja a minusculas. */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Servicio de borrado de cuenta inyectable (motor de datos atomico + borrado opcional de auth.users).
 * MISMA forma que el que usa el flujo admin de erasure ARCO (routes/data-requests.ts): ambos ENVUELVEN el
 * mismo `deleteAccount` de #151. Se define aqui (no se importa de data-requests) para mantener este
 * endpoint DELIBERADAMENTE AISLADO: una ruta no depende de otra; solo comparten el motor.
 */
export interface AccountDeletionService {
  deleteAccount(ownerId: string, opts: { deleteAuthUser: boolean }): Promise<DeleteAccountResult>;
}

/**
 * Endpoint SELF-SERVICE para que el usuario borre SU PROPIA cuenta: DELETE /v1/me con requireUser.
 *
 * A DIFERENCIA del erasure ARCO admin (que por default CONSERVA la identidad, deleteAuthUser=false), el
 * borrado self-service es TOTAL: borra los datos (Postgres, atomico) Y la identidad (auth.users). Es la
 * via del USUARIO sobre su propia cuenta; el owner es SIEMPRE el sub del token, JAMAS del body.
 *
 * BARRERA DE INTENCION (irreversible): el usuario debe escribir su propio email en `confirmEmail`. El
 * backend lo compara (normalizado: trim + lowercase) contra el email del TOKEN (fuente de verdad, viene
 * del JWT verificado). Si NO coincide -> 400 SIN tocar nada (el motor no se invoca). Es la barrera contra
 * clics accidentales y peticiones sin intencion real.
 *
 * SESION: el JWT es stateless; el backend NO puede invalidar la sesion. Tras el borrado exitoso, el
 * cliente debe cerrar sesion (signOut) -- eso es responsabilidad de la UI (pieza siguiente). El endpoint
 * SOLO borra.
 *
 * RATE LIMITING: el limitador global (plugins/security.ts, @fastify/rate-limit) ya aplica a esta ruta
 * como a todas -> proteccion basica contra abuso sin sobre-construir. La confirmacion por email es la
 * barrera de intencion primaria.
 *
 * IDEMPOTENCIA / DOBLE LLAMADA: es SEGURA por construccion. El motor es idempotente -- sus DELETE van
 * acotados por owner_id, asi que una segunda pasada toca 0 filas sin efecto. Ademas, tras el borrado la UI
 * cierra sesion (signOut) y descarta el token, por lo que una llamada POSTERIOR llega sin Authorization y
 * da 401. OJO (semantica honesta): el JWT es STATELESS -- un access token AUN VIGENTE sigue verificando
 * aunque auth.users ya no exista (Supabase no revoca los tokens ya emitidos), asi que la seguridad de un
 * doble-clic la garantiza la IDEMPOTENCIA del motor, NO una invalidacion del token. Un re-borrado
 * redundante dentro de esa ventana puede devolver authUser:'failed' (auth.users ya no estaba): es honesto
 * (los datos ya se habian ido) y no indica corrupcion. No hace falta logica extra en el endpoint.
 *
 * Permite inyectar el verifier y el servicio de borrado en tests (mismo patron que data-requests.ts).
 */
export function accountRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    accountDeletion?: AccountDeletionService;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    // Motor de borrado atomico (datos) + borrado de auth.users. authDeleter es null si SERVICE_ROLE_KEY
    // no esta configurada -> el motor lo reporta como 'not_configured' (datos borrados, identidad huerfana
    // logueada) sin romper. MISMO cableado que el flujo admin; ambos reusan `deleteAccount` de #151.
    const accountDeletion: AccountDeletionService =
      deps?.accountDeletion ??
      (() => {
        const accountRepo = new AccountDeletionRepository(getSql(config));
        const authDeleter = createSupabaseAuthUserDeleter(config);
        const screenshotDeleter = createSupabaseScreenshotDeleter(config);
        return {
          deleteAccount: (ownerId, opts) =>
            deleteAccount({
              ownerId,
              deleteAuthUser: opts.deleteAuthUser,
              repo: accountRepo,
              authDeleter,
              screenshotDeleter,
              logger: app.log,
            }),
        };
      })();

    // Borra la PROPIA cuenta del usuario autenticado. owner = sub del token (jamas del body).
    app.delete('/v1/me', async (request: FastifyRequest, reply: FastifyReply) => {
      // (1) requireUser: sin sesion valida -> 401. Da el owner (user.id) y el email del token.
      const user = await requireUser(request, verifier);

      // (2) Body: solo `confirmEmail`. Malformado o ausente -> 400 (nada se borra).
      const parsed = DeleteAccountBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid delete account body', parsed.error.issues);
      }

      // (3) CONFIRMACION FUERTE: el email escrito debe coincidir con el del TOKEN (ambos normalizados).
      //     El token SIN email utilizable no puede confirmar nada -> 400. "Sin email utilizable" incluye
      //     null Y la cadena vacia/en blanco: jwt-verifier deja email='' (no null) cuando el claim `email`
      //     del JWT viene vacio (p.ej. usuarios por telefono/anonimos en Supabase), y '' normaliza a ''.
      //     Si NO se cubriera ese caso, un token con email vacio + una confirmacion en blanco (que tambien
      //     normaliza a '') "coincidirian" y borrarian la cuenta sin intencion real -> se rechaza aqui.
      //     Mismatch -> 400. En AMBOS casos el motor NO se invoca y NADA se borra (barrera de intencion).
      const tokenEmail = user.email !== null ? normalizeEmail(user.email) : null;
      if (tokenEmail === null || tokenEmail === '') {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'el token no incluye un email con el que confirmar el borrado',
        );
      }
      // tokenEmail ya es NO vacio: una confirmacion en blanco (normaliza a '') jamas coincide -> 400.
      if (normalizeEmail(parsed.data.confirmEmail) !== tokenEmail) {
        throw new AppError('VALIDATION_ERROR', 400, 'el email de confirmacion no coincide');
      }

      // (4) Solo si coincide: borra los datos (atomico) Y la identidad (auth.users), SIEMPRE para el
      //     owner del token. Si deleteAccountData lanza (rollback), se propaga -> el error-handler global
      //     responde 500 y lo loguea: la cuenta quedo INTACTA (atomicidad) y el usuario puede reintentar.
      const result = await accountDeletion.deleteAccount(user.id, { deleteAuthUser: true });

      // (5) RESPUESTA HONESTA segun la semantica cross-sistema del motor. Si llegamos aqui, los DATOS
      //     personales ya se borraron (deleteAccountData tuvo exito; si no, habria lanzado). `authUser`
      //     refleja que paso con la identidad:
      //       - 'deleted'        -> cuenta borrada por completo (datos + identidad).
      //       - 'not_configured' -> datos borrados; auth.users no se pudo tocar (SERVICE_ROLE_KEY ausente).
      //       - 'failed'         -> datos borrados; el borrado de auth.users fallo (identidad huerfana ya
      //                             logueada por el motor para reintento manual). NO se finge exito total
      //                             ni se revierten los datos (irreversible; el cumplimiento ya se cumplio).
      //     En los tres casos la cuenta del usuario esta borrada (sus datos se fueron): el cliente debe
      //     cerrar sesion. 204/404/410 no aplican (respondemos con cuerpo para reportar `authUser`; el
      //     usuario existe -- es quien llama). 'skipped' es imposible aqui (siempre pedimos deleteAuthUser).
      return reply.status(200).send({
        accountDeleted: true,
        authUser: result.authUser,
        data: result.data,
      });
    });
  };
}
