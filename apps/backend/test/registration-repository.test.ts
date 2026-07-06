import { describe, it, expect } from 'vitest';
import { RegistrationRepository } from '../src/registration/registration-repository.js';
import type { Sql } from '../src/db/client.js';

interface RecordedCall {
  text: string;
  values: unknown[];
  /** true si la consulta se emitio via el sql transaccional (el `tx` de begin), false si via el pool. */
  tx: boolean;
}

/**
 * Mock del cliente `sql` con soporte de transacciones. Cada llamada (como tagged template) consume
 * el siguiente resultado de la cola y registra el texto del template (con <param> en cada hueco), los
 * valores interpolados y SI fue transaccional, para poder afirmar tanto sobre el SQL generado como
 * sobre la atomicidad (que las escrituras corran dentro de begin). begin() ejecuta el callback con un
 * tagged template DISTINTO que marca sus consultas con tx:true; asi un test detecta si una escritura
 * se hace fuera de la transaccion. Una entrada de la cola que sea Error hace rechazar esa consulta
 * (para probar el rollback / propagacion de errores).
 */
interface MockSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin<T>(cb: (tx: Sql) => Promise<T>): Promise<T>;
  json(v: unknown): unknown;
  calls: RecordedCall[];
  /** Argumentos con los que se invoco sql.json(): prueba que una columna jsonb se serializo via json(). */
  jsonCalls: unknown[];
}

function makeSql(results: Array<unknown[] | Error>): MockSql {
  const queue = [...results];
  const calls: RecordedCall[] = [];
  const jsonCalls: unknown[] = [];
  const record = (tx: boolean) => (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    calls.push({ text: Array.from(strings).join('<param>'), values, tx });
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? []);
  };
  const tagged = record(false) as unknown as MockSql;
  // begin pasa un tagged template SEPARADO (tx:true) y propaga el resultado/rechazo del callback,
  // igual que el begin real reenvia el error tras hacer rollback.
  tagged.begin = <T>(cb: (tx: Sql) => Promise<T>): Promise<T> => cb(record(true) as unknown as Sql);
  // Identidad (para no alterar los valores interpolados que se afirman) pero registra cada invocacion:
  // asi un test puede exigir que un objeto destinado a jsonb REALMENTE pase por sql.json (si se quitara
  // el sql.json, jsonCalls quedaria vacio y el assert fallaria, en vez de un falso verde).
  tagged.json = (v: unknown) => { jsonCalls.push(v); return v; };
  tagged.calls = calls;
  tagged.jsonCalls = jsonCalls;
  return tagged;
}

const TS = '2026-06-28T00:00:00.000Z';
const individualProfileRow = {
  id: 'user-1', org_id: null, account_type: 'individual', role: 'individual',
  full_name: 'Ada', identity_verified: false, tier: 'free', created_at: TS, updated_at: TS,
};
const orgProfileRow = {
  id: 'user-1', org_id: 'org-1', account_type: 'empresa_member', role: 'org_admin',
  full_name: 'Ada', identity_verified: false, tier: 'free', created_at: TS, updated_at: TS,
};
const subRow = { id: 's1', profile_id: 'user-1', plan: 'free', status: 'active', created_at: TS };
const usageRow = { id: 'u1', profile_id: 'user-1', runs_used: 0, runs_limit: 10, period_kind: 'lifetime', created_at: TS };
const pendingOrgRow = { id: 'org-1', name: 'Acme', status: 'pending', approved_at: null, created_at: TS, updated_at: TS };

const allText = (sql: MockSql): string => sql.calls.map((c) => c.text).join('\n---\n');
const findCall = (sql: MockSql, needle: string): RecordedCall | undefined =>
  sql.calls.find((c) => c.text.includes(needle));

