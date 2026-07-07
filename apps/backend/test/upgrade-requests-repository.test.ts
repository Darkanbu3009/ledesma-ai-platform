import { describe, it, expect } from 'vitest';
import { UpgradeRequestsRepository } from '../src/upgrade/upgrade-requests-repository.js';
import type { Sql } from '../src/db/client.js';

interface RecordedCall {
  text: string;
  values: unknown[];
}

interface MockSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  calls: RecordedCall[];
}

/**
 * Mock del cliente `sql` (tagged template de postgres.js). Cada invocacion consume el siguiente resultado
 * de la cola y registra el texto del template (con <param> en cada hueco) y los valores interpolados, para
 * poder afirmar tanto sobre el SQL generado (columnas del WHERE, ramas con/sin filtro, orden) como sobre
 * los parametros ligados. Una entrada Error hace RECHAZAR esa consulta (para probar el catch del 23505).
 * Mismo enfoque que registration-repository.test.ts, pero sin begin/json (este repo no los usa).
 */
function makeSql(results: Array<unknown[] | Error>): MockSql {
  const queue = [...results];
  const calls: RecordedCall[] = [];
  const tagged = ((strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    calls.push({ text: Array.from(strings).join('<param>'), values });
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? []);
  }) as MockSql;
  tagged.calls = calls;
  return tagged;
}

const TS = '2026-07-01T00:00:00.000Z';
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    owner_id: 'user-1',
    requested_tier: 'autonomous',
    feature_context: 'scheduled_tasks',
    status: 'pending',
    note: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

const findCall = (sql: MockSql, needle: string): RecordedCall | undefined =>
  sql.calls.find((c) => c.text.includes(needle));

/** Error de unique_violation de Postgres (SQLSTATE 23505), como lo lanzaria el driver ante el indice unico parcial. */
const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

// ---------------------------------------------------------------------------------------------------
// createRequest: INSERT + anti-duplicado por 23505 (la unica defensa ante clicks CONCURRENTES)
// ---------------------------------------------------------------------------------------------------

