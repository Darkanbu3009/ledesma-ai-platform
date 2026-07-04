import { describe, it, expect } from 'vitest';
import {
  dashboardQueryString,
  dashboardRangeFromPreset,
  hasDashboardData,
  toActivitySeries,
  toModelSpendSeries,
  totalTokens,
  type DashboardDay,
  type DashboardModelSpend,
  type DashboardSummary,
} from '../src/lib/dashboard';
import { formatDayLabel } from '../src/lib/usage';

function day(date: string, runs: number): DashboardDay {
  return { date, runs, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function modelSpend(model: string, costUsd: number | null): DashboardModelSpend {
  return {
    model,
    runs: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
    priced: costUsd !== null,
  };
}

function summary(runs: number, jobsTotal: number, resourcesActive = 0): DashboardSummary {
  return {
    range: { from: 'a', to: 'b', defaulted: true, defaultWindowDays: 30 },
    retention: { agentRunsDays: 365, jobsTerminalDays: 90 },
    activity: { totals: { runs, completed: 0, errors: 0 }, byDay: [], lastRunAt: null },
    operations: {
      jobs: { pending: 0, running: 0, completed: 0, failed: 0, total: jobsTotal },
      resources: { scheduledTasksActive: resourcesActive, triggersActive: 0, recipesActive: 0 },
    },
    spend: {
      byok: true,
      note: '',
      currency: 'USD',
      tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      byDay: [],
      byModel: [],
      totalCostUsd: 0,
      untariffedModels: [],
      costComplete: true,
    },
  };
}

describe('dashboardRangeFromPreset', () => {
  const now = new Date('2026-06-12T10:00:00.000Z');

  it("'7d' fija from siete dias atras en ISO (sin to)", () => {
    expect(dashboardRangeFromPreset('7d', now)).toEqual({ from: '2026-06-05T10:00:00.000Z' });
  });

  it("'30d' fija from treinta dias atras", () => {
    expect(dashboardRangeFromPreset('30d', now)).toEqual({ from: '2026-05-13T10:00:00.000Z' });
  });

  it("'90d' fija from noventa dias atras", () => {
    expect(dashboardRangeFromPreset('90d', now)).toEqual({ from: '2026-03-14T10:00:00.000Z' });
  });
});

describe('dashboardQueryString', () => {
  it('devuelve cadena vacia sin campos', () => {
    expect(dashboardQueryString({})).toBe('');
  });

  it('incluye solo los campos presentes', () => {
    expect(dashboardQueryString({ from: '2026-01-01T00:00:00.000Z' })).toBe(
      '?from=2026-01-01T00%3A00%3A00.000Z',
    );
    expect(dashboardQueryString({ from: 'a', to: 'b' })).toBe('?from=a&to=b');
  });
});

describe('toActivitySeries', () => {
  it('mapea cada dia a { date, label, runs } conservando fecha y corridas', () => {
    const series = toActivitySeries([day('2026-06-10', 3), day('2026-06-11', 0)]);
    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({ date: '2026-06-10', label: formatDayLabel('2026-06-10'), runs: 3 });
    expect(series[1]?.runs).toBe(0);
  });

  it('devuelve vacio para una serie vacia', () => {
    expect(toActivitySeries([])).toEqual([]);
  });
});

describe('toModelSpendSeries', () => {
  it('omite los modelos sin tarifa y ordena por costo descendente', () => {
    const series = toModelSpendSeries([
      modelSpend('a', 1.5),
      modelSpend('sin-tarifa', null),
      modelSpend('c', 5),
      modelSpend('b', 3),
    ]);
    expect(series).toEqual([
      { model: 'c', costUsd: 5 },
      { model: 'b', costUsd: 3 },
      { model: 'a', costUsd: 1.5 },
    ]);
  });

  it('devuelve vacio cuando ningun modelo tiene tarifa', () => {
    expect(toModelSpendSeries([modelSpend('a', null), modelSpend('b', null)])).toEqual([]);
  });
});

describe('totalTokens', () => {
  it('suma los cuatro cubos de tokens', () => {
    expect(
      totalTokens({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 }),
    ).toBe(36);
  });
});

describe('hasDashboardData', () => {
  it('es true si hay corridas', () => {
    expect(hasDashboardData(summary(4, 0))).toBe(true);
  });

  it('es true si hay jobs en la cola', () => {
    expect(hasDashboardData(summary(0, 2))).toBe(true);
  });

  it('es true si hay recursos activos aunque no haya corridas ni jobs', () => {
    expect(hasDashboardData(summary(0, 0, 1))).toBe(true);
  });

  it('es false sin corridas, ni jobs, ni recursos activos', () => {
    expect(hasDashboardData(summary(0, 0, 0))).toBe(false);
  });
});
