import type { AccountDeletionRepository, AccountDataDeletionResult } from './account-deletion-repository.js';
import type { AuthUserDeleter } from './supabase-admin.js';

/**
 * Resultado del borrado de auth.users (paso cross-sistema, best-effort tras el borrado de datos):
 *   - 'deleted'        -> auth.users borrado con exito.
 *   - 'skipped'        -> no se pidio borrar auth.users (erasure ARCO por default conserva la identidad).
 *   - 'not_configured' -> se pidio, pero SUPABASE_SERVICE_ROLE_KEY no esta configurada: no se pudo borrar.
 *   - 'failed'         -> se pidio y se intento, pero el API fallo. LOS DATOS YA SE BORRARON (no se
 *                         revierten); queda un auth.users huerfano para reintento manual (se logueo).
 */
export type AuthUserDeletionOutcome = 'deleted' | 'skipped' | 'not_configured' | 'failed';

export interface DeleteAccountResult {
  /** Lo que borro/anonimizo el motor de datos (Postgres, atomico). */
  data: AccountDataDeletionResult;
  /** Que paso con auth.users (sistema aparte, sin atomicidad cross-sistema). */
  authUser: AuthUserDeletionOutcome;
}

/** Logger minimo compatible con app.log de Fastify/pino (obj primero, mensaje despues). */
interface DeletionLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface DeleteAccountParams {
  ownerId: string;
  /** Si true, tras borrar los datos se intenta borrar auth.users. Si false, se omite ('skipped'). */
  deleteAuthUser: boolean;
  repo: Pick<AccountDeletionRepository, 'deleteAccountData'>;
  /** Borrador de auth.users, o null si SERVICE_ROLE_KEY no esta configurada. */
  authDeleter: AuthUserDeleter | null;
  logger?: DeletionLogger;
}

/**
 * ORQUESTA el borrado de cuenta a traves de DOS SISTEMAS (Postgres + auth de Supabase), que NO comparten
 * transaccion. La atomicidad real es solo la del paso de datos; el cross-sistema se maneja con una
 * semantica HONESTA (no se finge una atomicidad que no existe):
 *
 *   1. deleteAccountData (Postgres, ATOMICO): borra/anonimiza las 17 tablas en una transaccion. Si FALLA,
 *      re-lanza -> la cuenta queda INTACTA (rollback), auth.users NUNCA se toca, y el llamador reintenta.
 *   2. Solo si el paso 1 tuvo EXITO y se pidio deleteAuthUser, se intenta borrar auth.users:
 *        - sin authDeleter (SERVICE_ROLE_KEY ausente) -> 'not_configured' (datos ya borrados; se loguea).
 *        - con exito                                   -> 'deleted'.
 *        - con fallo del API                           -> 'failed': LOS DATOS PERSONALES YA SE BORRARON
 *          (cumplimiento satisfecho); queda un auth.users sin datos. NO se revierten los datos (seria peor
 *          dejar los datos y no la identidad). Se LOGUEA claramente para reintento manual y se refleja en
 *          el estado devuelto.
 *
 * El SERVICE_ROLE_KEY nunca se loguea aqui (este modulo no lo tiene; solo lo tiene createSupabaseAuthUserDeleter).
 */
export async function deleteAccount(params: DeleteAccountParams): Promise<DeleteAccountResult> {
  const { ownerId, deleteAuthUser, repo, authDeleter, logger } = params;

  // (1) Datos primero (atomico). Si lanza, se propaga: nada borrado, auth intacto.
  const data = await repo.deleteAccountData(ownerId);

  // (2) auth.users, best-effort, solo si se pidio.
  if (!deleteAuthUser) {
    return { data, authUser: 'skipped' };
  }
  if (authDeleter === null) {
    logger?.error(
      { ownerId },
      'borrado de auth.users solicitado pero SUPABASE_SERVICE_ROLE_KEY no esta configurada: datos borrados, identidad conservada',
    );
    return { data, authUser: 'not_configured' };
  }
  try {
    await authDeleter.deleteUser(ownerId);
    return { data, authUser: 'deleted' };
  } catch (err) {
    // Datos YA borrados (cumplimiento satisfecho). auth.users quedo huerfano -> reintento MANUAL.
    logger?.error(
      { ownerId, err: err instanceof Error ? err.message : 'desconocido' },
      'datos de cuenta borrados pero FALLO el borrado de auth.users; reintentar manualmente (identidad huerfana)',
    );
    return { data, authUser: 'failed' };
  }
}
