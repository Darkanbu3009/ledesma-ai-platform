// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Se ejercita el CABLEADO REAL de useOnboardingProgress (useCredentials + useAgents + useDashboard ->
// deriveOnboardingProgress). apiFetch se mockea para responder por ENDPOINT: asi el test no depende de la
// queryKey del dashboard (que embebe el `from` dinamico de onboardingRunWindow). supabase se aisla porque
// api.ts lo importa y lee env.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock }));

import { useOnboardingProgress } from '../src/lib/queries';
import type { ProviderCredential } from '../src/lib/credentials';
import type { AgentConfig } from '../src/lib/agents';
import type { DashboardSummary } from '../src/lib/dashboard';

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

const credential = { id: 'c1', label: 'k', providerId: 'anthropic', baseUrl: null, createdAt: 'x' } as ProviderCredential;
const agent = { id: 'a1', name: 'Bot', providerId: 'anthropic' } as unknown as AgentConfig;

function summaryWithRuns(runs: number): DashboardSummary {
  return {
    range: { from: 'a', to: 'b', defaulted: false, defaultWindowDays: 30 },
    retention: { agentRunsDays: 365, jobsTerminalDays: 90 },
    activity: { totals: { runs, completed: runs, errors: 0 }, byDay: [], lastRunAt: runs > 0 ? 'x' : null },
    operations: {
      jobs: { pending: 0, running: 0, completed: 0, failed: 0, pausado: 0, total: 0 },
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

/** Responde apiFetch por endpoint (credentials / agents / dashboard). */
function setData(data: { credentials: ProviderCredential[]; agents: AgentConfig[]; dashboard: DashboardSummary }) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith('/v1/credentials')) return Promise.resolve({ credentials: data.credentials });
    if (path.startsWith('/v1/agents')) return Promise.resolve({ agents: data.agents });
    if (path.startsWith('/v1/dashboard')) return Promise.resolve(data.dashboard);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function renderProgress() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOnboardingProgress(), { wrapper });
}

describe('useOnboardingProgress (cableado real de las tres senales)', () => {
  it('deriva las tres senales y firstAgentId cuando las tres queries resuelven con datos', async () => {
    setData({ credentials: [credential], agents: [agent], dashboard: summaryWithRuns(4) });
    const { result } = renderProgress();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasCredential).toBe(true);
    expect(result.current.hasAgent).toBe(true);
    expect(result.current.hasRun).toBe(true);
    expect(result.current.completedCount).toBe(3);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.firstAgentId).toBe('a1');
    expect(result.current.isError).toBe(false);
  });

  it('parcial: solo credencial -> 1 de 3, no completo, sin firstAgentId', async () => {
    setData({ credentials: [credential], agents: [], dashboard: summaryWithRuns(0) });
    const { result } = renderProgress();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasCredential).toBe(true);
    expect(result.current.hasAgent).toBe(false);
    expect(result.current.hasRun).toBe(false);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.firstAgentId).toBeNull();
  });

  it('mientras las queries no resuelven: isLoading=true (no parpadea un progreso falso)', () => {
    apiFetchMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderProgress();
    expect(result.current.isLoading).toBe(true);
  });

  it('ante error de fetch: isError=true (la UI se ocultara)', async () => {
    apiFetchMock.mockImplementation(() => Promise.reject(new Error('boom')));
    const { result } = renderProgress();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