describe('UpgradeRequestsRepository.createRequest', () => {
  it('inserta y devuelve created:true, con owner/tier/feature como parametros ligados', async () => {
    const sql = makeSql([[makeRow()]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const result = await repo.createRequest({
      ownerId: 'user-1',
      requestedTier: 'autonomous',
      featureContext: 'scheduled_tasks',
    });

    expect(result.created).toBe(true);
    expect(result.upgradeRequest).toMatchObject({
      id: 'req-1',
      ownerId: 'user-1',
      requestedTier: 'autonomous',
      featureContext: 'scheduled_tasks',
      status: 'pending',
    });
    const insert = findCall(sql, 'insert into upgrade_requests');
    expect(insert).toBeDefined();
    // owner/tier/feature van SIEMPRE como parametros ($1,$2,$3), nunca concatenados.
    expect(insert?.values).toEqual(['user-1', 'autonomous', 'scheduled_tasks']);
    expect(insert?.text).not.toContain('select *');
  });

  it('featureContext ausente se liga como null', async () => {
    const sql = makeSql([[makeRow({ feature_context: null })]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const result = await repo.createRequest({ ownerId: 'user-1', requestedTier: 'pro' });
    expect(result.upgradeRequest.featureContext).toBeNull();
    expect(findCall(sql, 'insert into upgrade_requests')?.values).toEqual(['user-1', 'pro', null]);
  });

  it('ANTI-DUPLICADO concurrente: si el INSERT choca (23505) devuelve la existente con created:false, no 500', async () => {
    const existing = makeRow({ id: 'winner-id' });
    const sql = makeSql([
      uniqueViolation(), // INSERT -> choca con el indice unico parcial
      [existing], // findPendingByOwnerAndTier -> la fila del ganador de la carrera
    ]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const result = await repo.createRequest({
      ownerId: 'user-1',
      requestedTier: 'autonomous',
      featureContext: 'triggers',
    });

    expect(result.created).toBe(false);
    expect(result.upgradeRequest.id).toBe('winner-id');
    // Se hizo el INSERT y luego el SELECT de recuperacion (acotado por owner+tier+pending).
    expect(sql.calls).toHaveLength(2);
    const recover = sql.calls[1];
    expect(recover?.text).toContain('from upgrade_requests');
    expect(recover?.text).toContain("status = 'pending'");
    expect(recover?.values).toEqual(['user-1', 'autonomous']);
  });

  it('si el 23505 ocurre pero ya no hay pending (borrada entremedio), re-lanza el error', async () => {
    const sql = makeSql([uniqueViolation(), []]); // recuperacion no encuentra fila
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    await expect(
      repo.createRequest({ ownerId: 'user-1', requestedTier: 'autonomous' }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('un error que NO es unique_violation se propaga tal cual (no se traga)', async () => {
    const sql = makeSql([new Error('conexion caida')]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    await expect(
      repo.createRequest({ ownerId: 'user-1', requestedTier: 'autonomous' }),
    ).rejects.toThrow('conexion caida');
    // No intenta recuperar (no es 23505): solo la llamada del INSERT.
    expect(sql.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
// findPendingByOwnerAndTier: aislamiento por owner + tier + status pending
// ---------------------------------------------------------------------------------------------------

describe('UpgradeRequestsRepository.findPendingByOwnerAndTier', () => {
  it('filtra por owner + tier + status pending y mapea la fila', async () => {
    const sql = makeSql([[makeRow()]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const found = await repo.findPendingByOwnerAndTier('user-1', 'autonomous');
    expect(found?.id).toBe('req-1');
    const call = sql.calls[0];
    expect(call?.text).toContain('where owner_id = <param> and requested_tier = <param> and status = ');
    expect(call?.text).toContain("status = 'pending'");
    expect(call?.values).toEqual(['user-1', 'autonomous']);
  });

  it('devuelve null si no hay pending', async () => {
    const sql = makeSql([[]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    expect(await repo.findPendingByOwnerAndTier('user-1', 'pro')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// listByOwner: solo las del owner
// ---------------------------------------------------------------------------------------------------

describe('UpgradeRequestsRepository.listByOwner', () => {
  it('acota por owner_id y mapea las filas (mas nuevas primero)', async () => {
    const sql = makeSql([[makeRow(), makeRow({ id: 'req-2', feature_context: null })]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const rows = await repo.listByOwner('user-1');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.featureContext).toBeNull();
    const call = sql.calls[0];
    expect(call?.text).toContain('where owner_id = <param>');
    expect(call?.text).toContain('order by created_at desc');
    expect(call?.values).toEqual(['user-1']);
  });
});

// ---------------------------------------------------------------------------------------------------
// listAll (admin): ramas con/sin filtro por status, total via count(*) over(), orden estable
// ---------------------------------------------------------------------------------------------------

describe('UpgradeRequestsRepository.listAll', () => {
  it('sin status: NO filtra, ordena estable y deriva el total del count(*) over()', async () => {
    // total_count llega como string (bigint): el repo debe parsearlo a number, no usar rows.length.
    const sql = makeSql([
      [makeRow({ total_count: '7' }), makeRow({ id: 'req-2', total_count: '7' })],
    ]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const page = await repo.listAll({ limit: 20, offset: 0 });

    expect(page.total).toBe(7); // del count de la ventana, NO items.length (2)
    expect(page.items).toHaveLength(2);
    const call = sql.calls[0];
    expect(call?.text).toContain('count(*) over() as total_count');
    expect(call?.text).not.toContain('where status');
    expect(call?.text).toContain('order by created_at desc, id desc');
    expect(call?.values).toEqual([20, 0]); // limit, offset
  });

  it('con status: filtra por status y liga limit/offset como parametros', async () => {
    const sql = makeSql([[makeRow({ status: 'contacted', total_count: '3' })]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const page = await repo.listAll({ limit: 10, offset: 5, status: 'contacted' });

    expect(page.total).toBe(3);
    const call = sql.calls[0];
    expect(call?.text).toContain('where status = <param>');
    // status va como primer parametro, luego limit y offset.
    expect(call?.values).toEqual(['contacted', 10, 5]);
  });

  it('pagina vacia (offset pasado el final): total 0 sin romper', async () => {
    const sql = makeSql([[]]);
    const repo = new UpgradeRequestsRepository(sql as unknown as Sql);
    const page = await repo.listAll({ limit: 20, offset: 999 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});
