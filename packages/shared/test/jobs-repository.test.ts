import { describe, it, expect, vi } from 'vitest';
import {
  CANCELADO_POR_USUARIO_ERROR,
  CANCELADO_POR_USUARIO_PREFIX,
  JobsRepository,
  SISTEMA_DETUVO_TAREA_ERROR,
  SISTEMA_DETUVO_TAREA_PREFIX,
  type Sql,
} from '../src/jobs/jobs-repository.js';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-9999-9999-999999999999',
    agent_id: '11111111-1111-1111-1111-111111111111',
    owner_id: 'user-1',
    credential_id: '22222222-2222-2222-2222-222222222222',
    status: 'pending',
    payload: { messages: [{ role: 'user', content: 'hola' }] },
    scheduled_for: null,
    attempts: 0,
    last_error: null,
    created_at: '2026-06-30T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

/** Mock del tagged template `sql`: devuelve el resultado preprogramado y expone `.json`. */
function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

/** Texto del template SQL de la primera llamada al mock, con <param> en cada hueco. */
function sqlText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>');
}

/** Valores (parametros) pasados al primer template SQL. */
function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[0] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

/** Mock del tagged template `sql` que devuelve un resultado DISTINTO por llamada, en orden. */
function makeSqlSequence(results: unknown[][]): Sql {
  let llamada = 0;
  const fn = vi.fn(async () => results[llamada++] ?? []) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

/** Texto del template SQL de la llamada `n` al mock, con <param> en cada hueco. */
function sqlTextOf(sql: Sql, n: number): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[n]?.[0] ?? []).join('<param>');
}

/** Valores (parametros) pasados al template SQL de la llamada `n`. */
function sqlValuesOf(sql: Sql, n: number): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[n] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

