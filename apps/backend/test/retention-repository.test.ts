import { describe, it, expect, vi } from 'vitest';
import { RetentionRepository } from '../src/retention/retention-repository.js';
import { cutoffIso } from '../src/retention/retention-policy.js';
import type { Sql } from '../src/db/client.js';

function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function sqlText(sql: Sql, index = 0): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[index]?.[0] ?? []).join('<param>');
}

function sqlValues(sql: Sql, index = 0): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[index] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

/**
 * Mock que INTERPRETA la query de borrado y aplica el filtro real sobre fixtures: para agent_runs devuelve
 * las filas con created_at < corte; para jobs, las TERMINALES con finished_at < corte. Reproduce el efecto
 * del DELETE sin DB, para probar que la purga borra SOLO lo mas viejo que la politica (nunca lo reciente).
 * Los timestamps ISO se comparan lexicograficamente (ISO 8601 es ordenable como texto).
 */
function makeFilteringSql(
  agentRuns: Array<{ id: string; created_at: string }>,
  jobs: Array<{ id: string; status: string; finished_at: string | null }>,
): Sql {
  const fn = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    if (text.includes('delete from agent_runs')) {
      const cutoff = values[0] as string;
      return agentRuns.filter((r) => r.created_at < cutoff).map((r) => ({ id: r.id }));
    }
    if (text.includes('delete from jobs')) {
      const cutoff = values[values.length - 1] as string;
      return jobs
        .filter(
          (r) =>
            (r.status === 'completed' || r.status === 'failed') &&
            r.finished_at !== null &&
            r.finished_at < cutoff,
        )
        .map((r) => ({ id: r.id }));
    }
    return [];
  }) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

const NOW = new Date('2026-07-01T00:00:00.000Z');

describe('RetentionRepository', () => {
  describe('purgeAgentRunsOlderThan', () => {
    it('borra por created_at < corte y devuelve el conteo', async () => {
      const sql = makeSqlReturning([{ id: 'a' }, { id: 'b' }]);
      const cutoff = cutoffIso(365, NOW);
      const count = await new RetentionRepository(sql).purgeAgentRunsOlderThan(cutoff);
      expect(count).toBe(2);
      const text = sqlText(sql);
      expect(text).toContain('delete from agent_runs');
      expect(text).toContain('where created_at < ');
      expect(sqlValues(sql)).toEqual([cutoff]);
    });
  });

  describe('purgeTerminalJobsOlderThan', () => {
    it('borra SOLO jobs terminales (completed/failed) finalizados antes del corte; nunca pending/running', async () => {
      const sql = makeSqlReturning([{ id: 'j1' }]);
      const cutoff = cutoffIso(90, NOW);
      const count = await new RetentionRepository(sql).purgeTerminalJobsOlderThan(cutoff);
      expect(count).toBe(1);
      const text = sqlText(sql);
      expect(text).toContain('delete from jobs');
      // La salvaguarda clave: el filtro por status terminal + finished_at.
      expect(text).toContain("status in ('completed', 'failed')");
      expect(text).toContain('finished_at is not null');
      expect(text).toContain('finished_at < ');
      // Jamas menciona pending ni running en el borrado.
      expect(text).not.toContain('pending');
      expect(text).not.toContain('running');
    });
  });

  describe('purgeExpired (la funcion de borrado)', () => {
    it('borra SOLO lo mas viejo que la politica y NUNCA lo reciente', async () => {
      // agent_runs: uno de hace 400 dias (viejo) y uno de hace 10 dias (reciente). Politica 365 dias.
      const oldRun = cutoffIso(400, NOW); // mas viejo que el corte de 365
      const recentRun = cutoffIso(10, NOW); // mas nuevo que el corte
      // jobs: un completed de hace 200 dias (viejo), un running de hace 300 dias (viejo pero NO terminal),
      // un failed de hace 5 dias (reciente). Politica 90 dias.
      const oldJob = cutoffIso(200, NOW);
      const oldRunningJob = cutoffIso(300, NOW);
      const recentJob = cutoffIso(5, NOW);
      const sql = makeFilteringSql(
        [
          { id: 'run-old', created_at: oldRun },
          { id: 'run-recent', created_at: recentRun },
        ],
        [
          { id: 'job-old-completed', status: 'completed', finished_at: oldJob },
          { id: 'job-old-running', status: 'running', finished_at: oldRunningJob },
          { id: 'job-recent-failed', status: 'failed', finished_at: recentJob },
        ],
      );
      const result = await new RetentionRepository(sql).purgeExpired(NOW, {
        agentRunsDays: 365,
        terminalJobsDays: 90,
      });
      // Solo el run viejo y el job completed viejo se borran. El run reciente, el job running (no terminal)
      // y el job failed reciente se CONSERVAN.
      expect(result).toEqual({ agentRuns: 1, terminalJobs: 1 });
    });

    it('usa los cortes derivados de la politica y now (agent_runs 365, jobs 90)', async () => {
      const sql = makeSqlReturning([]);
      await new RetentionRepository(sql).purgeExpired(NOW, { agentRunsDays: 365, terminalJobsDays: 90 });
      // Primera llamada = agent_runs con corte de 365; segunda = jobs con corte de 90.
      expect(sqlValues(sql, 0)).toEqual([cutoffIso(365, NOW)]);
      expect(sqlValues(sql, 1)).toEqual([cutoffIso(90, NOW)]);
    });
  });

  describe('eraseOwnerOperationalData', () => {
    it('borra los datos operativos del titular acotados por owner_id y devuelve el conteo por tabla', async () => {
      const sql = makeSqlReturning([{ id: 'x' }]);
      const result = await new RetentionRepository(sql).eraseOwnerOperationalData('user-1');
      expect(result).toEqual({
        agentRuns: 1,
        jobs: 1,
        scheduledTasks: 1,
        triggers: 1,
        recipes: 1,
        processingRecords: 1,
      });
      const calls = (sql as unknown as { mock: { calls: unknown[] } }).mock.calls;
      expect(calls).toHaveLength(6);
      // Cada borrado apunta a su tabla y acota por owner_id.
      const tables = ['agent_runs', 'jobs', 'scheduled_tasks', 'triggers', 'recipes', 'processing_records'];
      tables.forEach((table, i) => {
        const text = sqlText(sql, i);
        expect(text).toContain(`delete from ${table}`);
        expect(text).toContain('where owner_id = ');
        expect(sqlValues(sql, i)).toEqual(['user-1']);
      });
    });
  });
});
