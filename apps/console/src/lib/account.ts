// Tipos y logica PURA del borrado self-service de cuenta en la consola. Sin imports de red/supabase/
// react-router: asi la comparacion de confirmacion y el mapeo de errores se testean como funciones puras
// (igual que registration.ts / env.ts). El hook con efectos (apiFetch + signOut + redirect) vive aparte
// en account-mutations.ts, para no acoplar este modulo puro a supabase.

import i18n from '../i18n';

/**
 * Que paso con auth.users en el backend (espeja AuthUserDeletionOutcome del motor). La consola NO ramifica
 * por este valor: en los cuatro casos la cuenta del usuario quedo borrada (sus datos se fueron) y el
 * cliente debe cerrar sesion. Se tipa solo para reflejar la forma honesta de la respuesta 200.
 */
export type AuthUserDeletionOutcome = 'deleted' | 'skipped' | 'not_configured' | 'failed';

/** Forma exacta de la respuesta 200 de DELETE /v1/me (ver apps/backend/src/routes/account.ts:144-148). */
export interface DeleteAccountResponse {
  accountDeleted: boolean;
  authUser: AuthUserDeletionOutcome;
  /** Detalle interno del motor de datos; la UI no lo consume. Se deja laxo a proposito. */
  data?: unknown;
}

/**
 * Normaliza un email para comparar la confirmacion, con el MISMO criterio que el backend
 * (routes/account.ts:23-25): recorta y baja a minusculas. Una sola fuente de verdad para el gate de la UI.
 */
export function normalizeConfirmEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * BARRERA DE INTENCION de la UI: decide si el email ESCRITO por el usuario coincide (normalizado) con el
 * email esperado de su cuenta. Habilita el boton destructivo. Es UX que COMPLEMENTA (no reemplaza) la
 * revalidacion server-side, que es la real. Fail-closed: si no hay email esperado (undefined/null) o queda
 * vacio tras normalizar, JAMAS coincide -> el boton nunca se habilita (imposible borrar sin un email real).
 */
export function emailConfirmationMatches(typed: string, expected: string | null | undefined): boolean {
  if (expected === null || expected === undefined) return false;
  const normExpected = normalizeConfirmEmail(expected);
  if (normExpected === '') return false;
  return normalizeConfirmEmail(typed) === normExpected;
}

/**
 * Traduce el error de DELETE /v1/me a un mensaje claro para el modal. Duck-typed sobre `status` para no
 * acoplar este modulo puro a ApiError (que arrastra red/supabase); el shape { status } lo cumple ApiError.
 * Espeja el estilo de updateProfileNameErrorMessage (registration.ts). El 400 es el caso esperado (el email
 * escrito no coincide con el del token) -> mensaje accionable dentro del modal, sin cerrar el flujo.
 */
export function deleteAccountErrorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null;
  switch (status) {
    case 400:
      return i18n.t('cuenta.errores.eliminar400');
    case 401:
      return i18n.t('cuenta.errores.eliminar401');
    default:
      return i18n.t('cuenta.errores.eliminarGenerico');
  }
}