/** Cantidad de llamadas al mock sql. */
function llamadas(sql: Sql): number {
  return (sql as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

describe('JobsRepository', () => {
  describe('createJob', () => {
    it('inserta y mapea la fila a Job (snake_case -> camelCase)', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const job = await new JobsRepository(sql).createJob({
        agentId: '11111111-1111-1111-1111-111111111111',
        ownerId: 'user-1',
        credentialId: '22222222-2222-2222-2222-222222222222',
        payload: { messages: [{ role: 'user', content: 'hola' }] },
      });
      expect(job).toMatchObject({
        id: '99999999-9999-9999-9999-999999999999',
        agentId: '11111111-1111-1111-1111-111111111111',
        ownerId: 'user-1',
        credentialId: '22222222-2222-2222-2222-222222222222',
        status: 'pending',
        scheduledFor: null,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
      });
    });

    it('el SQL inserta en jobs con columnas explicitas y usa sql.json para el payload', async () => {
      const sql = makeSqlReturning([makeRow()]);
      await new JobsRepository(sql).createJob({
        agentId: 'a1',
        ownerId: 'user-1',
        credentialId: 'c1',
        payload: { foo: 'bar' },
        scheduledFor: null,
      });
      const texto = sqlText(sql);
      expect(texto).toContain('insert into jobs');
      expect(texto).not.toContain('returning *');
      expect(texto).toContain('credential_id');
      // payload pasa por sql.json (el mock lo devuelve tal cual): el valor llega como objeto.
      expect(sqlValues(sql)).toContainEqual({ foo: 'bar' });
    });

    it('scheduledFor ausente se inserta como null', async () => {
      const sql = makeSqlReturning([makeRow()]);
      await new JobsRepository(sql).createJob({
        agentId: 'a1',
        ownerId: 'user-1',
        credentialId: 'c1',
        payload: {},
      });
      // ultimo parametro = scheduled_for; sin el campo cae a null.
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('getNextPendingJob', () => {
    it('devuelve null si la cola esta vacia', async () => {
      expect(await new JobsRepository(makeSqlReturning([])).getNextPendingJob()).toBeNull();
    });

    it('es read-only: filtra por elegibilidad, ordena por created_at y NO bloquea', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const job = await new JobsRepository(sql).getNextPendingJob();
      expect(job?.id).toBe('99999999-9999-9999-9999-999999999999');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'pending'");
      expect(texto).toContain('scheduled_for is null or scheduled_for <= now()');
      expect(texto).toContain('order by created_at asc');
      expect(texto).toContain('limit 1');
      // PEEK: jamas debe bloquear ni mutar.
      expect(texto.toLowerCase()).not.toContain('for update');
      expect(texto.toLowerCase()).not.toContain('update jobs set');
    });
  });

  describe('countPending', () => {
    it('devuelve el conteo como number', async () => {
      // count(*)::int puede llegar como number o como string (bigint): ambos se normalizan.
      expect(await new JobsRepository(makeSqlReturning([{ count: 3 }])).countPending()).toBe(3);
      expect(await new JobsRepository(makeSqlReturning([{ count: '7' }])).countPending()).toBe(7);
      expect(await new JobsRepository(makeSqlReturning([])).countPending()).toBe(0);
    });
  });

  describe('countByStatusForOwner', () => {
    it('AISLAMIENTO: filtra por owner_id, agrupa por status y NO usa la elegibilidad global de countPending', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).countByStatusForOwner('user-1');
      const texto = sqlText(sql);
      expect(texto).toContain('from jobs');
      expect(texto).toContain('where owner_id = ');
      expect(texto).toContain('group by status');
      // A diferencia de countPending (global, sobre elegibles), esta no filtra por elegibilidad de cola.
      expect(texto).not.toContain('scheduled_for');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });

    it('mapea los estados presentes y rellena los ausentes con 0 (siempre las 5 claves)', async () => {
      const sql = makeSqlReturning([
        { status: 'pending', count: 2 },
        { status: 'failed', count: '3' }, // bigint como string: se normaliza a number
        { status: 'pausado', count: 1 },
      ]);
      expect(await new JobsRepository(sql).countByStatusForOwner('user-1')).toEqual({
        pending: 2,
        running: 0,
        completed: 0,
        failed: 3,
        pausado: 1,
      });
    });

    it('owner sin jobs (0 filas) -> las 5 claves en 0, sin error', async () => {
      expect(await new JobsRepository(makeSqlReturning([])).countByStatusForOwner('user-1')).toEqual({
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        pausado: 0,
      });
    });

    it('ignora un status inesperado (esquema divergente) sin contaminar el conteo', async () => {
      const sql = makeSqlReturning([
        { status: 'completed', count: 5 },
        { status: 'zombie', count: 9 },
      ]);
      expect(await new JobsRepository(sql).countByStatusForOwner('user-1')).toEqual({
        pending: 0,
        running: 0,
        completed: 5,
        failed: 0,
        pausado: 0,
      });
    });
  });

  describe('claimNextJob', () => {
    it('devuelve null si no hay job elegible', async () => {
      expect(await new JobsRepository(makeSqlReturning([])).claimNextJob()).toBeNull();
    });

    it('toma el job atomicamente con FOR UPDATE SKIP LOCKED y lo pasa a running', async () => {
      const sql = makeSqlReturning([makeRow({ status: 'running', attempts: 1, started_at: '2026-06-30T01:00:00.000Z' })]);
      const job = await new JobsRepository(sql).claimNextJob();
      expect(job?.status).toBe('running');
      expect(job?.attempts).toBe(1);
      expect(job?.startedAt).toBe('2026-06-30T01:00:00.000Z');
      const texto = sqlText(sql).toLowerCase();
      expect(texto).toContain('update jobs set');
      expect(texto).toContain("status = 'running'");
      expect(texto).toContain('attempts = attempts + 1');
      expect(texto).toContain('for update skip locked');
      expect(texto).toContain('returning id');
      expect(texto).not.toContain('returning *');
    });
  });

  describe('transiciones de estado', () => {
    it('markRunning setea running + started_at acotado por id', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markRunning('job-1');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'running'");
      expect(texto).toContain('started_at = now()');
      expect(texto).toContain('where id = ');
      expect(sqlValues(sql)).toEqual(['job-1']);
    });

    it('markCompleted setea completed + finished_at', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markCompleted('job-1');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'completed'");
      expect(texto).toContain('finished_at = now()');
      expect(sqlValues(sql)).toEqual(['job-1']);
    });

    it('markFailed setea failed + last_error con el detalle', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markFailed('job-1', 'boom');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'failed'");
      expect(texto).toContain('last_error = ');
      // valores: last_error primero, luego el id del where.
      expect(sqlValues(sql)).toEqual(['boom', 'job-1']);
    });

    it('markPendingRetry vuelve a pending (no terminal): last_error + scheduled_for + started_at null', async () => {
      const sql = makeSqlReturning([]);
      const when = new Date('2026-07-01T00:00:00.000Z');
      await new JobsRepository(sql).markPendingRetry('job-1', 'transitorio', when);
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'pending'");
      expect(texto).toContain('last_error = ');
      expect(texto).toContain('scheduled_for = ');
      expect(texto).toContain('started_at = null');
      // NO toca attempts (lo lleva el claim) ni finished_at (no es terminal).
      expect(texto).not.toContain('attempts');
      expect(texto).not.toContain('finished_at');
      // valores: last_error, luego scheduled_for, luego el id del where.
      expect(sqlValues(sql)).toEqual(['transitorio', when, 'job-1']);
    });

    it('markPendingRetry sin scheduled_for lo deja en null (elegible de inmediato)', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markPendingRetry('job-1', 'transitorio');
      expect(sqlValues(sql)).toEqual(['transitorio', null, 'job-1']);
    });

    it('COMPARE-AND-SET: los tres cierres solo aplican si el job SIGUE running (guarda vs reaper / N workers)', async () => {
      const completed = makeSqlReturning([]);
      await new JobsRepository(completed).markCompleted('job-1');
      expect(sqlText(completed)).toContain("where id = ");
      expect(sqlText(completed)).toContain("status = 'running'");

      const failed = makeSqlReturning([]);
      await new JobsRepository(failed).markFailed('job-1', 'boom');
      expect(sqlText(failed)).toContain("status = 'running'");

      const pending = makeSqlReturning([]);
      await new JobsRepository(pending).markPendingRetry('job-1', 'transitorio');
      expect(sqlText(pending)).toContain("status = 'running'");
    });
  });

  describe('reapOrphanedJobs (reaper por latido)', () => {
    const STALE_MS = 90_000;

    it('SQL: los candidatos son SOLO running cuyo updated_at (el latido) es mas viejo que el umbral', async () => {
      const sql = makeSqlReturning([]);
      const reaped = await new JobsRepository(sql).reapOrphanedJobs({ staleMs: STALE_MS, maxAttempts: 3 });
      const texto = sqlText(sql).toLowerCase();
      expect(texto).toContain("where status = 'running'");
      expect(texto).toContain('updated_at < now() -');
      expect(texto).toContain('make_interval');
      expect(texto).not.toContain('pausado');
      // El umbral viaja en SEGUNDOS (make_interval secs).
      expect(sqlValues(sql)).toContain(90);
      expect(reaped).toEqual([]);
    });

    it('un tarea_web detenido va DIRECTO a failed con SISTEMA_DETUVO_TAREA, con CAS de status y updated_at (D2/D3)', async () => {
      const sql = makeSqlSequence([
        [{ id: 'job-web', updated_at_txt: '2026-07-24 22:54:00.123456+00', payload_kind: 'tarea_web', attempts: 1 }],
        [{ id: 'job-web', status: 'failed', attempts: 1 }],
      ]);
      const reaped = await new JobsRepository(sql).reapOrphanedJobs({ staleMs: STALE_MS, maxAttempts: 3 });
      expect(reaped).toEqual([{ id: 'job-web', status: 'failed', attempts: 1 }]);
      const texto = sqlTextOf(sql, 1).toLowerCase();
      expect(texto).toContain("status = 'failed'");
      // CAS: el UPDATE verifica que status y updated_at no cambiaron desde la lectura.
      expect(texto).toContain("status = 'running'");
      expect(texto).toContain('updated_at = ');
      expect(texto).toContain('::timestamptz');
      expect(texto).not.toContain("'pending'");
      const values = sqlValuesOf(sql, 1);
      expect(values.some((v) => typeof v === 'string' && v.startsWith('SISTEMA_DETUVO_TAREA: '))).toBe(true);
      expect(values).toContain('2026-07-24 22:54:00.123456+00');
    });

    it('un job de sitio detenido tampoco se reencola: failed directo aunque le queden intentos', async () => {
      const sql = makeSqlSequence([
        [{ id: 'job-sitio', updated_at_txt: '2026-07-24 22:54:00+00', payload_kind: 'conectar_sitio', attempts: 1 }],
        [{ id: 'job-sitio', status: 'failed', attempts: 1 }],
      ]);
      const reaped = await new JobsRepository(sql).reapOrphanedJobs({ staleMs: STALE_MS, maxAttempts: 3 });
      expect(reaped).toEqual([{ id: 'job-sitio', status: 'failed', attempts: 1 }]);
      expect(sqlTextOf(sql, 1)).toContain("status = 'failed'");
    });

    it('un job simple detenido conserva el comportamiento de siempre: pending si le quedan intentos, failed si no', async () => {
      const sql = makeSqlSequence([
        [
          { id: 'job-a-pending', updated_at_txt: '2026-07-24 22:54:00+00', payload_kind: null, attempts: 1 },
          { id: 'job-a-failed', updated_at_txt: '2026-07-24 22:55:00+00', payload_kind: null, attempts: 3 },
        ],
        [{ id: 'job-a-pending', status: 'pending', attempts: 1 }],
        [{ id: 'job-a-failed', status: 'failed', attempts: 3 }],
      ]);
      const reaped = await new JobsRepository(sql).reapOrphanedJobs({ staleMs: STALE_MS, maxAttempts: 3 });
      expect(reaped).toEqual([
        { id: 'job-a-pending', status: 'pending', attempts: 1 },
        { id: 'job-a-failed', status: 'failed', attempts: 3 },
      ]);
      const pendingSql = sqlTextOf(sql, 1).toLowerCase();
      expect(pendingSql).toContain("status = 'pending'");
      expect(pendingSql).toContain('started_at = null');
      const failedSql = sqlTextOf(sql, 2).toLowerCase();
      expect(failedSql).toContain("status = 'failed'");
      expect(failedSql).toContain('finished_at = now()');
    });

    it('si el CAS afecta 0 filas (el job latio o lo cerro otro actor entre medio), NO se reporta recogido', async () => {
      const sql = makeSqlSequence([
        [{ id: 'job-vivo', updated_at_txt: '2026-07-24 22:54:00+00', payload_kind: 'tarea_web', attempts: 1 }],
        [],
      ]);
      const reaped = await new JobsRepository(sql).reapOrphanedJobs({ staleMs: STALE_MS, maxAttempts: 3 });
      expect(reaped).toEqual([]);
    });
  });

  describe('latirJob (latido del job en ejecucion)', () => {
    it("refresca updated_at SOLO sobre 'running' y devuelve 'running' si el latido aplico", async () => {
      const sql = makeSqlSequence([[{ id: 'job-1' }]]);
      const status = await new JobsRepository(sql).latirJob('job-1');
      expect(status).toBe('running');
      const texto = sqlTextOf(sql, 0).toLowerCase();
      expect(texto).toContain('update jobs set updated_at = now()');
      expect(texto).toContain("status = 'running'");
      // Con el latido aplicado no hace falta releer el estado.
      expect(llamadas(sql)).toBe(1);
    });

    it('si el job ya no esta running, relee y devuelve el estado actual (cancelacion cooperativa)', async () => {
      const sql = makeSqlSequence([[], [{ status: 'failed' }]]);
      const status = await new JobsRepository(sql).latirJob('job-1');
      expect(status).toBe('failed');
    });

    it('un job inexistente devuelve null', async () => {
      const sql = makeSqlSequence([[], []]);
      const status = await new JobsRepository(sql).latirJob('job-x');
      expect(status).toBeNull();
    });
  });

  describe('cancelarPorUsuario (terminar desde la consola)', () => {
    it("cancela un job propio cancelable: failed + CANCELADO_POR_USUARIO, acotado por owner y estados", async () => {
      const sql = makeSqlSequence([[{ estado_previo: 'running' }]]);
      const resultado = await new JobsRepository(sql).cancelarPorUsuario('job-1', 'user-1');
      expect(resultado).toEqual({ resultado: 'cancelado', estadoPrevio: 'running' });
      const texto = sqlTextOf(sql, 0).toLowerCase();
      expect(texto).toContain("owner_id = ");
      expect(texto).toContain("status in ('pending', 'running', 'pausado')");
      expect(texto).toContain("status = 'failed'");
      expect(texto).toContain('finished_at = now()');
      const values = sqlValuesOf(sql, 0);
      expect(values).toContain('user-1');
      expect(values.some((v) => typeof v === 'string' && v.startsWith('CANCELADO_POR_USUARIO: '))).toBe(true);
    });

    it('devuelve el estado previo pausado (la ruta cierra la aprobacion asociada con el)', async () => {
      const sql = makeSqlSequence([[{ estado_previo: 'pausado' }]]);
      const resultado = await new JobsRepository(sql).cancelarPorUsuario('job-1', 'user-1');
      expect(resultado).toEqual({ resultado: 'cancelado', estadoPrevio: 'pausado' });
    });

    it('un job ya terminado responde conflicto, sin efectos', async () => {
      const sql = makeSqlSequence([[], [{ id: 'job-1' }]]);
      const resultado = await new JobsRepository(sql).cancelarPorUsuario('job-1', 'user-1');
      expect(resultado).toEqual({ resultado: 'conflicto' });
    });

    it('un job ajeno o inexistente responde no_encontrado (jamas se toca ni se revela)', async () => {
      const sql = makeSqlSequence([[], []]);
      const resultado = await new JobsRepository(sql).cancelarPorUsuario('job-1', 'user-ajeno');
      expect(resultado).toEqual({ resultado: 'no_encontrado' });
    });
  });

  describe('rowToJob', () => {
    it('mapea timestamps nullables a null y conserva ISO en los not-null', async () => {
      const sql = makeSqlReturning([
        makeRow({
          scheduled_for: '2026-07-01T00:00:00.000Z',
          started_at: '2026-06-30T01:00:00.000Z',
          finished_at: '2026-06-30T02:00:00.000Z',
          last_error: 'algo',
        }),
      ]);
      const job = await new JobsRepository(sql).getNextPendingJob();
      expect(job?.scheduledFor).toBe('2026-07-01T00:00:00.000Z');
      expect(job?.startedAt).toBe('2026-06-30T01:00:00.000Z');
      expect(job?.finishedAt).toBe('2026-06-30T02:00:00.000Z');
      expect(job?.lastError).toBe('algo');
    });
  });

  describe('listByOwner', () => {
    // Fila del LISTADO (resumen): NO trae payload entero, solo `payload_kind` escalar + columnas seguras.
    function makeSummaryRow(overrides: Record<string, unknown> = {}) {
      return {
        id: '99999999-9999-9999-9999-999999999999',
        agent_id: '11111111-1111-1111-1111-111111111111',
        status: 'completed',
        payload_kind: null,
        attempts: 1,
        last_error: null,
        scheduled_for: null,
        created_at: '2026-06-30T00:00:00.000Z',
        started_at: '2026-06-30T00:01:00.000Z',
        finished_at: '2026-06-30T00:02:00.000Z',
        ...overrides,
      };
    }

    it('AISLAMIENTO: filtra por owner_id, ordena por created_at desc y pagina con limit/offset', async () => {
      const sql = makeSqlReturning([makeSummaryRow()]);
      const jobs = await new JobsRepository(sql).listByOwner('user-1', { limit: 20, offset: 40 });
      expect(jobs).toHaveLength(1);
      const texto = sqlText(sql);
      expect(texto).toContain('from jobs');
      expect(texto).toContain('where owner_id = ');
      expect(texto).toContain('order by created_at desc');
      expect(texto).toContain('limit ');
      expect(texto).toContain('offset ');
      // Owner del parametro, limit y offset viajan como parametros (no interpolados en el texto).
      expect(sqlValues(sql)).toEqual(['user-1', 20, 40]);
    });

    it('NO expone el payload: selecciona payload->>\'kind\' como escalar, nunca el payload entero ni select *', async () => {
      const sql = makeSqlReturning([makeSummaryRow()]);
      await new JobsRepository(sql).listByOwner('user-1', { limit: 20, offset: 0 });
      const texto = sqlText(sql);
      expect(texto).toContain("payload->>'kind' as payload_kind");
      expect(texto).not.toContain('select *');
      // No selecciona la columna payload cruda (solo su discriminador escalar).
      expect(texto).not.toMatch(/,\s*payload\s*,/);
    });

    it('sin status: la query no filtra por estado', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      const texto = sqlText(sql);
      expect(texto).not.toContain('status = ');
      expect(sqlValues(sql)).toEqual(['user-1', 10, 0]);
    });

    it('con status: agrega el filtro y lo pasa como parametro', async () => {
      const sql = makeSqlReturning([makeSummaryRow({ status: 'failed' })]);
      await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0, status: 'failed' });
      const texto = sqlText(sql);
      expect(texto).toContain('and status = ');
      // owner, status, limit, offset (en ese orden dentro del template).
      expect(sqlValues(sql)).toEqual(['user-1', 'failed', 10, 0]);
    });

    it('infiere el type del payload_kind: recipe, los tres kinds de sitio, y simple para el resto', async () => {
      const sql = makeSqlReturning([
        makeSummaryRow({ id: 'j-recipe', payload_kind: 'recipe' }),
        makeSummaryRow({ id: 'j-simple', payload_kind: null }),
        makeSummaryRow({ id: 'j-otro', payload_kind: 'algo-raro' }),
        makeSummaryRow({ id: 'j-conectar', payload_kind: 'conectar_sitio' }),
        makeSummaryRow({ id: 'j-confirmar', payload_kind: 'confirmar_conexion' }),
        makeSummaryRow({ id: 'j-desconectar', payload_kind: 'desconectar_sitio' }),
      ]);
      const jobs = await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      expect(jobs.map((j) => [j.id, j.type])).toEqual([
        ['j-recipe', 'recipe'],
        ['j-simple', 'simple'],
        ['j-otro', 'simple'],
        ['j-conectar', 'sitio'],
        ['j-confirmar', 'sitio'],
        ['j-desconectar', 'sitio'],
      ]);
    });

    it('agent_id nulo (job de sitio, V026) se mapea a agentId null', async () => {
      const sql = makeSqlReturning([makeSummaryRow({ agent_id: null, payload_kind: 'conectar_sitio' })]);
      const [job] = await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      expect(job?.agentId).toBeNull();
      expect(job?.type).toBe('sitio');
    });

    it('mapea el resumen a camelCase y NO incluye payload ni ownerId', async () => {
      const sql = makeSqlReturning([
        makeSummaryRow({ status: 'failed', attempts: 3, last_error: 'boom', payload_kind: 'recipe' }),
      ]);
      const [job] = await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      expect(job).toEqual({
        id: '99999999-9999-9999-9999-999999999999',
        agentId: '11111111-1111-1111-1111-111111111111',
        status: 'failed',
        type: 'recipe',
        attempts: 3,
        lastError: 'boom',
        scheduledFor: null,
        createdAt: '2026-06-30T00:00:00.000Z',
        startedAt: '2026-06-30T00:01:00.000Z',
        finishedAt: '2026-06-30T00:02:00.000Z',
        // Escalares derivados del resultado (Fase F paso 2): false salvo en una tarea web que
        // corrio con lo aprendido de una vez anterior.
        conLoAprendido: false,
        ajustadaSola: false,
      });
      // Explicito: el resumen no filtra datos sensibles ni redundantes. `resultado` entero jamas
      // sale del repositorio: solo los dos booleanos derivados de arriba.
      expect(job).not.toHaveProperty('payload');
      expect(job).not.toHaveProperty('ownerId');
      expect(job).not.toHaveProperty('resultado');
    });
  });

  describe('getSummaryForOwner', () => {
    function makeSummaryRow(overrides: Record<string, unknown> = {}) {
      return {
        id: '99999999-9999-9999-9999-999999999999',
        agent_id: null,
        status: 'completed',
        payload_kind: 'conectar_sitio',
        attempts: 1,
        last_error: null,
        scheduled_for: null,
        created_at: '2026-06-30T00:00:00.000Z',
        started_at: '2026-06-30T00:01:00.000Z',
        finished_at: '2026-06-30T00:02:00.000Z',
        ...overrides,
      };
    }

    it('AISLAMIENTO: consulta por id + owner_id y devuelve el resumen sin payload', async () => {
      const sql = makeSqlReturning([makeSummaryRow()]);
      const job = await new JobsRepository(sql).getSummaryForOwner('job-1', 'user-1');
      const texto = sqlText(sql);
      expect(texto).toContain('where id = ');
      expect(texto).toContain('and owner_id = ');
      expect(texto).toContain("payload->>'kind' as payload_kind");
      expect(texto).not.toContain('select *');
      expect(sqlValues(sql)).toEqual(['job-1', 'user-1']);
      expect(job).toMatchObject({ id: '99999999-9999-9999-9999-999999999999', type: 'sitio', agentId: null });
      expect(job).not.toHaveProperty('payload');
      expect(job).not.toHaveProperty('ownerId');
    });

    it('job ajeno o inexistente -> null (0 filas)', async () => {
      const sql = makeSqlReturning([]);
      const job = await new JobsRepository(sql).getSummaryForOwner('job-1', 'user-2');
      expect(job).toBeNull();
    });
  });
});

