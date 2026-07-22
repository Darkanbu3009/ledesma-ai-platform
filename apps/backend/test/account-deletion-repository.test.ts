import { describe, it, expect } from 'vitest';
import { AccountDeletionRepository } from '../src/account/account-deletion-repository.js';
import type { Sql } from '../src/db/client.js';

/**
 * MOCK CON ESTADO del cliente `sql`. A diferencia de un mock que devuelve valores fijos, este mantiene un
 * "mini Postgres" en memoria (filas por tabla) y APLICA de verdad cada consulta del motor: evalua el
 * predicado WHERE real (que columna, que valor), respeta las FK RESTRICT que fuerzan el orden
 * (subscriptions/usage_counters -> profiles, profiles -> organizations) y hace ROLLBACK real en begin
 * (snapshot + restore). Asi los tests detectan regresiones que un mock permisivo dejaria pasar:
 *   - usar la columna equivocada en un WHERE (borra 0 filas o las de otro),
 *   - contar mal los miembros de la org (destino de la org equivocado),
 *   - reordenar los DELETE (viola una FK RESTRICT -> lanza),
 *   - mapear mal un campo del resultado (conteos distintos por tabla lo delatan),
 *   - romper la atomicidad (el rollback restaura TODO).
 */
interface Row {
  [col: string]: string | null;
}
type Db = Record<string, Row[]>;

interface RecordedCall {
  text: string;
  values: unknown[];
  tx: boolean;
}
interface MockSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin<T>(cb: (tx: Sql) => Promise<T>): Promise<T>;
  calls: RecordedCall[];
  db: Db;
}

class FkViolation extends Error {}

/** Acceso seguro a una tabla del mini-DB (nunca undefined). */
const tbl = (db: Db, name: string): Row[] => db[name] ?? [];

function makeStatefulSql(initial: Db, opts: { failOn?: string } = {}): MockSql {
  const db: Db = structuredClone(initial);
  const calls: RecordedCall[] = [];

  const exec = (tx: boolean) =>
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
      const text = Array.from(strings).join(' ? ');
      calls.push({ text, values, tx });
      if (opts.failOn && text.includes(opts.failOn)) {
        return Promise.reject(new Error(`fallo simulado en: ${opts.failOn}`));
      }
      try {
        return Promise.resolve(evaluate(db, text, values));
      } catch (err) {
        return Promise.reject(err);
      }
    };

  const tagged = exec(false) as unknown as MockSql;
  // begin REAL: snapshot antes, restaura (rollback) si el callback lanza, y re-propaga.
  tagged.begin = async <T>(cb: (tx: Sql) => Promise<T>): Promise<T> => {
    const snapshot = structuredClone(db);
    try {
      return await cb(exec(true) as unknown as Sql);
    } catch (err) {
      for (const k of Object.keys(db)) delete db[k];
      for (const k of Object.keys(snapshot)) db[k] = snapshot[k] ?? [];
      throw err;
    }
  };
  tagged.calls = calls;
  tagged.db = db;
  return tagged;
}

