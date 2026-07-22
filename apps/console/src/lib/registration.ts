// Tipos y logica pura del registro multi-tenant en la consola. Espeja la forma camelCase que
// devuelve el backend en GET /v1/me (ver apps/backend/src/registration/types.ts). Sin imports de
// red: asi la decision de enrutado y la validacion se testean como funciones puras, igual que env.ts.

import i18n from '../i18n';

export type AccountType = 'individual' | 'empresa_member';
export type ProfileRole = 'individual' | 'org_admin';

/**
 * Tier del usuario (columna profiles.tier del backend). Hoy lo unico que desbloquea es el MODO
 * AUTONOMO del Configurador ('autonomous'). El acceso real lo decide el backend; aca solo se lee
 * para mostrar/ocultar la opcion en la UI. Default 'free'.
 */
export type ProfileTier = 'free' | 'pro' | 'autonomous';

/** Perfil del usuario, ligado 1:1 al sub del JWT de Supabase. */
export interface Profile {
  id: string;
  orgId: string | null;
  accountType: AccountType;
  role: ProfileRole;
  fullName: string;
  identityVerified: boolean;
  /** Plan del usuario. 'autonomous' habilita el modo autonomo del Configurador. */
  tier: ProfileTier;
  /**
   * Pais DECLARADO por el usuario (ISO 3166-1 alpha-2 en mayusculas, profiles.pais). Pinea la
   * geolocalizacion del proxy al conectar sitios. null = aun no declarado: la pagina de Sitios lo
   * pide UNA vez antes de la primera conexion, y despues es editable en la configuracion del perfil.
   */
  pais: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Organizacion (cuenta empresa). Entra DIRECTO en 'active'; el acceso lo decide el tier, no el status. */
export interface Organization {
  id: string;
  name: string;
  /** 'active' (alta directa) | 'approved' (via admin, legado). Llega tal cual del backend. */
  status: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  profileId: string;
  plan: string;
  status: string;
  createdAt: string;
}

export interface UsageCounter {
  id: string;
  profileId: string;
  runsUsed: number;
  runsLimit: number;
  periodKind: string;
  createdAt: string;
}

/** Forma exacta de GET /v1/me. needsRegistration = true cuando hay sesion pero aun no hay perfil. */
export interface RegistrationState {
  needsRegistration: boolean;
  profile: Profile | null;
  organization: Organization | null;
  subscription: Subscription | null;
  usageCounter: UsageCounter | null;
  /**
   * Super-admin de PLATAFORMA (profiles.is_admin, V021). Eje ORTOGONAL al role de org y al tier. La
   * consola lo usa SOLO para decidir si muestra el area de admin (UX cosmetica). La AUTORIDAD del acceso
   * es server-side: requireAdminRole gatea los endpoints admin y un no-admin recibe 403 aunque forzara
   * la ruta. Fail-closed: el backend lo devuelve false cuando no hay perfil.
   */
  isAdmin: boolean;
}

/** Respuesta de los endpoints de registro: el estado consolidado + si esta llamada creo el perfil. */
export interface RegistrationResult extends RegistrationState {
  created: boolean;
}

/** Body de POST /v1/register/individual (snake_case, tal como lo espera el backend). */
export interface IndividualInput {
  full_name: string;
}

/** Body de POST /v1/register/organization (snake_case). */
export interface OrganizationInput {
  org_name: string;
  full_name: string;
}

/**
 * Body de PATCH /v1/me/profile (editar el PROPIO nombre): SOLO el nombre, en camelCase tal como lo
 * espera el backend (ProfileUpdateBodySchema). El endpoint whitelistea unicamente este campo: cualquier
 * otra clave se descarta en el parseo del servidor.
 */
export interface UpdateProfileNameInput {
  fullName: string;
}

/**
 * Body de PATCH /v1/me/profile para declarar/cambiar el PROPIO pais: SOLO el codigo ISO 3166-1
 * alpha-2. Mismo endpoint whitelisted que el nombre: cualquier otra clave se descarta en el parseo
 * del servidor, y el backend lo normaliza a mayusculas antes de escribir profiles.pais.
 */
export interface UpdateProfilePaisInput {
  pais: string;
}

/**
 * A donde corresponde enviar a un usuario autenticado segun su estado de registro:
 * - 'needs-registration': aun no completo el registro -> pantalla de Completar registro.
 * - 'active': ya tiene perfil (individuo o empresa) -> dashboard/playground.
 *
 * Ya NO existe un estado 'pending' de onboarding: ambos tipos (persona y empresa) entran DIRECTO. El
 * control de acceso real es el TIER (profiles.tier, gateado server-side), no el estado de la
 * organizacion; el muro de aprobacion manual se elimino.
 */
export type Access = 'needs-registration' | 'active';

/** Clasifica el estado de /v1/me en una decision de enrutado. Pura y testeable. */
export function classifyRegistration(state: RegistrationState): Access {
  if (state.needsRegistration || state.profile === null) {
    return 'needs-registration';
  }
  // Cualquier perfil (persona o empresa) entra al dashboard: no hay muro de aprobacion. Lo que puede
  // HACER un usuario lo decide el tier server-side, no este enrutado.
  return 'active';
}

/**
 * Deriva si el usuario actual es super-admin de plataforma a partir de la respuesta de /v1/me. Pura y
 * testeable (igual que classifyRegistration). Fail-closed: false mientras /v1/me no resuelve (state
 * undefined) o si el backend no marca isAdmin. Recordatorio: esto solo decide la UX (mostrar/ocultar el
 * area de admin); la seguridad real la impone el backend (requireAdminRole devuelve 403 a un no-admin).
 */
export function deriveIsAdmin(state: RegistrationState | undefined): boolean {
  return state?.isAdmin === true;
}

/** Limite de longitud de nombres, alineado con los schemas zod del backend (string max 200). */
export const NAME_MAX_LENGTH = 200;

/**
 * Valida un nombre (full_name / org_name) con el mismo criterio que el backend: requerido y de a lo
 * sumo NAME_MAX_LENGTH caracteres tras recortar. Devuelve el mensaje de error o undefined si es valido.
 */
export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return i18n.t('registro.validacion.campoObligatorio');
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    return i18n.t('registro.validacion.maxCaracteres', { max: NAME_MAX_LENGTH });
  }
  return undefined;
}

/**
 * Traduce el error de editar el propio nombre (PATCH /v1/me/profile) a un mensaje claro para la pantalla
 * de perfil. El backend valida el mismo criterio de nombre (400 si el body no pasa) y exige sesion (401
 * si el token expiro); cualquier otro caso cae a un mensaje generico reintentable. Duck-typed sobre el
 * `status` para no acoplar este modulo puro a ApiError (que arrastra red/supabase); el shape { status }
 * lo cumple ApiError. Espeja el estilo de changeTierErrorMessage (lib/admin.ts).
 */
export function updateProfileNameErrorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null;
  switch (status) {
    case 400:
      return i18n.t('registro.perfil.revisaNombre');
    case 401:
      return i18n.t('registro.perfil.sesionExpirada');
    default:
      return i18n.t('registro.perfil.errorActualizar');
  }
}
