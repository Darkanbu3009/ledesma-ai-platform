import type { AccountDeletionRepository, AccountDataDeletionResult } from './account-deletion-repository.js';
import type { AuthUserDeleter, ScreenshotStorageDeleter } from './supabase-admin.js';

/**
 * Resultado del borrado de auth.users (paso cross-sistema, best-effort tras el borrado de datos):
 *   - 'deleted'        -> auth.users borrado con exito.
 *   - 'skipped'        -> no se pidio borrar auth.users (erasure ARCO por default conserva la identidad).
 *   - 'not_configured' -> se pidio, pero SUPABASE_SERVICE_ROLE_KEY no esta configurada: no se pudo borrar.
 *   - 'failed'         -> se pidio y se intento, pero el API fallo. LOS DATOS YA SE BORRARON (no se
 *                         revierten); queda un auth.users huerfano para reintento manual (se logueo).
 */
export type AuthUserDeletionOutcome = 'deleted' | 'skipped' | 'not_configured' | 'failed';

/**
 * Resultado de la purga de los SCREENSHOTS de aprobacion en Storage (paso cross-sistema, best-effort tras
 * el borrado de datos):
 *   - 'deleted'            -> los objetos del titular se borraron del bucket.
 *   - 'nothing_to_delete'  -> el titular no tenia ningun screenshot (no habia nada que purgar).
 *   - 'not_configured'     -> habia objetos que purgar, pero SUPABASE_SERVICE_ROLE_KEY no esta configurada.
 *   - 'failed'             -> se intento y el API de Storage fallo. LOS DATOS YA SE BORRARON; quedan
 *                             objetos huerfanos en el bucket para purga manual (se logueo).
 */
export type ScreenshotDeletionOutcome =
  | 'deleted'
  | 'nothing_to_delete'
  | 'not_configured'
  | 'failed';

export interface DeleteAccountResult {
  /** Lo que borro/anonimizo el motor de datos (Postgres, atomico). */
  data: AccountDataDeletionResult;
  /** Que paso con auth.users (sistema aparte, sin atomicidad cross-sistema). */
  authUser: AuthUserDeletionOutcome;
  /** Que paso con los screenshots de aprobacion en Storage (sistema aparte, best-effort). */
  screenshots: ScreenshotDeletionOutcome;
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
  /** Borrador de los screenshots de aprobacion en Storage, o null si SERVICE_ROLE_KEY no esta configurada. */
  screenshotDeleter: ScreenshotStorageDeleter | null;
  logger?: DeletionLogger;
}

/**
 * ORQUESTA el borrado de cuenta a traves de TRES SISTEMAS (Postgres + Storage + auth de Supabase), que NO
 * comparten transaccion. La atomicidad real es solo la del paso de datos; el cross-sistema se maneja con
 * una semantica HONESTA (no se finge una atomicidad que no existe):
 *
 *   1. deleteAccountData (Postgres, ATOMICO): borra 22 tablas (mas pasos_trayectoria e
 *      intervenciones_art22 por cascade) y anonimiza admin_actions, todo en una transaccion. Si FALLA,
 *      re-lanza -> la cuenta queda INTACTA (rollback), nada mas se toca, y el llamador reintenta.
 *   1b. Solo si el paso 1 tuvo EXITO, se purgan de Storage los screenshots de los checkpoints de
 *      aprobacion borrados. Viven en un bucket, no en Postgres: ningun DELETE los alcanza y sin este paso
 *      quedarian huerfanos. Es best-effort y NO condiciona nada: los datos ya se borraron.
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
  const { ownerId, deleteAuthUser, repo, authDeleter, screenshotDeleter, logger } = params;

  // (1) Datos primero (atomico). Si lanza, se propaga: nada borrado, auth y Storage intactos.
  const data = await repo.deleteAccountData(ownerId);

  // (1b) Screenshots de los checkpoints borrados. SIEMPRE, no solo con deleteAuthUser: son datos
  //      personales del titular y la supresion los alcanza aunque se conserve la identidad.
  const screenshots = await purgeScreenshots(
    ownerId,
    data.aprobacionesWebScreenshots,
    screenshotDeleter,
    logger,
  );

  // (2) auth.users, best-effort, solo si se pidio.
  if (!deleteAuthUser) {
    return { data, authUser: 'skipped', screenshots };
  }
  if (authDeleter === null) {
    logger?.error(
      { ownerId },
      'borrado de auth.users solicitado pero SUPABASE_SERVICE_ROLE_KEY no esta configurada: datos borrados, identidad conservada',
    );
    return { data, authUser: 'not_configured', screenshots };
  }
  try {
    await authDeleter.deleteUser(ownerId);
    return { data, authUser: 'deleted', screenshots };
  } catch (err) {
    // Datos YA borrados (cumplimiento satisfecho). auth.users quedo huerfano -> reintento MANUAL.
    logger?.error(
      { ownerId, err: err instanceof Error ? err.message : 'desconocido' },
      'datos de cuenta borrados pero FALLO el borrado de auth.users; reintentar manualmente (identidad huerfana)',
    );
    return { data, authUser: 'failed', screenshots };
  }
}

/**
 * Purga BEST-EFFORT de los objetos de Storage de los checkpoints ya borrados. NUNCA lanza: los datos
 * personales de Postgres ya se fueron y el cumplimiento no puede quedar colgando de un bucket. Un fallo
 * se LOGUEA para purga manual y se refleja en el estado devuelto.
 */
async function purgeScreenshots(
  ownerId: string,
  paths: string[],
  deleter: ScreenshotStorageDeleter | null,
  logger: DeletionLogger | undefined,
): Promise<ScreenshotDeletionOutcome> {
  if (paths.length === 0) {
    return 'nothing_to_delete';
  }
  if (deleter === null) {
    logger?.error(
      { ownerId, screenshots: paths.length },
      'datos de cuenta borrados pero SUPABASE_SERVICE_ROLE_KEY no esta configurada: quedan screenshots de aprobacion en Storage (purga manual)',
    );
    return 'not_configured';
  }
  try {
    await deleter.deleteObjects(paths);
    return 'deleted';
  } catch (err) {
    logger?.error(
      {
        ownerId,
        screenshots: paths.length,
        err: err instanceof Error ? err.message : 'desconocido',
      },
      'datos de cuenta borrados pero FALLO la purga de los screenshots de aprobacion en Storage; purgar manualmente (objetos huerfanos)',
    );
    return 'failed';
  }
}