describe('JobsRepository: existeFalloPermanenteReciente (barrera anti relanzamiento, BUG A)', () => {
  it('true si hay un job failed reciente de tarea web sobre el mismo owner+conexion', async () => {
    const sql = makeSqlReturning([{ id: 'job-1' }]);
    const hay = await new JobsRepository(sql).existeFalloPermanenteReciente('user-1', 'con-1', 120_000);
    expect(hay).toBe(true);
    const texto = sqlText(sql);
    expect(texto).toContain("status = 'failed'");
    expect(texto).toContain("payload->>'kind' = <param>");
    expect(texto).toContain("payload->>'connectionId' = <param>");
    expect(texto).toContain('finished_at > now() - make_interval');
    expect(sqlValues(sql)).toEqual([
      'user-1',
      'tarea_web',
      'con-1',
      120,
      CANCELADO_POR_USUARIO_PREFIX,
      SISTEMA_DETUVO_TAREA_PREFIX,
    ]);
  });

  it('false sin filas (sin fallo reciente): la tarea se puede encolar', async () => {
    const sql = makeSqlReturning([]);
    const hay = await new JobsRepository(sql).existeFalloPermanenteReciente('user-1', 'con-1', 120_000);
    expect(hay).toBe(false);
  });

  it('EXCLUYE cancelaciones del usuario y detenciones del sistema: el usuario ya decidio (test 5)', async () => {
    // La exencion compara contra los MISMOS prefijos que escriben cancelarPorUsuario y el reaper de
    // latido: un job cancelado o detenido NO activa la barrera aunque este failed y reciente.
    const sql = makeSqlReturning([]);
    await new JobsRepository(sql).existeFalloPermanenteReciente('user-1', 'con-1', 120_000);
    const texto = sqlText(sql);
    // starts_with y no LIKE: los prefijos traen guiones bajos, comodines en LIKE, que ampliarian la
    // exencion mas alla de lo escrito (y una exencion de mas deja pasar un relanzamiento).
    expect(texto).toContain('not starts_with(last_error, <param>)');
    expect(texto).not.toContain('like');
    // Un last_error null (fila vieja sin detalle) SI cuenta como fallo permanente: ante la duda,
    // la barrera bloquea (el costo de un falso positivo es esperar la ventana, no perder datos).
    expect(texto).toContain('last_error is null');
  });

  it('los prefijos de la exencion son los MISMOS que escriben cancelacion y reaper (no literales)', () => {
    // Si alguien cambia el texto de un prefijo, la exencion lo sigue: son la misma constante que usan
    // CANCELADO_POR_USUARIO_ERROR y SISTEMA_DETUVO_TAREA_ERROR, los valores que llegan a last_error.
    expect(CANCELADO_POR_USUARIO_ERROR.startsWith(CANCELADO_POR_USUARIO_PREFIX)).toBe(true);
    expect(SISTEMA_DETUVO_TAREA_ERROR.startsWith(SISTEMA_DETUVO_TAREA_PREFIX)).toBe(true);
  });
});

