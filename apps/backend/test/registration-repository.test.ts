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
}

function makeSql(results: Array<unknown[] | Error>): MockSql {
  const queue = [...results];
  const calls: RecordedCall[] = [];
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
  tagged.json = (v: unknown) => v;
  tagged.calls = calls;
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
