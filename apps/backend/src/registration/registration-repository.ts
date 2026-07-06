import type { Sql } from '../db/client.js';
import type {
  AccountType,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserPage,
  AdminUserProfile,
  Organization,
  Profile,
  ProfileRole,
  ProfileTier,
  RegistrationResult,
  RegistrationState,
  Subscription,
  UsageCounter,
} from './types.js';

// Filas tal como vienen de Supabase (snake_case). Columnas SIEMPRE explicitas (nunca select *):
// si a la base le falta una columna, un select * la omite EN SILENCIO; con la lista explicita
// Postgres falla ruidosamente con "column does not exist" (mismo criterio que agent-repository.ts).

interface ProfileRow {
  id: string;
  org_id: string | null;
  account_type: string;
  role: string;
  full_name: string;
  identity_verified: boolean;
  tier: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OrganizationRow {
  id: string;
  name: string;
  status: string;
  approved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SubscriptionRow {
  id: string;
  profile_id: string;
  plan: string;
  status: string;
  created_at: Date | string;
}

interface UsageCounterRow {
  id: string;
  profile_id: string;
  runs_used: number | string;
  runs_limit: number | string;
  period_kind: string;
  created_at: Date | string;
}

// Fila del listado de admin: profiles + email (join a auth.users) + total_count (count(*) over(), viene
// como string porque bigint). Columnas explicitas, mismo criterio que arriba.
interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string;
  account_type: string;
  role: string;
  is_admin: boolean;
  tier: string;
  identity_verified: boolean;
  created_at: Date | string;
  total_count: number | string;
}

/** True si el error es un unique_violation de Postgres (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

const toIso = (value: Date | string): string => new Date(value).toISOString();
const toIsoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();
const toInt = (value: number | string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function rowToAdminUser(row: AdminUserRow): AdminUserListItem {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    accountType: row.account_type as AccountType,
    role: row.role as ProfileRole,
    isAdmin: row.is_admin,
    tier: row.tier as ProfileTier,
    identityVerified: row.identity_verified,
    createdAt: toIso(row.created_at),
  };
}

/**
 * Escapa los metacaracteres de LIKE/ILIKE (`\`, `%`, `_`) para que el termino de busqueda se trate
 * LITERAL (que un `%` tipeado por el admin no se comporte como comodin ni el search sea inesperado).
 * NO tiene que ver con inyeccion SQL: el valor SIEMPRE viaja como parametro (`${}` de postgres.js),
 * jamas concatenado; esto es solo semantica de patron. Se usa con `escape '\'` (el default de Postgres).
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Mapea un Profile de dominio + su flag is_admin (que Profile no lleva) a la vista curada de la FICHA de
 * admin (AdminUserProfile). Deja fuera org_id/updated_at: la ficha expone solo lo que la UI necesita.
 */
function profileToAdminProfile(profile: Profile, isAdmin: boolean): AdminUserProfile {
  return {
    id: profile.id,
    fullName: profile.fullName,
    accountType: profile.accountType,
    role: profile.role,
    isAdmin,
    tier: profile.tier,
    identityVerified: profile.identityVerified,
    createdAt: profile.createdAt,
  };
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    accountType: row.account_type as Profile['accountType'],
    role: row.role as Profile['role'],
    fullName: row.full_name,
    identityVerified: row.identity_verified,
    tier: row.tier as ProfileTier,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    approvedAt: toIsoOrNull(row.approved_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    profileId: row.profile_id,
    plan: row.plan,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function rowToUsageCounter(row: UsageCounterRow): UsageCounter {
  return {
    id: row.id,
    profileId: row.profile_id,
    runsUsed: toInt(row.runs_used),
    runsLimit: toInt(row.runs_limit),
    periodKind: row.period_kind,
    createdAt: toIso(row.created_at),
  };
}

/**
 * Acceso a datos del registro multi-tenant. Recibe el cliente sql por inyeccion (testeable),
 * usa el rol de servicio del pooler (omite RLS) y concentra TODA la logica de escritura aqui
 * (las rutas solo validan y delegan), igual que AgentRepository.
 */
export class RegistrationRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Lee el estado consolidado de un sub usando el executor dado (el cliente del pool o el sql
   * transaccional). Corre las consultas en serie a proposito: dentro de una transaccion el sql
   * de postgres usa una sola conexion y no admite consultas concurrentes sobre ella.
   *
   * Acepta `Sql`; dentro de una transaccion se le pasa el `tx` (TransactionSql) casteado: postgres
   * los modela como hermanos sobre ISql (ninguno asignable al otro) aunque comparten exactamente la
   * misma firma de tagged template, que es lo unico que usa este metodo.
   */
  private async loadState(sql: Sql, sub: string): Promise<RegistrationState> {
    const profileRows = await sql<ProfileRow[]>`
      select id, org_id, account_type, role, full_name, identity_verified, tier, created_at, updated_at
      from profiles where id = ${sub}
    `;
    const profileRow = profileRows[0];
    if (!profileRow) {
      return {
        needsRegistration: true,
        profile: null,
        organization: null,
        subscription: null,
        usageCounter: null,
      };
    }
    const profile = rowToProfile(profileRow);

    let organization: Organization | null = null;
    if (profile.orgId !== null) {
      const orgRows = await sql<OrganizationRow[]>`
        select id, name, status, approved_at, created_at, updated_at
        from organizations where id = ${profile.orgId}
      `;
      const orgRow = orgRows[0];
      organization = orgRow ? rowToOrganization(orgRow) : null;
    }

    const subRows = await sql<SubscriptionRow[]>`
      select id, profile_id, plan, status, created_at
      from subscriptions where profile_id = ${sub} order by created_at desc limit 1
    `;
    const subRow = subRows[0];
    const subscription = subRow ? rowToSubscription(subRow) : null;

    const usageRows = await sql<UsageCounterRow[]>`
      select id, profile_id, runs_used, runs_limit, period_kind, created_at
      from usage_counters where profile_id = ${sub} order by created_at desc limit 1
    `;
    const usageRow = usageRows[0];
    const usageCounter = usageRow ? rowToUsageCounter(usageRow) : null;

    return { needsRegistration: false, profile, organization, subscription, usageCounter };
  }

  /** Estado de registro de un sub (para GET /v1/me). */
  async getState(sub: string): Promise<RegistrationState> {
    return this.loadState(this.sql, sub);
  }

  /**
   * FICHA de un usuario OBJETIVO arbitrario para el panel de admin (GET /v1/admin/users/:id, gateado por
   * requireAdminRole). Es la VARIANTE admin de getState: en vez del sub del propio llamador toma un id
   * cualquiera, y ADEMAS del profile/subscription/usageCounter agrega el email (auth.users) y el flag
   * is_admin (columna aparte) que la ficha necesita y que el modelo Profile no lleva. Read-only, rol de
   * servicio (omite RLS). Devuelve null si el usuario objetivo no existe (el route responde 404).
   *
   * REUSA loadState para subscription/usageCounter (misma logica que /v1/me, SIN duplicar SQL) y hace UNA
   * query dedicada para is_admin + email con el mismo left join a auth.users que listUsers. loadState/getState
   * del usuario propio quedan intactos: esto es aditivo.
   */
  async getUserDetail(id: string): Promise<AdminUserDetail | null> {
    const state = await this.loadState(this.sql, id);
    // profile null == no existe perfil para ese id -> sin ficha (404 en el route).
    if (state.profile === null) {
      return null;
    }
    // is_admin (columna aparte, V021) y email (auth.users, no profiles) no viven en el modelo Profile: una
    // query dedicada de 2 columnas con el mismo left join a auth.users que listUsers (rol de servicio).
    const metaRows = await this.sql<{ is_admin: boolean; email: string | null }[]>`
      select p.is_admin, u.email
      from profiles p
      left join auth.users u on u.id = p.id
      where p.id = ${id}
    `;
    const meta = metaRows[0];
    return {
      profile: profileToAdminProfile(state.profile, meta?.is_admin === true),
      email: meta?.email ?? null,
      subscription: state.subscription,
      usageCounter: state.usageCounter,
    };
  }

  /**
   * Registra un individuo. Crea perfil (individual/individual, sin org, identity_verified false),
   * su suscripcion 'free' y su usage_counter (0/10, lifetime) en UNA transaccion: o se crean los
   * tres o ninguno. Idempotente por sub: si el perfil ya existe (conflicto en la PK profiles.id)
   * no duplica nada y devuelve el estado actual.
   */
  async registerIndividual(input: { sub: string; fullName: string }): Promise<RegistrationResult> {
    return this.sql.begin(async (tx) => {
      const inserted = await tx<{ id: string }[]>`
        insert into profiles (id, org_id, account_type, role, full_name, identity_verified)
        values (${input.sub}, null, 'individual', 'individual', ${input.fullName}, false)
        on conflict (id) do nothing
        returning id
      `;
      if (inserted.length === 0) {
        // Ya existe perfil para este sub: idempotente, no duplicar suscripcion ni contador.
        const state = await this.loadState(tx as unknown as Sql, input.sub);
        return { created: false, ...state };
      }
      await tx`
        insert into subscriptions (profile_id, plan, status)
        values (${input.sub}, 'free', 'active')
      `;
      await tx`
        insert into usage_counters (profile_id, runs_used, runs_limit, period_kind)
        values (${input.sub}, 0, 10, 'lifetime')
      `;
      const state = await this.loadState(tx as unknown as Sql, input.sub);
      return { created: true, ...state };
    });
  }

  /**
   * Registra una empresa. Crea la organization en 'pending' y el perfil del usuario que registra
   * (empresa_member/org_admin, org_id = la nueva org), en UNA transaccion. NO crea suscripcion
   * (se asigna al aprobar/comprar). Idempotente por sub: si el perfil ya existe, devuelve el estado
   * actual sin crear otra organizacion.
   *
   * El SELECT inicial cubre el caso comun (re-registro) sin insertar una org de mas. Pero el
   * SELECT-then-INSERT tiene una ventana TOCTOU bajo concurrencia (doble submit / dos requests del
   * mismo sub a la vez): ambos pasan el SELECT y ambos insertan; el segundo insert de profiles choca
   * con la PK (profiles.id = sub) y lanza unique_violation. La transaccion perdedora hace rollback
   * (sin organizacion huerfana). En vez de propagar un 500, capturamos ese 23505 y devolvemos el
   * estado actual: el contrato es idempotente por sub.
   */
  async registerOrganization(input: {
    sub: string;
    orgName: string;
    fullName: string;
  }): Promise<RegistrationResult> {
    try {
      return await this.sql.begin(async (tx) => {
        const existing = await tx<{ id: string }[]>`select id from profiles where id = ${input.sub}`;
        if (existing.length > 0) {
          const state = await this.loadState(tx as unknown as Sql, input.sub);
          return { created: false, ...state };
        }
        const orgRows = await tx<{ id: string }[]>`
          insert into organizations (name, status)
          values (${input.orgName}, 'pending')
          returning id
        `;
        const orgId = orgRows[0]?.id;
        if (orgId === undefined) {
          throw new Error('organization insert returned no id');
        }
        await tx`
          insert into profiles (id, org_id, account_type, role, full_name, identity_verified)
          values (${input.sub}, ${orgId}, 'empresa_member', 'org_admin', ${input.fullName}, false)
        `;
        const state = await this.loadState(tx as unknown as Sql, input.sub);
        return { created: true, ...state };
      });
    } catch (err) {
      // Carrera perdida (otro request creo el perfil entre el SELECT y el INSERT): devolver el
      // estado actual de forma idempotente. Cualquier otro error se propaga.
      if (isUniqueViolation(err)) {
        const state = await this.getState(input.sub);
        if (state.profile) {
          return { created: false, ...state };
        }
      }
      throw err;
    }
  }

  /**
   * Aprueba una organizacion (solo super-admin). Marca status 'approved' y fija approved_at.
   * approved_at se preserva si ya estaba puesto (coalesce): re-aprobar es idempotente y no pisa la
   * marca original. Devuelve null si la organizacion no existe.
   */
  async approveOrganization(orgId: string): Promise<Organization | null> {
    const rows = await this.sql<OrganizationRow[]>`
      update organizations
      set status = 'approved', approved_at = coalesce(approved_at, now()), updated_at = now()
      where id = ${orgId}
      returning id, name, status, approved_at, created_at, updated_at
    `;
    const row = rows[0];
    return row ? rowToOrganization(row) : null;
  }

  /**
   * Lee SOLO el tier de un sub (profiles.id = sub). Lectura liviana para el gate server-side del
   * modo autonomo del Configurador: nunca se confia en lo que diga el cliente. Devuelve null si el
   * perfil no existe (usuario sin registro completo): el llamador lo trata como sin acceso.
   */
  async getProfileTier(sub: string): Promise<ProfileTier | null> {
    const rows = await this.sql<{ tier: string }[]>`
      select tier from profiles where id = ${sub}
    `;
    const row = rows[0];
    return row ? (row.tier as ProfileTier) : null;
  }

  /**
   * Lee SOLO el flag de super-admin de PLATAFORMA de un sub (profiles.id = sub, columna is_admin de
   * V021). Lectura liviana para el gate server-side de admin (requireAdminRole), analoga a
   * getProfileTier: nunca se confia en lo que diga el cliente. Query dedicada (NO pasa por loadState)
   * para no acoplar el camino de /v1/me a esta columna. Fail-closed: devuelve false si el perfil no
   * existe (usuario sin registro completo) o si is_admin es false, y solo true cuando is_admin es true.
   */
  async isAdmin(sub: string): Promise<boolean> {
    const rows = await this.sql<{ is_admin: boolean }[]>`
      select is_admin from profiles where id = ${sub}
    `;
    return rows[0]?.is_admin === true;
  }

  /**
   * LISTA a nivel PLATAFORMA todos los usuarios para el panel de admin (GET /v1/admin/users, gateado por
   * requireAdminRole). Aislamiento NO por owner: el admin ve a TODOS; la proteccion es el gate de rol, no
   * un filtro de pertenencia. Read-only.
   *
   * UN solo SELECT con JOIN a auth.users para el email (sin N+1: nunca una query por usuario). El email
   * vive en auth.users, no en profiles; el left join lo trae con el rol de servicio (que puede leer el
   * esquema auth, igual que el worker en alertas.ts) y devuelve null si faltara la fila. El total sale del
   * mismo SELECT con `count(*) over()` (ventana calculada ANTES del limit/offset), asi que no hace falta
   * una segunda query de conteo. Orden estable `created_at desc, id desc` (el id desempata cuando dos
   * perfiles comparten created_at, para que la paginacion no repita ni salte filas).
   *
   * Dos ramas explicitas (con/sin search) en vez de un fragmento SQL condicional, mismo criterio que
   * JobsRepository.listByOwner: cada rama es UN solo template, mas legible y trivial de testear. El search
   * filtra por email o full_name con ILIKE PARAMETRIZADO (`${pattern}`, jamas concatenado -> no inyectable);
   * los metacaracteres de LIKE se escapan (escapeLike) para match literal. La ruta valida y acota
   * limit/offset/search antes de llamar aca (este metodo confia en valores ya saneados).
   *
   * Nota: en una pagina VACIA (offset mas alla del final) no hay filas y por tanto no hay total_count -> se
   * devuelve total 0. Es un borde del que solo se llega paginando de mas; para las paginas con filas el
   * total es exacto. La UI usa `hasMore` para el control de "cargar mas".
   */
  async listUsers(params: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<AdminUserPage> {
    const { limit, offset, search } = params;
    const rows =
      search === undefined
        ? await this.sql<AdminUserRow[]>`
            select p.id, u.email, p.full_name, p.account_type, p.role, p.is_admin, p.tier,
              p.identity_verified, p.created_at, count(*) over() as total_count
            from profiles p
            left join auth.users u on u.id = p.id
            order by p.created_at desc, p.id desc
            limit ${limit} offset ${offset}
          `
        : await this.sql<AdminUserRow[]>`
            select p.id, u.email, p.full_name, p.account_type, p.role, p.is_admin, p.tier,
              p.identity_verified, p.created_at, count(*) over() as total_count
            from profiles p
            left join auth.users u on u.id = p.id
            where u.email ilike ${`%${escapeLike(search)}%`}
               or p.full_name ilike ${`%${escapeLike(search)}%`}
            order by p.created_at desc, p.id desc
            limit ${limit} offset ${offset}
          `;
    const total = rows[0] ? toInt(rows[0].total_count) : 0;
    return { users: rows.map(rowToAdminUser), total };
  }

  /**
   * Actualiza el tier de un perfil (solo super-admin, via POST /v1/admin/profiles/:id/tier). Es la
   * palanca manual para subir/bajar el plan de un usuario hasta que exista facturacion. Devuelve el
   * perfil actualizado (sin datos sensibles: Profile no contiene secretos) o null si no existe.
   */
  async updateProfileTier(profileId: string, tier: ProfileTier): Promise<Profile | null> {
    const rows = await this.sql<ProfileRow[]>`
      update profiles
      set tier = ${tier}, updated_at = now()
      where id = ${profileId}
      returning id, org_id, account_type, role, full_name, identity_verified, tier, created_at, updated_at
    `;
    const row = rows[0];
    return row ? rowToProfile(row) : null;
  }

  /**
   * Registra una accion de administrador en el AUDIT LOG (tabla admin_actions, V022). Inserta UNA fila
   * con actor + accion + objetivo + detalle + timestamp (created_at lo pone la base con default now()).
   * Escritura suelta (rol de servicio, omite RLS), como updateProfileTier.
   *
   * - actorId: el sub del admin que ejecuta la accion, o null cuando el gate no lleva identidad (hoy el
   *   cambio de tier corre bajo x-admin-token, un secreto compartido sin actor -> null). La columna es
   *   nullable justo para este caso; el dia que el endpoint pase a gate por rol, se pasara el sub real.
   * - details: objeto libre que se persiste como jsonb (ej. { from, to } para 'change_tier').
   *
   * El llamador la invoca BEST-EFFORT (try/catch): un fallo al escribir el audit NO debe revertir ni
   * romper la accion ya realizada (ver routes/registration.ts). Por eso no envuelve nada en transaccion.
   */
  async recordAdminAction(input: {
    actorId: string | null;
    action: string;
    targetId: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.sql`
      insert into admin_actions (actor_id, action, target_id, details)
      values (
        ${input.actorId},
        ${input.action},
        ${input.targetId},
        ${this.sql.json(input.details as Parameters<Sql['json']>[0])}
      )
    `;
  }
}