describe('JobsRepository (7.1d: resultado de jobs)', () => {
  describe('guardarResultado', () => {
    it('escribe jobs.resultado como json SOLO sobre un job running', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).guardarResultado('job-1', { estado: 'ok', resumen: 'listo' });
      const text = sqlText(sql);
      expect(text).toContain('update jobs set resultado =');
      expect(text).toContain("status = 'running'");
      expect(sqlValues(sql)).toEqual([{ estado: 'ok', resumen: 'listo' }, 'job-1']);
    });
  });

  describe('obtenerJobDeOwner', () => {
    it('devuelve estado + resultado + lastError acotado por owner', async () => {
      const sql = makeSqlReturning([
        { id: 'job-1', status: 'completed', resultado: { estado: 'ok' }, last_error: null },
      ]);
      const job = await new JobsRepository(sql).obtenerJobDeOwner('job-1', 'user-1');
      expect(job).toEqual({ id: 'job-1', status: 'completed', resultado: { estado: 'ok' }, lastError: null });
      expect(sqlText(sql)).toContain('owner_id = <param>');
      expect(sqlValues(sql)).toEqual(['job-1', 'user-1']);
    });

    it('null si el job no existe o es de otro owner (jamas su resultado)', async () => {
      const sql = makeSqlReturning([]);
      const job = await new JobsRepository(sql).obtenerJobDeOwner('job-1', 'otro-user');
      expect(job).toBeNull();
    });

    it('resultado ausente normaliza a null', async () => {
      const sql = makeSqlReturning([
        { id: 'job-1', status: 'pending', resultado: null, last_error: null },
      ]);
      const job = await new JobsRepository(sql).obtenerJobDeOwner('job-1', 'user-1');
      expect(job?.resultado).toBeNull();
    });
  });
});

