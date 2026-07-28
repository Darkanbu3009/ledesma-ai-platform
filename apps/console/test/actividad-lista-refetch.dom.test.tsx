// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Se ejercita el CABLEADO REAL de useJobs (react-query de verdad, con su refetchInterval adaptativo):
// apiFetch se mockea para responder el endpoint de lista; supabase se aisla porque api.ts lo importa.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock, ApiError: class ApiError extends Error {} }));

import { useJobs } from '../src/lib/queries';
import {
  JOBS_LISTA_EN_VUELO_MS,
  JOBS_LISTA_REPOSO_MS,
  type JobActivity,
  type JobsPage,
} from '../src/lib/jobs';

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'job-viejo',
    type: 'tarea_web',
    agentId: null,
    status: 'completed',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:01.000Z',
    finishedAt: '2026-07-20T00:00:42.000Z',
    ...overrides,
  };
}

function page(jobs: JobActivity[]): JobsPage {
  return { jobs, pagination: { limit: 20, offset: 0, hasMore: false } };
}

/** Lista minima sobre el hook REAL: una "tarjeta" (li) por job, igual que ActivityPage. */
function ListaDeActividad() {
  const { data } = useJobs();
  const jobs = data?.pages.flatMap((p) => p.jobs) ?? [];
  return (
    <ul>
      {jobs.map((job) => (
        <li key={job.id}>{job.id}</li>
      ))}
    </ul>
  );
}

function renderLista() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ListaDeActividad />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  apiFetchMock.mockReset();
});

describe('useJobs: la lista de /actividad se refresca sola (semi tiempo real)', () => {
  it('con la lista en reposo, un job NUEVO en el endpoint aparece sin remount ni interaccion', async () => {
    apiFetchMock.mockResolvedValue(page([makeJob()]));
    renderLista();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('job-viejo')).toBeInTheDocument();
    expect(screen.queryByText('job-nuevo')).not.toBeInTheDocument();

    // Se encola una tarea desde otra pantalla: el endpoint ahora devuelve la tarjeta nueva primero.
    apiFetchMock.mockResolvedValue(page([makeJob({ id: 'job-nuevo', status: 'pending' }), makeJob()]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOBS_LISTA_REPOSO_MS + 100);
    });
    expect(screen.getByText('job-nuevo')).toBeInTheDocument();
    expect(screen.getByText('job-viejo')).toBeInTheDocument();
  });

  it('con un job en vuelo visible, el refresco corre al ritmo rapido (el terminal se refleja en 5s)', async () => {
    apiFetchMock.mockResolvedValue(page([makeJob({ id: 'job-corriendo', status: 'running' })]));
    renderLista();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('job-corriendo')).toBeInTheDocument();

    apiFetchMock.mockResolvedValue(
      page([makeJob({ id: 'job-recien-encolado', status: 'pending' }), makeJob({ id: 'job-corriendo', status: 'running' })]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOBS_LISTA_EN_VUELO_MS + 100);
    });
    expect(screen.getByText('job-recien-encolado')).toBeInTheDocument();
  });
});