/** Interpreta y aplica una consulta contra el mini-DB. Lanza FkViolation si un DELETE viola una FK RESTRICT. */
function evaluate(db: Db, text: string, values: unknown[]): unknown[] {
  const t = text.replace(/\s+/g, ' ').trim();

  // select org_id from profiles where id = ?
  if (t.startsWith('select org_id from profiles')) {
    const id = values[0];
    return tbl(db, 'profiles').filter((r) => r.id === id).map((r) => ({ org_id: r.org_id ?? null }));
  }

  // select count(*)::int as n from profiles where org_id = ? [and id <> ?]
  if (t.includes('count(*)')) {
    const hasOrgFilter = /org_id\s*=/.test(t);
    const hasSelfExcl = /id\s*<>/.test(t) || /id\s*!=/.test(t);
    const orgVal = values[0];
    const selfVal = hasSelfExcl ? values[values.length - 1] : undefined;
    const n = tbl(db, 'profiles').filter((r) => {
      if (hasOrgFilter && r.org_id !== orgVal) return false;
      if (hasSelfExcl && r.id === selfVal) return false;
      return true;
    }).length;
    return [{ n }];
  }

  // select id from organizations where id = ? for update  (lock: no-op en el mock)
  if (t.startsWith('select id from organizations')) {
    const id = values[0];
    return tbl(db, 'organizations').filter((r) => r.id === id).map((r) => ({ id: r.id }));
  }

  // update admin_actions set actor_id = null where actor_id = ? returning id
  if (t.startsWith('update admin_actions')) {
    const actor = values[0];
    const affected = tbl(db, 'admin_actions').filter((r) => r.actor_id === actor);
    affected.forEach((r) => {
      r.actor_id = null;
    });
    return affected.map((r) => ({ id: r.id }));
  }

  // delete from organizations where id = ?
  if (t.startsWith('delete from organizations')) {
    const id = values[0];
    // FK RESTRICT: profiles.org_id -> organizations(id). No se puede borrar si algun perfil la referencia.
    if (tbl(db, 'profiles').some((r) => r.org_id === id)) {
      throw new FkViolation('FK: organizations referenciada por profiles');
    }
    db.organizations = tbl(db, 'organizations').filter((r) => r.id !== id);
    return [];
  }

  // delete from <table> where <col> = ? returning id
  const del = t.match(/^delete from (\w+) where (\w+)\s*=/);
  if (del) {
    const table = del[1] as string;
    const col = del[2] as string;
    const val = values[0];
    // FK RESTRICT: profiles no se puede borrar si subscriptions/usage_counters la referencian.
    if (table === 'profiles') {
      const referenced = (r: Row): boolean => r.profile_id === val;
      if (tbl(db, 'subscriptions').some(referenced) || tbl(db, 'usage_counters').some(referenced)) {
        throw new FkViolation('FK: profiles referenciada por subscriptions/usage_counters');
      }
    }
    const rows = tbl(db, table);
    const removed = rows.filter((r) => r[col] === val);
    db[table] = rows.filter((r) => r[col] !== val);
    // sitios_conectados devuelve ademas contexto_externo_id (returning id, contexto_externo_id).
    if (table === 'sitios_conectados') {
      return removed.map((r) => ({ id: r.id, contexto_externo_id: r.contexto_externo_id ?? null }));
    }
    // FK ON DELETE CASCADE (V030): borrar una trayectoria arrastra sus pasos, como en Postgres.
    if (table === 'trayectorias_web') {
      const removedIds = new Set(removed.map((r) => r.id));
      db.pasos_trayectoria = tbl(db, 'pasos_trayectoria').filter(
        (r) => !removedIds.has(r.trayectoria_id ?? ''),
      );
    }
    return removed.map((r) => ({ id: r.id }));
  }

  return [];
}