describe('JobsRepository (7.1e: checkpoints de aprobacion, estado pausado)', () => {
  describe('marcarPausado', () => {
    it("pausa con CAS sobre 'running' (solo el worker que posee el job)", async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).marcarPausado('job-1');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'pausado'");
      expect(texto).toContain("status = 'running'");
      expect(sqlValues(sql)).toEqual(['job-1']);
    });
  });

  describe('reanudarDePausado', () => {
    it("devuelve a 'pending' con CAS sobre 'pausado', ACOTADO por owner, y reporta si aplico", async () => {
      const sql = makeSqlReturning([{ id: 'job-1' }]);
      const aplico = await new JobsRepository(sql).reanudarDePausado('job-1', 'user-1');
      expect(aplico).toBe(true);
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'pending'");
      expect(texto).toContain("status = 'pausado'");
      expect(texto).toContain('owner_id = ');
      expect(texto).toContain('started_at = null');
      expect(sqlValues(sql)).toEqual(['job-1', 'user-1']);
    });

    it('un job ajeno o no pausado no se toca (0 filas -> false)', async () => {
      expect(await new JobsRepository(makeSqlReturning([])).reanudarDePausado('job-1', 'user-2')).toBe(false);
    });
  });

  describe('marcarPausadoFallido', () => {
    it("cierra 'pausado' -> 'failed' con CAS (una decision simultanea gana)", async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).marcarPausadoFallido('job-1', 'aprobacion expirada');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'failed'");
      expect(texto).toContain("status = 'pausado'");
      expect(sqlValues(sql)).toEqual(['aprobacion expirada', 'job-1']);
    });
  });

  describe('claim, reaper y latido NO tocan un job pausado', () => {
    it("claimNextJob solo toma 'pending' y reapOrphanedJobs solo recupera 'running'", async () => {
      const sqlClaim = makeSqlReturning([]);
      await new JobsRepository(sqlClaim).claimNextJob();
      expect(sqlText(sqlClaim)).toContain("where status = 'pending'");
      expect(sqlText(sqlClaim)).not.toContain('pausado');

      const sqlReap = makeSqlReturning([]);
      await new JobsRepository(sqlReap).reapOrphanedJobs({ staleMs: 90_000, maxAttempts: 3 });
      expect(sqlText(sqlReap)).toContain("where status = 'running'");
      expect(sqlText(sqlReap)).not.toContain('pausado');
    });

    it('un pausado sin latir 20 minutos NO es candidato del reaper (el WHERE lo excluye) y su latido no escribe', async () => {
      // Candidatos del reaper: el WHERE exige status='running'; un 'pausado' viejo jamas entra.
      const sqlReap = makeSqlReturning([]);
      await new JobsRepository(sqlReap).reapOrphanedJobs({ staleMs: 90_000, maxAttempts: 3 });
      expect(sqlText(sqlReap)).toContain("where status = 'running'");

      // latirJob sobre un job pausado: el UPDATE (CAS running) afecta 0 filas y se relee el estado.
      const sqlLatido = makeSqlSequence([[], [{ status: 'pausado' }]]);
      const status = await new JobsRepository(sqlLatido).latirJob('job-pausado');
      expect(status).toBe('pausado');
      expect(sqlTextOf(sqlLatido, 0)).toContain("status = 'running'");
    });
  });
});
