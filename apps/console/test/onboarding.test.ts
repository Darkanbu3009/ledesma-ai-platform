import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_RUN_WINDOW_DAYS,
  ONBOARDING_STEP_COUNT,
  deriveOnboardingProgress,
  hasRunFromSummary,
  onboardingRunWindow,
} from '../src/lib/onboarding';
import type { DashboardSummary } from '../src/lib/dashboard';

/** Resumen del dashboard con runs/jobs parametrizables; el resto en cero (no lo mira hasRunFromSummary). */
function summary({ runs, jobsTotal }: { runs: number; jobsTotal: number }): DashboardSummary {
  return {
    range: { from: 'a', to: 'b', defaulted: true, defaultWindowDays: 30 },
    retention: { agentRunsDays: 365, jobsTerminalDays: 90 },
    activity: { totals: { runs, completed: runs, errors: 0 }, byDay: [], lastRunAt: runs > 0 ? 'x' : null },
    operations: {
      jobs: { pending: 0, running: 0, completed: jobsTotal, failed: 0, pausado: 0, total: jobsTotal },
      resources: { scheduledTasksActive: 0, triggersActive: 0, recipesActive: 0 },
    },
    spend: {
      byok: true,
      note: 'nota',
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

describe('deriveOnboardingProgress', () => {
  it('sin nada hecho: completedCount 0, no completo', () => {
    const p = deriveOnboardingProgress({ hasCredential: false, hasAgent: false, hasRun: false });
    expect(p.completedCount).toBe(0);
    expect(p.isComplete).toBe(false);
  });

  it('los tres hechos: completedCount 3, completo', () => {
    const p = deriveOnboardingProgress({ hasCredential: true, hasAgent: true, hasRun: true });
    expect(p.completedCount).toBe(ONBOARDING_STEP_COUNT);
    expect(p.isComplete).toBe(true);
  });

  it('cuenta cada senal por separado y NO se completa hasta las tres', () => {
    expect(deriveOnboardingProgress({ hasCredential: true, hasAgent: false, hasRun: false }).completedCount).toBe(1);
    const twoOfThree = deriveOnboardingProgress({ hasCredential: true, hasAgent: true, hasRun: false });
    expect(twoOfThree.completedCount).toBe(2);
    expect(twoOfThree.isComplete).toBe(false);
  });

  it('es veraz: refleja tal cual las senales (no marca hecho lo que dice false)', () => {
    const p = deriveOnboardingProgress({ hasCredential: false, hasAgent: true, hasRun: true });
    expect(p.hasCredential).toBe(false);
    expect(p.hasAgent).toBe(true);
    expect(p.hasRun).toBe(true);
    expect(p.completedCount).toBe(2);
  });
});

describe('hasRunFromSummary', () => {
  it('true cuando hay corridas de agente (agent_runs, incluye Playground)', () => {
    expect(hasRunFromSummary(summary({ runs: 3, jobsTotal: 0 }))).toBe(true);
  });

  it('true cuando hay jobs en la cola aunque runs sea 0 (recetas/tareas/triggers)', () => {
    expect(hasRunFromSummary(summary({ runs: 0, jobsTotal: 2 }))).toBe(true);
  });

  it('false cuando no hay ni corridas ni jobs', () => {
    expect(hasRunFromSummary(summary({ runs: 0, jobsTotal: 0 }))).toBe(false);
  });
});

describe('onboardingRunWindow', () => {
  it('pide una ventana amplia (365d hacia atras) para que hasRun sea durable', () => {
    const now = new Date('2026-07-07T00:00:00.000Z');
    const range = onboardingRunWindow(now);
    expect(range.to).toBeUndefined(); // el backend completa `to` con "ahora"
    const from = new Date(range.from as string);
    const days = (now.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(ONBOARDING_RUN_WINDOW_DAYS);
    expect(ONBOARDING_RUN_WINDOW_DAYS).toBe(365);
  });
});