/** Construye N filas {id, <col>=owner} para una tabla de negocio. */
function ownedRows(owner: string, n: number, col = 'owner_id'): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${owner}-${col}-${i}`, [col]: owner }));
}

/** Nombre de tabla mutada por una consulta (para afirmar el orden y la anonimizacion). */
function mutationTargets(sql: MockSql): string[] {
  return sql.calls
    .map((c) => {
      const del = c.text.match(/delete from (\w+) where/);
      if (del) return del[1] as string;
      if (c.text.includes('update admin_actions')) return 'admin_actions(anon)';
      return null;
    })
    .filter((x): x is string => x !== null);
}

// Conteos DISTINTOS por tabla para owner-A: si el objeto de retorno transpusiera un campo (p.ej.
// jobs: agentRuns.length), el numero no cuadraria y el test fallaria.
const A_COUNTS: Record<string, number> = {
  agent_runs: 2, jobs: 3, scheduled_tasks: 4, triggers: 5, recipes: 6, processing_records: 7,
  agents: 8, provider_credentials: 9, consents: 10, data_subject_requests: 11, upgrade_requests: 12,
  subscriptions: 13, usage_counters: 14, sitios_conectados: 15, trayectorias_web: 16,
};

const OWNER_TABLES = ['agent_runs', 'jobs', 'scheduled_tasks', 'triggers', 'recipes', 'processing_records', 'agents', 'provider_credentials', 'consents', 'data_subject_requests', 'upgrade_requests', 'sitios_conectados', 'trayectorias_web'];

/** DB con dos owners (A y B) en la MISMA org 'org-1', + admin_actions con A como actor y como target. */
function sharedOrgDb(): Db {
  const db: Db = {};
  for (const t of OWNER_TABLES) {
    db[t] = [...ownedRows('owner-A', A_COUNTS[t] ?? 1), ...ownedRows('owner-B', 1)];
  }
  // sitios_conectados: dos filas de A con contexto en el proveedor externo (deben volver en
  // sitiosConectadosContextosExternos) y el resto sin el (contexto_externo_id null: no deben volver).
  db.sitios_conectados = (db.sitios_conectados ?? []).map((r, i) => ({
    ...r,
    contexto_externo_id: r.owner_id === 'owner-A' && i < 2 ? `ctx-${i}` : null,
  }));
  // pasos_trayectoria (V030): un paso por trayectoria, ligado por trayectoria_id (sin owner_id
  // propio: su dueno es el de la cabecera). Deben caer por el cascade al borrar trayectorias_web.
  db.pasos_trayectoria = tbl(db, 'trayectorias_web').map((r, i) => ({
    id: `paso-${i}`,
    trayectoria_id: r.id ?? null,
  }));
  db.subscriptions = [...ownedRows('owner-A', A_COUNTS.subscriptions ?? 1, 'profile_id'), ...ownedRows('owner-B', 1, 'profile_id')];
  db.usage_counters = [...ownedRows('owner-A', A_COUNTS.usage_counters ?? 1, 'profile_id'), ...ownedRows('owner-B', 1, 'profile_id')];
  db.profiles = [
    { id: 'owner-A', org_id: 'org-1' },
    { id: 'owner-B', org_id: 'org-1' },
  ];
  db.organizations = [{ id: 'org-1' }];
  db.admin_actions = [
    { id: 'aa1', actor_id: 'owner-A', target_id: 'owner-B' }, // A fue ACTOR
    { id: 'aa2', actor_id: 'owner-B', target_id: 'owner-A' }, // A fue TARGET (no se toca actor)
    { id: 'aa3', actor_id: null, target_id: 'z' },
  ];
  return db;
}

const BUSINESS_TABLES = OWNER_TABLES;

describe('AccountDeletionRepository.deleteAccountData', () => {
  it('borra TODOS los datos del owner y NO toca los de otro owner (aislamiento real, org compartida)', async () => {
    const sql = makeStatefulSql(sharedOrgDb());
    const result = await new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A');

    // owner-A: cero filas en toda tabla de negocio; owner-B: intactas.
    for (const t of BUSINESS_TABLES) {
      expect(tbl(sql.db, t).filter((r) => r.owner_id === 'owner-A')).toHaveLength(0);
      expect(tbl(sql.db, t).filter((r) => r.owner_id === 'owner-B')).toHaveLength(1);
    }
    for (const t of ['subscriptions', 'usage_counters']) {
      expect(tbl(sql.db, t).filter((r) => r.profile_id === 'owner-A')).toHaveLength(0);
      expect(tbl(sql.db, t).filter((r) => r.profile_id === 'owner-B')).toHaveLength(1);
    }
    // El perfil de A se borro; el de B sobrevive (eso lo removio de la org).
    expect(tbl(sql.db, 'profiles').map((r) => r.id)).toEqual(['owner-B']);
    // CRITICO: org COMPARTIDA (B sigue) -> NO se borra.
    expect(tbl(sql.db, 'organizations').map((r) => r.id)).toEqual(['org-1']);
    expect(result.organization).toBe('retained_shared');

    // Conteos por tabla: distintos por tabla -> valida el mapeo campo->consulta (sin transposiciones).
    expect(result).toMatchObject({
      agentRuns: 2, jobs: 3, scheduledTasks: 4, triggers: 5, recipes: 6, processingRecords: 7,
      agents: 8, providerCredentials: 9, consents: 10, dataSubjectRequests: 11, upgradeRequests: 12,
      subscriptions: 13, usageCounters: 14, sitiosConectados: 15, trayectoriasWeb: 16, profiles: 1,
    });
    // Los contexto_externo_id NO NULOS de los sitios borrados vuelven para el purgado en el
    // proveedor externo (7.1b); los null se filtran.
    expect(result.sitiosConectadosContextosExternos.sort()).toEqual(['ctx-0', 'ctx-1']);
  });

  it('ARCO en cascada (V030): borrar trayectorias_web del owner arrastra sus pasos y respeta los ajenos', async () => {
    const sql = makeStatefulSql(sharedOrgDb());
    await new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A');

    // Ninguna trayectoria de A sobrevive y, via el cascade, tampoco ninguno de sus pasos.
    const trayectoriasB = tbl(sql.db, 'trayectorias_web');
    expect(trayectoriasB.filter((r) => r.owner_id === 'owner-A')).toHaveLength(0);
    const idsB = new Set(trayectoriasB.map((r) => r.id));
    const pasos = tbl(sql.db, 'pasos_trayectoria');
    // Los pasos que quedan son EXACTAMENTE los de las trayectorias de B.
    expect(pasos.length).toBeGreaterThan(0);
    expect(pasos.every((p) => idsB.has(p.trayectoria_id ?? ''))).toBe(true);
  });

  it('ANONIMIZA admin_actions: nulifica actor_id del owner, CONSERVA las filas y no toca target ajeno', async () => {
    const sql = makeStatefulSql(sharedOrgDb());
    const result = await new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A');

    // Las 3 filas siguen existiendo (no se borro ninguna).
    expect(tbl(sql.db, 'admin_actions')).toHaveLength(3);
    // aa1: A era ACTOR -> actor_id nulificado; la fila (accion + target) persiste.
    const aa1 = tbl(sql.db, 'admin_actions').find((r) => r.id === 'aa1');
    expect(aa1?.actor_id).toBeNull();
    expect(aa1?.target_id).toBe('owner-B');
    // aa2: A era TARGET -> se CONSERVA tal cual (no se borra ni se toca su actor/target).
    const aa2 = tbl(sql.db, 'admin_actions').find((r) => r.id === 'aa2');
    expect(aa2?.actor_id).toBe('owner-B');
    expect(aa2?.target_id).toBe('owner-A');
    // Solo aa1 fue anonimizada.
    expect(result.adminActionsAnonymized).toBe(1);
    // Jamas un DELETE sobre admin_actions.
    expect(sql.calls.some((c) => c.text.includes('delete from admin_actions'))).toBe(false);
  });

  it('org de UNICO miembro: la borra (y solo entonces)', async () => {
    const db = sharedOrgDb();
    // owner-A es el UNICO miembro de org-1. owner-C existe en OTRA org (org-2): asi el conteo DEBE
    // filtrar por org_id (si no filtrara, contaria a C y la org quedaria erroneamente 'retained').
    db.profiles = [
      { id: 'owner-A', org_id: 'org-1' },
      { id: 'owner-C', org_id: 'org-2' },
    ];
    db.organizations = [{ id: 'org-1' }, { id: 'org-2' }];
    const sql = makeStatefulSql(db);
    const result = await new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A');

    // org-1 borrada; org-2 (de owner-C) intacta.
    expect(tbl(sql.db, 'organizations').map((r) => r.id)).toEqual(['org-2']);
    expect(result.organization).toBe('deleted');
    // Toma el lock `for update` sobre la org antes de decidir (serializa borrados concurrentes).
    expect(sql.calls.some((c) => c.text.includes('select id from organizations') && c.text.includes('for update'))).toBe(true);
    // profiles se borro (si no, el mock lanzaria FkViolation al borrar la org).
    expect(mutationTargets(sql)).toContain('profiles');
  });

  it('owner individual (sin org): organization = none, ninguna org afectada', async () => {
    const db = sharedOrgDb();
    db.profiles = [{ id: 'owner-A', org_id: null }, { id: 'owner-B', org_id: 'org-1' }];
    const sql = makeStatefulSql(db);
    const result = await new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A');
    expect(result.organization).toBe('none');
    expect(tbl(sql.db, 'organizations').map((r) => r.id)).toEqual(['org-1']);
    // Sin org propia: no se emite ni lock ni conteo de miembros.
    expect(sql.calls.some((c) => c.text.includes('for update'))).toBe(false);
    expect(sql.calls.some((c) => c.text.includes('count(*)'))).toBe(false);
  });

  it('ORDEN: todo dentro de begin (tx) y en el orden que respeta las FKs', async () => {
    const sql = makeStatefulSql(sharedOrgDb());
    await new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A');

    // TODAS las consultas corren dentro de la transaccion.
    expect(sql.calls.every((c) => c.tx)).toBe(true);

    const t = mutationTargets(sql);
    const idx = (x: string): number => t.indexOf(x);
    // Hijos de agents antes que agents.
    for (const child of ['agent_runs', 'jobs', 'scheduled_tasks', 'triggers', 'recipes', 'processing_records']) {
      expect(idx(child)).toBeGreaterThanOrEqual(0);
      expect(idx(child)).toBeLessThan(idx('agents'));
    }
    // subscriptions/usage_counters antes que profiles.
    expect(idx('subscriptions')).toBeLessThan(idx('profiles'));
    expect(idx('usage_counters')).toBeLessThan(idx('profiles'));
    // admin_actions se anonimiza (aparece como update, no delete).
    expect(t).toContain('admin_actions(anon)');
  });

  it('ATOMICIDAD: un fallo a mitad revierte TODO (rollback real) -- la cuenta queda intacta', async () => {
    const sql = makeStatefulSql(sharedOrgDb(), { failOn: 'delete from recipes' });
    const before = structuredClone(sql.db);
    await expect(
      new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A'),
    ).rejects.toThrow('fallo simulado');

    // NADA se borro: el estado es identico al inicial (rollback). Incluso lo ya "borrado" (agent_runs,
    // jobs, scheduled_tasks, triggers) volvio. La cuenta de owner-A sigue completa.
    expect(sql.db).toEqual(before);
    expect(tbl(sql.db, 'profiles').map((r) => r.id).sort()).toEqual(['owner-A', 'owner-B']);
    // Todo lo emitido fue transaccional (por eso el rollback aplica).
    expect(sql.calls.every((c) => c.tx)).toBe(true);
  });

  it('org COMPARTIDA: nunca se borra la org mientras haya otro miembro; owner-B intacto en TODAS las tablas', async () => {
    const sql = makeStatefulSql(sharedOrgDb());
    await expect(
      new AccountDeletionRepository(sql as unknown as Sql).deleteAccountData('owner-A'),
    ).resolves.toMatchObject({ organization: 'retained_shared' });
    expect(tbl(sql.db, 'organizations')).toHaveLength(1);
    // owner-B totalmente intacto (owner_id / profile_id / id segun la tabla).
    for (const t of [...BUSINESS_TABLES, 'subscriptions', 'usage_counters', 'profiles']) {
      const bRows = tbl(sql.db, t).filter((r) => r.owner_id === 'owner-B' || r.profile_id === 'owner-B' || r.id === 'owner-B');
      expect(bRows.length).toBeGreaterThanOrEqual(1);
    }
  });
});