describe('RegistrationRepository.registerIndividual', () => {
  it('crea perfil + suscripcion free + usage_counter en transaccion y mapea el estado', async () => {
    const sql = makeSql([
      [{ id: 'user-1' }], // insert profile (creado)
      [],                 // insert subscriptions
      [],                 // insert usage_counters
      [individualProfileRow], // loadState: profiles
      [subRow],           // loadState: subscriptions
      [usageRow],         // loadState: usage_counters
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const result = await repo.registerIndividual({ sub: 'user-1', fullName: 'Ada' });

    expect(result.created).toBe(true);
    expect(result.needsRegistration).toBe(false);
    expect(result.profile).toMatchObject({ accountType: 'individual', role: 'individual', orgId: null, identityVerified: false, fullName: 'Ada' });
    expect(result.subscription).toMatchObject({ plan: 'free' });
    expect(result.usageCounter).toMatchObject({ runsUsed: 0, runsLimit: 10, periodKind: 'lifetime' });

    const insertProfile = findCall(sql, 'insert into profiles');
    expect(insertProfile?.text).toContain('on conflict (id) do nothing');
    expect(insertProfile?.text).toContain("'individual', 'individual'");
    expect(insertProfile?.values).toEqual(['user-1', 'Ada']);
    expect(findCall(sql, 'insert into subscriptions')?.text).toContain("'free'");
    expect(findCall(sql, 'insert into usage_counters')?.text).toContain("'lifetime'");
    expect(findCall(sql, 'insert into usage_counters')?.text).toContain('10');

    // Atomicidad: las TRES escrituras corren dentro de la transaccion (tx:true). Una variante que
    // las moviera fuera de begin haria fallar este assert.
    const inserts = sql.calls.filter((c) => /insert into (profiles|subscriptions|usage_counters)/.test(c.text));
    expect(inserts).toHaveLength(3);
    expect(inserts.every((c) => c.tx)).toBe(true);
  });

  it('aborta sin escrituras posteriores si una insercion falla (todo o nada)', async () => {
    const sql = makeSql([
      [{ id: 'user-1' }],          // insert profile -> ok (creado)
      new Error('boom subscriptions'), // insert subscriptions -> falla
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    await expect(repo.registerIndividual({ sub: 'user-1', fullName: 'Ada' })).rejects.toThrow('boom subscriptions');
    // El error se propaga (la transaccion real haria rollback): no se intenta el usage_counter ni
    // se lee el estado final.
    expect(sql.calls.some((c) => c.text.includes('insert into usage_counters'))).toBe(false);
    expect(sql.calls.some((c) => c.text.includes('from profiles'))).toBe(false);
  });

  it('es idempotente: si el perfil ya existe no inserta suscripcion ni contador (created=false)', async () => {
    const sql = makeSql([
      [],                 // insert profile -> 0 filas (conflicto)
      [individualProfileRow], // loadState: profiles
      [subRow],           // loadState: subscriptions
      [usageRow],         // loadState: usage_counters
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const result = await repo.registerIndividual({ sub: 'user-1', fullName: 'Ada' });

    expect(result.created).toBe(false);
    expect(result.profile?.id).toBe('user-1');
    expect(allText(sql)).not.toContain('insert into subscriptions');
    expect(allText(sql)).not.toContain('insert into usage_counters');
  });
});

describe('RegistrationRepository.registerOrganization', () => {
  it('crea org en pending y perfil org_admin sin suscripcion', async () => {
    const sql = makeSql([
      [],                 // select profiles existente -> no existe
      [{ id: 'org-1' }],  // insert organizations
      [],                 // insert profiles
      [orgProfileRow],    // loadState: profiles
      [pendingOrgRow],    // loadState: organizations
      [],                 // loadState: subscriptions
      [],                 // loadState: usage_counters
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const result = await repo.registerOrganization({ sub: 'user-1', orgName: 'Acme', fullName: 'Ada' });

    expect(result.created).toBe(true);
    expect(result.organization).toMatchObject({ name: 'Acme', status: 'pending', approvedAt: null });
    expect(result.profile).toMatchObject({ accountType: 'empresa_member', role: 'org_admin', orgId: 'org-1' });
    expect(result.subscription).toBeNull();
    expect(result.usageCounter).toBeNull();

    expect(findCall(sql, 'insert into organizations')?.text).toContain("'pending'");
    expect(findCall(sql, 'insert into organizations')?.values).toEqual(['Acme']);
    const insertProfile = findCall(sql, 'insert into profiles');
    expect(insertProfile?.text).toContain("'empresa_member', 'org_admin'");
    expect(insertProfile?.values).toEqual(['user-1', 'org-1', 'Ada']);
    // NO crea suscripcion al registrar empresa (se asigna al aprobar/comprar).
    expect(allText(sql)).not.toContain('insert into subscriptions');
    expect(allText(sql)).not.toContain('insert into usage_counters');
  });

  it('es idempotente: si el perfil ya existe no crea otra organizacion (created=false)', async () => {
    const sql = makeSql([
      [{ id: 'user-1' }], // select profiles existente -> existe
      [orgProfileRow],    // loadState: profiles
      [pendingOrgRow],    // loadState: organizations
      [],                 // loadState: subscriptions
      [],                 // loadState: usage_counters
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const result = await repo.registerOrganization({ sub: 'user-1', orgName: 'Acme', fullName: 'Ada' });

    expect(result.created).toBe(false);
    expect(allText(sql)).not.toContain('insert into organizations');
  });

  it('bajo carrera (TOCTOU): si el insert de perfil choca (23505) devuelve estado actual, no 500', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const sql = makeSql([
      [],                  // select profiles (tx) -> no existe (otro request gano despues de esto)
      [{ id: 'org-1' }],   // insert organizations (tx)
      uniqueViolation,     // insert profiles (tx) -> unique_violation, la tx hace rollback
      // getState (fuera de tx) tras el rollback, ve lo que dejo el request ganador:
      [orgProfileRow],     // profiles
      [pendingOrgRow],     // organizations
      [],                  // subscriptions
      [],                  // usage_counters
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const result = await repo.registerOrganization({ sub: 'user-1', orgName: 'Acme', fullName: 'Ada' });

    expect(result.created).toBe(false);
    expect(result.profile?.role).toBe('org_admin');
    // El estado idempotente se lee fuera de la transaccion abortada (tx:false).
    const stateRead = sql.calls.filter((c) => c.text.includes('from profiles'));
    expect(stateRead.some((c) => c.tx === false)).toBe(true);
  });
});

describe('RegistrationRepository.getState', () => {
  it('needsRegistration true si no hay perfil', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const state = await repo.getState('user-1');
    expect(state.needsRegistration).toBe(true);
    expect(state.profile).toBeNull();
  });

  it('consolida perfil + org + suscripcion + usage para un individuo', async () => {
    const sql = makeSql([[individualProfileRow], [subRow], [usageRow]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const state = await repo.getState('user-1');
    expect(state.needsRegistration).toBe(false);
    expect(state.profile?.id).toBe('user-1');
    expect(state.organization).toBeNull(); // org_id null -> no consulta organizations
    expect(state.subscription?.plan).toBe('free');
    expect(state.usageCounter?.runsLimit).toBe(10);
    expect(allText(sql)).not.toContain('from organizations');
  });

  it('incluye la organizacion cuando el perfil tiene org_id', async () => {
    const sql = makeSql([[orgProfileRow], [pendingOrgRow], [], []]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const state = await repo.getState('user-1');
    expect(state.organization).toMatchObject({ id: 'org-1', status: 'pending' });
    expect(findCall(sql, 'from organizations')?.values).toEqual(['org-1']);
  });
});

describe('RegistrationRepository.approveOrganization', () => {
  it('marca approved, preserva approved_at con coalesce y mapea el returning', async () => {
    const sql = makeSql([[{ id: 'org-1', name: 'Acme', status: 'approved', approved_at: TS, created_at: TS, updated_at: TS }]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const org = await repo.approveOrganization('org-1');
    expect(org).toMatchObject({ id: 'org-1', status: 'approved' });
    expect(org?.approvedAt).toBe(TS);

    const update = findCall(sql, 'update organizations');
    expect(update?.text).toContain("status = 'approved'");
    expect(update?.text).toContain('approved_at = coalesce(approved_at, now())');
    expect(update?.values).toEqual(['org-1']);
  });

  it('devuelve null si la organizacion no existe', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.approveOrganization('no-existe')).toBeNull();
  });
});

describe('RegistrationRepository.getProfileTier', () => {
  it('devuelve el tier del perfil (lectura liviana por sub)', async () => {
    const sql = makeSql([[{ tier: 'autonomous' }]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.getProfileTier('user-1')).toBe('autonomous');

    const select = findCall(sql, 'select tier from profiles');
    expect(select?.values).toEqual(['user-1']);
  });

  it('devuelve null si el perfil no existe (sin registro completo)', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.getProfileTier('desconocido')).toBeNull();
  });
});

describe('RegistrationRepository.isAdmin', () => {
  it('devuelve true si el perfil es super-admin (is_admin true), leyendo por sub', async () => {
    const sql = makeSql([[{ is_admin: true }]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.isAdmin('user-1')).toBe(true);

    const select = findCall(sql, 'select is_admin from profiles');
    expect(select?.values).toEqual(['user-1']);
  });

  it('devuelve false si el perfil no es admin (is_admin false)', async () => {
    const sql = makeSql([[{ is_admin: false }]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.isAdmin('user-1')).toBe(false);
  });

  it('devuelve false si el perfil no existe (fail-closed: sin perfil = no admin)', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.isAdmin('desconocido')).toBe(false);
  });
});

describe('RegistrationRepository.updateProfileTier', () => {
  it('actualiza el tier, toca updated_at y mapea el perfil del returning', async () => {
    const sql = makeSql([[{ ...individualProfileRow, tier: 'autonomous' }]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const profile = await repo.updateProfileTier('user-1', 'autonomous');
    expect(profile).toMatchObject({ id: 'user-1', tier: 'autonomous' });

    const update = findCall(sql, 'update profiles');
    expect(update?.text).toContain('set tier =');
    expect(update?.text).toContain('updated_at = now()');
    expect(update?.values).toEqual(['autonomous', 'user-1']);
  });

  it('devuelve null si el perfil no existe', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    expect(await repo.updateProfileTier('no-existe', 'pro')).toBeNull();
  });
});

describe('RegistrationRepository.recordAdminAction', () => {
  it('inserta una fila en admin_actions con actor/action/target/details', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    await repo.recordAdminAction({
      actorId: 'admin-1',
      action: 'change_tier',
      targetId: 'user-1',
      details: { from: 'free', to: 'autonomous' },
    });

    const insert = findCall(sql, 'insert into admin_actions');
    expect(insert?.text).toContain('(actor_id, action, target_id, details)');
    expect(insert?.values).toEqual(['admin-1', 'change_tier', 'user-1', { from: 'free', to: 'autonomous' }]);
    // details DEBE serializarse via sql.json (columna jsonb): si se quitara el sql.json, jsonCalls
    // quedaria vacio y este assert fallaria (en postgres.js un objeto plano sin json() no va a jsonb).
    expect(sql.jsonCalls).toContainEqual({ from: 'free', to: 'autonomous' });
  });

  it('acepta actorId null (accion via x-admin-token sin identidad de actor)', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    await repo.recordAdminAction({
      actorId: null,
      action: 'change_tier',
      targetId: 'user-1',
      details: { from: 'free', to: 'pro' },
    });

    const insert = findCall(sql, 'insert into admin_actions');
    expect(insert?.values?.[0]).toBeNull();
    expect(insert?.values?.[3]).toEqual({ from: 'free', to: 'pro' });
    expect(sql.jsonCalls).toContainEqual({ from: 'free', to: 'pro' });
  });
});

describe('RegistrationRepository.listUsers', () => {
  // Filas tal como vienen de la base (snake_case + email del join + total_count). total_count llega como
  // STRING porque count(*) over() es bigint: el mapeo debe convertirlo a number (toInt).
  const adminRowA = {
    id: 'user-1', email: 'ada@test.com', full_name: 'Ada', account_type: 'individual',
    role: 'individual', is_admin: false, tier: 'free', identity_verified: false,
    created_at: TS, total_count: '2',
  };
  const adminRowB = {
    id: 'user-2', email: null, full_name: 'Bob', account_type: 'empresa_member',
    role: 'org_admin', is_admin: true, tier: 'pro', identity_verified: true,
    created_at: TS, total_count: '2',
  };

  it('lista la plataforma en UNA sola query con join a auth.users, count(*) over() y orden estable', async () => {
    const sql = makeSql([[adminRowA, adminRowB]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const page = await repo.listUsers({ limit: 20, offset: 0 });

    // SIN N+1: UNA sola consulta para toda la pagina (jamas una query por usuario).
    expect(sql.calls).toHaveLength(1);
    const q = sql.calls[0];
    // El email sale del JOIN a auth.users (no vive en profiles); el rol de servicio puede leerlo.
    expect(q?.text).toContain('left join auth.users u on u.id = p.id');
    // El total sale de la VENTANA en la MISMA query, no de rows.length ni de una segunda consulta.
    expect(q?.text).toContain('count(*) over()');
    // Orden estable: created_at desc con id desc como desempate (paginacion sin repetir ni saltar filas).
    expect(q?.text).toContain('order by p.created_at desc, p.id desc');
    // Columnas EXPLICITAS (nunca select * / p.*): un select * omitiria en silencio is_admin/email si
    // faltara en la base, en vez de fallar ruidoso. Se afirman las dos columnas criticas del listado.
    expect(q?.text).toContain('p.is_admin');
    expect(q?.text).toContain('u.email');
    expect(q?.text).not.toMatch(/select\s+\*/);
    expect(q?.text).not.toContain('p.*');
    // Sin search -> sin filtro: no hay WHERE ni ILIKE.
    expect(q?.text).not.toContain('where');
    expect(q?.text).not.toContain('ilike');
    // limit/offset van PARAMETRIZADOS (valores ligados), no interpolados como texto.
    expect(q?.values).toEqual([20, 0]);

    // Mapeo camelCase: email del join (incl. null), is_admin -> isAdmin, total desde total_count (bigint
    // string -> number).
    expect(page.total).toBe(2);
    expect(page.users).toHaveLength(2);
    expect(page.users[0]).toEqual({
      id: 'user-1', email: 'ada@test.com', fullName: 'Ada', accountType: 'individual',
      role: 'individual', isAdmin: false, tier: 'free', identityVerified: false, createdAt: TS,
    });
    // Left join sin fila en auth.users -> email null se conserva; is_admin true -> isAdmin true.
    expect(page.users[1]).toMatchObject({ id: 'user-2', email: null, isAdmin: true, tier: 'pro' });
  });

  it('pagina vacia (offset mas alla del final): total 0 y sin filas, en una sola query', async () => {
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const page = await repo.listUsers({ limit: 20, offset: 1000 });
    expect(page.users).toEqual([]);
    expect(page.total).toBe(0);
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.values).toEqual([20, 1000]);
  });

  it('con search: ILIKE por email/full_name PARAMETRIZADO (no inyectable) y escapando metacaracteres de LIKE', async () => {
    const sql = makeSql([[adminRowA]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    // Termino con metacaracteres de LIKE (% _ \) y con sintaxis "peligrosa" de SQL.
    await repo.listUsers({ limit: 10, offset: 5, search: "a%_\\'; drop table profiles; --" });

    expect(sql.calls).toHaveLength(1);
    const q = sql.calls[0];
    // Filtra por AMBOS campos con ILIKE, sobre el mismo join.
    expect(q?.text).toContain('u.email ilike');
    expect(q?.text).toContain('p.full_name ilike');
    expect(q?.text).toContain('left join auth.users u on u.id = p.id');

    // PARAMETRIZADO: el termino viaja SOLO como valor ligado, JAMAS como texto SQL. La parte peligrosa
    // NO aparece en el texto de la consulta (que solo tiene <param> en los huecos). Si la ruta/el repo
    // concatenara el search en el SQL, este assert fallaria.
    expect(q?.text).not.toContain('drop table');

    // El patron escapa % _ \ (-> \% \_ \\) para match LITERAL y se envuelve en %...%. Se interpola dos
    // veces (email y full_name), luego limit y offset. Si se quitara escapeLike, el % tipeado actuaria
    // como comodin y este valor esperado no coincidiria.
    const expectedPattern = "%a\\%\\_\\\\'; drop table profiles; --%";
    expect(q?.values).toEqual([expectedPattern, expectedPattern, 10, 5]);
  });

  it('search vacio no llega aca como filtro: con undefined no arma WHERE (la ruta normaliza vacio -> undefined)', async () => {
    const sql = makeSql([[adminRowA]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    await repo.listUsers({ limit: 20, offset: 0, search: undefined });
    expect(sql.calls[0]?.text).not.toContain('ilike');
  });
});

describe('RegistrationRepository.getUserDetail', () => {
  it('ficha de un individuo: REUSA loadState y agrega is_admin + email via join a auth.users', async () => {
    // loadState (individuo, org_id null -> sin query de organizations): profiles, subscriptions, usage.
    // Luego la query dedicada de is_admin + email (id objetivo distinto al del propio llamador).
    const sql = makeSql([
      [individualProfileRow], // loadState: profiles
      [subRow],               // loadState: subscriptions
      [usageRow],             // loadState: usage_counters
      [{ is_admin: true, email: 'ada@test.com' }], // is_admin + email (join auth.users)
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const detail = await repo.getUserDetail('user-1');

    expect(detail).not.toBeNull();
    // El profile incluye is_admin (que sale de la query dedicada, NO del modelo Profile) y solo los campos
    // curados de la ficha (sin org_id ni updated_at).
    expect(detail?.profile).toEqual({
      id: 'user-1',
      fullName: 'Ada',
      accountType: 'individual',
      role: 'individual',
      isAdmin: true,
      tier: 'free',
      identityVerified: false,
      createdAt: TS,
    });
    expect(detail?.email).toBe('ada@test.com');
    expect(detail?.subscription).toMatchObject({ plan: 'free', status: 'active' });
    expect(detail?.usageCounter).toMatchObject({ runsUsed: 0, runsLimit: 10, periodKind: 'lifetime' });
    // La ficha NO expone organization (loadState la traeria para empresas, pero la ficha no la incluye).
    expect(detail && 'organization' in detail).toBe(false);

    // is_admin + email salen de UNA query con el mismo left join a auth.users que listUsers, parametrizada
    // por el id objetivo (jamas concatenado).
    const meta = findCall(sql, 'select p.is_admin, u.email');
    expect(meta?.text).toContain('left join auth.users u on u.id = p.id');
    expect(meta?.values).toEqual(['user-1']);
    // Individuo (org_id null): loadState NO consulta organizations.
    expect(allText(sql)).not.toContain('from organizations');
  });

  it('devuelve null si el usuario objetivo no existe (404 en el route) sin correr la query de email', async () => {
    // loadState ve profiles vacio -> profile null -> getUserDetail corta antes de la query de is_admin/email.
    const sql = makeSql([[]]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const detail = await repo.getUserDetail('desconocido');

    expect(detail).toBeNull();
    // Solo se consulto profiles; la query de is_admin/email NO se ejecuto (no hay a quien describir).
    expect(sql.calls).toHaveLength(1);
    expect(allText(sql)).not.toContain('u.email');
  });

  it('empresa: reusa loadState (incluye la query de organizations) pero la ficha no expone la org', async () => {
    const sql = makeSql([
      [orgProfileRow],  // loadState: profiles (org_id no nulo)
      [pendingOrgRow],  // loadState: organizations
      [],               // loadState: subscriptions (empresa sin plan -> null)
      [],               // loadState: usage_counters (null)
      [{ is_admin: false, email: 'bob@test.com' }], // is_admin + email
    ]);
    const repo = new RegistrationRepository(sql as unknown as Sql);
    const detail = await repo.getUserDetail('user-1');

    expect(detail?.profile).toMatchObject({ accountType: 'empresa_member', role: 'org_admin', isAdmin: false });
    expect(detail?.email).toBe('bob@test.com');
    expect(detail?.subscription).toBeNull();
    expect(detail?.usageCounter).toBeNull();
    // Reuso de loadState confirmado (corrio la query de organizations) aunque la ficha no la devuelva.
    expect(allText(sql)).toContain('from organizations');
    expect(detail && 'organization' in detail).toBe(false);
  });
});
