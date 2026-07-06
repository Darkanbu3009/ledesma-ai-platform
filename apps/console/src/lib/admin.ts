// Tipos y logica PURA del PANEL DE ADMIN en la consola. Espeja la forma camelCase que devuelven los
// endpoints admin del backend (GET /v1/admin/users, GET /v1/admin/users/:id, PUT /v1/admin/users/:id/tier;
// ver apps/backend/src/routes/admin-users.ts y admin-user-tier.ts). Sin React ni red: el armado del
// querystring, las etiquetas/tonos de los badges, el formato de fecha y el mapeo de errores del cambio de
// tier se testean como funciones puras, igual que jobs.ts / dashboard.ts.
//
// SOLO LECTURA salvo el cambio de tier (la unica mutacion del panel). El acceso lo impone el backend por
// rol (requireAdminRole -> 403 a un no-admin); aca solo consumimos y presentamos.

import type { AccountType, ProfileRole, ProfileTier, Subscription, UsageCounter } from './registration';

/**
 * Fila del LISTADO de usuarios (GET /v1/admin/users). Vista a nivel PLATAFORMA (todos los usuarios), con
 * el email traido del join a auth.users (null si no hubiera fila). Mismo shape que el backend
 * (AdminUserListItem): no hay transformacion cliente, solo tipado.
 */
export interface AdminUserListItem {
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

/** Metadata de paginacion que devuelve el listado (misma forma que /v1/jobs, mas `total`). */
export interface AdminUsersPagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

/** Respuesta completa de GET /v1/admin/users: las filas + la paginacion. */
export interface AdminUsersResponse {
  users: AdminUserListItem[];
  pagination: AdminUsersPagination;
}

/**
 * Perfil de un usuario tal como lo consume la FICHA (GET /v1/admin/users/:id): los campos de profiles MAS
 * is_admin (columna aparte, V021). El email va como campo hermano en AdminUserDetail (vive en auth.users).
 */
export interface AdminUserProfile {
  id: string;
  fullName: string;
  accountType: AccountType;
  role: ProfileRole;
  isAdmin: boolean;
  tier: ProfileTier;
  identityVerified: boolean;
  createdAt: string;
}

/**
 * FICHA de un usuario (GET /v1/admin/users/:id): perfil (con is_admin) + email + suscripcion + contador de
 * uso. subscription/usageCounter pueden ser null (perfil recien creado o empresa sin plan).
 */
export interface AdminUserDetail {
  profile: AdminUserProfile;
  email: string | null;
  subscription: Subscription | null;
  usageCounter: UsageCounter | null;
}

// ---------------------------------------------------------------------------------------------------
// Paginacion del listado (mismo tamano que el default del backend, alineado con JOB_PAGE_SIZE).

export const ADMIN_USERS_PAGE_SIZE = 20;

/**
 * Arma el querystring de una pagina del listado: limit, offset y, si hay busqueda no vacia, search. El
 * termino se recorta y solo viaja cuando aporta (una cadena vacia o de espacios NO agrega el parametro,
 * asi el backend responde el listado completo en vez de filtrar por vacio). URLSearchParams codifica el
 * valor (no hace falta encodeURIComponent manual). Unica fuente de la URL; el hook solo la consume.
 */
export function buildAdminUsersQuery(params: {
  limit: number;
  offset: number;
  search?: string;
}): string {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit));
  query.set('offset', String(params.offset));
  const search = params.search?.trim();
  if (search) {
    query.set('search', search);
  }
  return `?${query.toString()}`;
}

// ---------------------------------------------------------------------------------------------------
// Etiquetas y tonos de presentacion (puros: la UI solo pinta lo que devuelven).

/** Los tres tiers en orden, para el control de cambio de tier de la ficha. */
export const TIER_ORDER: ProfileTier[] = ['free', 'pro', 'autonomous'];

/** Tono visual de un badge: la clase Tailwind del pill (paleta light de la consola). */
export type BadgeTone = string;

const TIER_META: Record<ProfileTier, { label: string; tone: BadgeTone }> = {
  free: { label: 'Free', tone: 'border-line bg-line-soft text-muted' },
  pro: { label: 'Pro', tone: 'border-brasa-line bg-brasa-soft text-brasa' },
  autonomous: { label: 'Autónomo', tone: 'border-anthropic-line bg-anthropic-soft text-anthropic' },
};

/** Etiqueta + tono del badge de un tier. Fallback defensivo si el backend enviara un tier desconocido. */
export function tierMeta(tier: ProfileTier): { label: string; tone: BadgeTone } {
  return TIER_META[tier] ?? { label: tier, tone: 'border-line bg-line-soft text-muted' };
}

/** Etiqueta legible de un tier (para textos fuera del badge, p.ej. el dialogo de confirmacion). */
export function tierLabel(tier: ProfileTier): string {
  return tierMeta(tier).label;
}

/** Etiqueta legible del tipo de cuenta. */
export function accountTypeLabel(accountType: AccountType): string {
  switch (accountType) {
    case 'individual':
      return 'Individual';
    case 'empresa_member':
      return 'Empresa';
    default:
      return accountType;
  }
}

/** Etiqueta legible del rol dentro de la organizacion (ORTOGONAL al super-admin de plataforma). */
export function roleLabel(role: ProfileRole): string {
  switch (role) {
    case 'individual':
      return 'Individual';
    case 'org_admin':
      return 'Admin de organización';
    default:
      return role;
  }
}

/** 'YYYY-...' ISO -> fecha corta es-MX (p.ej. '10 jun 2026'). Fecha de registro, sin la hora. */
export function formatUserDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------------------------------
// Mensajes del cambio de tier (la accion sensible del panel).

/** Lee el `status` HTTP de un error (ApiError o similar) sin acoplarse a la clase (no importa red). */
function errorStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

/**
 * Traduce el error del cambio de tier a un mensaje claro para el admin. El backend gatea por rol: un 403
 * es "no eres admin" (o dejaste de serlo) y un 404 es "el usuario ya no existe". Cualquier otro caso cae a
 * un mensaje generico reintentable. El texto es feedback de UX; el efecto real ya lo decidio el backend.
 */
export function changeTierErrorMessage(err: unknown): string {
  switch (errorStatus(err)) {
    case 403:
      return 'No tienes permiso para cambiar el tier de este usuario.';
    case 404:
      return 'No encontramos a este usuario. Es posible que ya no exista.';
    default:
      return 'No pudimos cambiar el tier. Revisa tu conexión e intenta de nuevo.';
  }
}
