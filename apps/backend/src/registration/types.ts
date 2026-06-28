// Tipos de dominio del registro multi-tenant. El esquema fisico (organizations, profiles,
// subscriptions, usage_counters) vive en Supabase; aqui modelamos la vista en camelCase que
// consumen las rutas, igual que agents/types.ts mapea las filas snake_case del repo.

/** Tipo de cuenta del perfil. */
export type AccountType = 'individual' | 'empresa_member';

/** Rol del perfil dentro de la plataforma / su organizacion. */
export type ProfileRole = 'individual' | 'org_admin';

/** Perfil del usuario, ligado 1:1 al sub del JWT de Supabase (profiles.id = sub). */
export interface Profile {
  /** = auth.users.id = sub del JWT. */
  id: string;
  /** Organizacion a la que pertenece (null para individuos). */
  orgId: string | null;
  accountType: AccountType;
  role: ProfileRole;
  fullName: string;
  /** Verificacion de identidad ligera, no bloqueante. Se crea en false. */
  identityVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Organizacion (cuenta empresa). Arranca en 'pending' hasta que un super-admin la aprueba. */
export interface Organization {
  id: string;
  name: string;
  /** 'pending' | 'approved' (la base puede definir mas estados; se devuelve tal cual). */
  status: string;
  /** ISO del momento de aprobacion; null mientras este pendiente. */
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Suscripcion del perfil. El individuo arranca en 'free'; la empresa no recibe una al registrarse. */
export interface Subscription {
  id: string;
  profileId: string;
  plan: string;
  status: string;
  createdAt: string;
}

/** Contador de uso del perfil (runs consumidas vs limite del periodo). */
export interface UsageCounter {
  id: string;
  profileId: string;
  runsUsed: number;
  runsLimit: number;
  /** 'lifetime' | 'monthly' | ... (se devuelve tal cual lo defina la base). */
  periodKind: string;
  createdAt: string;
}

/**
 * Estado de registro consolidado de un sub. Es la forma que devuelve GET /v1/me: si el usuario
 * entro (JWT valido) pero aun no completo registro, needsRegistration = true y el resto es null.
 */
export interface RegistrationState {
  needsRegistration: boolean;
  profile: Profile | null;
  organization: Organization | null;
  subscription: Subscription | null;
  usageCounter: UsageCounter | null;
}

/** Resultado de un endpoint de registro: el estado + si esta llamada creo el perfil (vs idempotente). */
export interface RegistrationResult extends RegistrationState {
  /** true si esta llamada creo el perfil; false si ya existia (idempotente). */
  created: boolean;
}
