// Tipos de dominio del registro multi-tenant. El esquema fisico (organizations, profiles,
// subscriptions, usage_counters) vive en Supabase; aqui modelamos la vista en camelCase que
// consumen las rutas, igual que agents/types.ts mapea las filas snake_case del repo.

/** Tipo de cuenta del perfil. */
export type AccountType = 'individual' | 'empresa_member';

/** Rol del perfil dentro de la plataforma / su organizacion. */
export type ProfileRole = 'individual' | 'org_admin';

/**
 * Tier del perfil (columna profiles.tier, V007). Controla el acceso a features por plan; hoy lo
 * unico que desbloquea es el MODO AUTONOMO del Configurador ('autonomous'). Es un flag manual
 * (admin endpoint) hasta integrar facturacion. Arranca en 'free'.
 */
export type ProfileTier = 'free' | 'pro' | 'autonomous';

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
  /** Plan del usuario. 'autonomous' habilita el modo autonomo del Configurador. Default 'free'. */
  tier: ProfileTier;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fila del LISTADO DE USUARIOS del panel de admin (GET /v1/admin/users). Vista a nivel PLATAFORMA
 * (todos los usuarios), NO por owner: la proteccion es el gate de admin, no un filtro de pertenencia.
 * Deriva de profiles pero AGREGA el email, que no vive en profiles sino en auth.users (join server-side
 * con el rol de servicio). email es null si no hubiera fila en auth.users (left join defensivo).
 */
export interface AdminUserListItem {
  /** = profiles.id = auth.users.id = sub del JWT. */
  id: string;
  /** auth.users.email (via join). null si no se encuentra la fila de auth. */
  email: string | null;
  fullName: string;
  accountType: AccountType;
  role: ProfileRole;
  /** Super-admin de plataforma (profiles.is_admin, V021). */
  isAdmin: boolean;
  tier: ProfileTier;
  identityVerified: boolean;
  createdAt: string;
}

/** Pagina del listado de usuarios: las filas + el total de la plataforma (para la paginacion). */
export interface AdminUserPage {
  users: AdminUserListItem[];
  /** Total de perfiles que matchean (ignora limit/offset), para calcular paginas en la UI. */
  total: number;
}

/**
 * Perfil de un usuario tal como lo consume la FICHA del panel de admin (GET /v1/admin/users/:id). Es la
 * vista curada que necesita la UI: los campos de profiles MAS is_admin (columna aparte, V021, que el modelo
 * Profile de dominio no lleva). El email NO va aca sino como campo hermano en AdminUserDetail (vive en
 * auth.users, no en profiles).
 */
export interface AdminUserProfile {
  /** = profiles.id = auth.users.id = sub del JWT. */
  id: string;
  fullName: string;
  accountType: AccountType;
  role: ProfileRole;
  /** Super-admin de plataforma (profiles.is_admin, V021). */
  isAdmin: boolean;
  tier: ProfileTier;
  identityVerified: boolean;
  createdAt: string;
}

/**
 * FICHA de un usuario para el panel de admin (GET /v1/admin/users/:id). Detalle read-only de un usuario
 * OBJETIVO arbitrario: su perfil (con is_admin), su email (join a auth.users), su suscripcion y su contador
 * de uso. subscription/usageCounter pueden ser null (un perfil recien creado o una empresa sin plan). Si el
 * usuario objetivo no existe, el repo devuelve null y el route responde 404 (no hay ficha vacia).
 */
export interface AdminUserDetail {
  profile: AdminUserProfile;
  /** auth.users.email (via join). null si no se encuentra la fila de auth. */
  email: string | null;
  subscription: Subscription | null;
  usageCounter: UsageCounter | null;
}

/**
 * Organizacion (cuenta empresa). Las orgs nuevas entran DIRECTO en 'active' (sin aprobacion manual);
 * el super-admin todavia puede marcarla 'approved' (endpoint legado), pero el acceso NO depende del
 * status: lo gatea el TIER del perfil.
 */
export interface Organization {
  id: string;
  name: string;
  /** 'active' (alta directa) | 'approved' (via admin, legado). La base puede definir mas estados. */
  status: string;
  /** ISO del momento de aprobacion via admin; null si nunca se aprobo (alta directa). */
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Suscripcion del perfil. Individuo y empresa arrancan en 'free' (ambos entran directo al registrarse). */
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
  /**
   * Super-admin de PLATAFORMA (profiles.is_admin, V021). Se expone aca -- eje ORTOGONAL al role de org
   * y al tier -- solo para que la consola sepa si mostrar el area de admin (UX). La AUTORIDAD del acceso
   * sigue siendo server-side (requireAdminRole gatea los endpoints admin y devuelve 403 a un no-admin);
   * este flag es puramente cosmetico. Fail-closed: false cuando no hay perfil (needsRegistration).
   */
  isAdmin: boolean;
}

/** Resultado de un endpoint de registro: el estado + si esta llamada creo el perfil (vs idempotente). */
export interface RegistrationResult extends RegistrationState {
  /** true si esta llamada creo el perfil; false si ya existia (idempotente). */
  created: boolean;
}
