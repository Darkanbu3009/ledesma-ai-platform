// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Se ejercita el CABLEADO REAL de useOnboardingProgress (useCredentials + useAgents + useDashboard ->
// deriveOnboardingProgress) sobre las tres queries SEMBRADAS. Solo se aisla supabase/api, que leen env al
// importarse; con la data en cache (staleTime Infinity) las queryFn nunca corren, asi que no hay red.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock('../src/lib/api', () => ({ apiFetch: () => new Promise(() => {}) }));

import { useOnboardingProgress } from '../src/lib/queries';
import type { ProviderCredential } from '../src/lib/credentials';
import type { AgentConfig } from '../src/lib/agents';
import type { DashboardSummary } from '../src/lib/dashboard';

afterEach(cleanup);

const credential = { id: 'c1', label: 'k', providerId: 'anthropic', baseUrl: null, createdAt: 'x' } as ProviderCredential;
const agent = { id: 'a1', name: 'Bot', providerId: 'anthropic' } as unknown as AgentConfig;

function summaryWithRuns(runs: number): DashboardSummary {
  return {
    range: { from: 'a', to: 'b', defaulted: true, defaultWindowDays: 30 },
    retention: { agentRunsDays: 365, jobsTerminalDays: 90 },
    activity: { totals: { runs, completed: runs, errors: 0 }, byDay: [], lastRunAt: runs > 0 ? 'x' : null },
    operations: {
      jobs: { pending: 0, running: 0, completed: 0, failed: 0, total: 0 },
      resources: { scheduledTasksActive: 0, triggersActive: 0, recipesActive: 0 },
    },
    spend: {
      byok: true,
      note: 'n',
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

interface Seed {
  credentials?: ProviderCredential[];
  agents?: AgentConfig[];
  dashboard?: DashboardSummary;
}

function renderProgress(seed?: Seed) {
  // staleTime Infinity + data sembrada -> las queries quedan 'success' sin disparar queryFn (sin red).
  // Sin sembrar, la query arranca pending (queryFn colgada por el mock de apiFetch) -> estado de carga.
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  if (seed?.credentials) qc.setQueryData(['credentials'], seed.credentials);
  if (seed?.agents) qc.setQueryData(['agents'], seed.agents);
  if (seed?.dashboard) qc.setQueryData(['dashboard', null, null], seed.dashboard);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOnboardingProgress(), { wrapper });
}

describe('useOnboardingProgress (cableado real de las tres senales)', () => {
  it('deriva las tres senales y firstAgentId de las queries sembradas', () => {
    const { result } = renderProgress({
      credentials: [credential],
      agents: [agent],
      dashboard: summaryWithRuns(4),
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasCredential).toBe(true);
    expect(result.current.hasAgent).toBe(true);
    expect(result.current.hasRun).toBe(true);
    expect(result.current.completedCount).toBe(3);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.firstAgentId).toBe('a1');
  });

  it('parcial: solo credencial -> 1 de 3, no completo, sin firstAgentId', () => {
    const { result } = renderProgress({
      credentials: [credential],
      agents: [],
      dashboard: summaryWithRuns(0),
    });
    expect(result.current.hasCredential).toBe(true);
    expect(result.current.hasAgent).toBe(false);
    expect(result.current.hasRun).toBe(false);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.firstAgentId).toBeNull();
  });

  it('sin nada sembrado: isLoading=true (no parpadea un progreso falso)', () => {
    const { result } = renderProgress();
    expect(result.current.isLoading).toBe(true);
  });
});
