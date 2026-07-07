/**
 * Tipos y logica pura de las SOLICITUDES DE UPGRADE en la consola. Espeja la forma camelCase que devuelve
 * el backend (POST /v1/upgrade-requests, GET /v1/upgrade-requests/me — ver
 * apps/backend/src/routes/upgrade-requests.ts y upgrade/upgrade-requests-repository.ts). Sin React ni red:
 * los hooks (mutations.ts / queries.ts) consumen los endpoints; aca solo viven los tipos y la logica de
 * "ya solicito" / el mapeo de error, testeables como funciones puras (igual que scheduled-tasks.ts).
 *
 * Estas solicitudes NO suben el tier: solo capturan el interes de un 'free' por una feature premium (el
 * admin gestiona la conversion). El enforcement de tier server-side queda intacto.
 */

/** Planes SOLICITABLES: el universo de tier MENOS 'free'. Hoy 'autonomous' desbloquea las features premium
 *  ('pro' existe para un futuro plan intermedio). Coincide con el enum del backend. */
export type RequestedTier = 'pro' | 'autonomous';

/** Las 4 superficies premium que pueden disparar una solicitud. null = CTA generico sin feature. Coincide
 *  con el enum del backend (scheduled_tasks/triggers/recipes son tablas; configurator es el modo autonomo). */
export type FeatureContext = 'scheduled_tasks' | 'triggers' | 'recipes' | 'configurator';

/** Estado del lead en el embudo de conversion (lo mueve el admin). Arranca 'pending'. */
export type UpgradeRequestStatus = 'pending' | 'contacted' | 'converted' | 'declined';

/** Una solicitud de upgrade tal como la devuelve el backend (campos camelCase, timestamps ISO). */
export interface UpgradeRequest {
  id: string;
  ownerId: string;
  requestedTier: RequestedTier;
  featureContext: FeatureContext | null;
  status: UpgradeRequestStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body de POST /v1/upgrade-requests. owner_id lo pone el backend desde el JWT (nunca del body). */
export interface CreateUpgradeRequestInput {
  requestedTier: RequestedTier;
  featureContext?: FeatureContext;
}

/** Respuesta de POST /v1/upgrade-requests: la solicitud + si ESTA llamada la creo (201) o ya existia (200,
 *  anti-duplicado: una 'pending' por owner+tier). */
export interface CreateUpgradeRequestResult {
  upgradeRequest: UpgradeRequest;
  created: boolean;
}

/** Respuesta de GET /v1/upgrade-requests/me: TODAS las solicitudes del usuario (mas nuevas primero; [] si
 *  no tiene ninguna). */
export interface MyUpgradeRequestsState {
  upgradeRequests: UpgradeRequest[];
}

/**
 * Estados en los que una solicitud sigue "viva" (el lead esta abierto): con una asi NO se re-ofrece el CTA,
 * para no generar leads duplicados. 'converted' ya no cuenta (el tier subio y el gate desaparece);
 * 'declined' tampoco (permite volver a pedir). Espeja el anti-duplicado del backend (una 'pending' por
 * owner+tier) extendido a 'contacted' para no crear una segunda solicitud mientras el equipo la gestiona.
 */
const OPEN_STATUSES: readonly UpgradeRequestStatus[] = ['pending', 'contacted'];

/**
 * True si el usuario YA tiene una solicitud viva para `tier` (default 'autonomous', el que desbloquea las
 * features premium). La UI lo usa para mostrar "Solicitud enviada" en vez de re-ofrecer el boton.
 */
export function hasActiveUpgradeRequest(
  state: MyUpgradeRequestsState | undefined,
  tier: RequestedTier = 'autonomous',
): boolean {
  return (state?.upgradeRequests ?? []).some(
    (req) => req.requestedTier === tier && OPEN_STATUSES.includes(req.status),
  );
}

/**
 * Traduce el error de solicitar acceso (POST /v1/upgrade-requests) a un mensaje claro en espanol. Duck-typed
 * sobre `status` para no acoplar este modulo puro a ApiError (que arrastra red/supabase); el shape { status }
 * lo cumple ApiError. Espeja el estilo de updateProfileNameErrorMessage (registration.ts).
 */
export function requestUpgradeErrorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null;
  switch (status) {
    case 401:
      return 'Tu sesion expiro. Vuelve a iniciar sesion.';
    case 400:
      return 'No pudimos registrar tu solicitud. Intenta de nuevo.';
    default:
      return 'No pudimos enviar tu solicitud. Intenta de nuevo.';
  }
}
