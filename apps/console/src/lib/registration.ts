// Tipos y logica pura del registro multi-tenant en la consola. Espeja la forma camelCase que
// devuelve el backend en GET /v1/me (ver apps/backend/src/registration/types.ts). Sin imports de
// red: asi la decision de enrutado y la validacion se testean como funciones puras, igual que env.ts.

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
  createdAt: string;
  updatedAt: string;
}

/** Organizacion (cuenta empresa). Arranca en 'pending' hasta que un super-admin la aprueba. */
export interface Organization {
  id: string;
  name: string;
  /** 'pending' | 'approved' (el backend puede definir mas estados; llega tal cual). */
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
 * A donde corresponde enviar a un usuario autenticado segun su estado de registro:
 * - 'needs-registration': aun no completo el registro -> pantalla de Completar registro.
 * - 'pending': empresa registrada pero no aprobada -> pantalla en revision (no entra al dashboard).
 * - 'active': individuo, o empresa ya aprobada -> dashboard/playground.
 */
export type Access = 'needs-registration' | 'pending' | 'active';

const APPROVED_STATUS = 'approved';

/** Clasifica el estado de /v1/me en una decision de enrutado. Pura y testeable. */
export function classifyRegistration(state: RegistrationState): Access {
  if (state.needsRegistration || state.profile === null) {
    return 'needs-registration';
  }
  // Una empresa solo entra al dashboard cuando su organizacion esta aprobada; cualquier otro estado
  // (o una organizacion ausente) la mantiene en revision.
  if (
    state.profile.accountType === 'empresa_member' &&
    state.organization?.status !== APPROVED_STATUS
  ) {
    return 'pending';
  }
  return 'active';
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
    return 'Este campo es obligatorio.';
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    return `Usa ${NAME_MAX_LENGTH} caracteres o menos.`;
  }
  return undefined;
}
