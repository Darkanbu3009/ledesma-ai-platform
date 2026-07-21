// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminUserDetail } from '../src/lib/admin';
import type { DashboardSummary } from '../src/lib/dashboard';

// Hooks de datos y la mutation se mockean: asi se ejercen las secciones y el flujo de confirmacion del
// cambio de tier sin red, sin react-query y sin renderizar Recharts (la actividad vacia no dibuja graficas).
const { useAdminUserMock, useAdminUserActivityMock, useChangeTierMock } = vi.hoisted(() => ({
  useAdminUserMock: vi.fn(),
  useAdminUserActivityMock: vi.fn(),
  useChangeTierMock: vi.fn(),
}));
vi.mock('../src/lib/queries', () => ({
  useAdminUser: useAdminUserMock,
  useAdminUserActivity: useAdminUserActivityMock,
}));
vi.mock('../src/lib/mutations', () => ({ useChangeTier: useChangeTierMock }));

import { AdminUserDetailPage } from '../src/pages/AdminUserDetailPage';

const EMPTY_ACTIVITY: DashboardSummary = {
  range: { from: 'a', to: 'b', defaulted: true, defaultWindowDays: 30 },
  retention: { agentRunsDays: 365, jobsTerminalDays: 90 },
  activity: { totals: { runs: 0, completed: 0, errors: 0 }, byDay: [], lastRunAt: null },
  operations: {
    jobs: { pending: 0, running: 0, completed: 0, failed: 0, pausado: 0, total: 0 },
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

function detail(overrides?: Partial<AdminUserDetail['profile']>): AdminUserDetail {
  return {
    profile: {
      id: 'u1',
      fullName: 'Ada Lovelace',
      accountType: 'individual',
      role: 'individual',
      isAdmin: false,
      tier: 'free',
      identityVerified: true,
      createdAt: '2026-06-10T12:00:00.000Z',
      ...overrides,
    },
    email: 'ada@example.com',
    subscription: { id: 's1', profileId: 'u1', plan: 'free', status: 'active', createdAt: 'x' },
    usageCounter: {
      id: 'c1',
      profileId: 'u1',
      runsUsed: 3,
      runsLimit: 10,
      periodKind: 'lifetime',
      createdAt: 'x',
    },
  };
}

function mockChangeTier() {
  const mutate = vi.fn();
  useChangeTierMock.mockReturnValue({
    mutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  return mutate;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/u1']}>
      <Routes>
        <Route path="/admin/users/:id" element={<AdminUserDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useAdminUserMock.mockReset();
  useAdminUserActivityMock.mockReset();
  useChangeTierMock.mockReset();
});

describe('AdminUserDetailPage', () => {
  it('muestra las secciones: datos, licencia y actividad', () => {
    useAdminUserMock.mockReturnValue({ data: detail(), isLoading: false, isError: false, refetch: vi.fn() });
    useAdminUserActivityMock.mockReturnValue({
      data: EMPTY_ACTIVITY,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mockChangeTier();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: /Ada Lovelace/ })).toBeInTheDocument();
    // El email aparece en el encabezado (subtitulo) y en la seccion Datos.
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Datos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Licencia' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Actividad' })).toBeInTheDocument();
    // Seccion de uso (runs_used / runs_limit).
    expect(screen.getByText(/Ejecuciones usadas/)).toBeInTheDocument();
    // Actividad vacia -> mensaje neutro, sin graficas.
    expect(screen.getByText(/aun no registra actividad/i)).toBeInTheDocument();
  });

  it('muestra un estado de no encontrado con salida a la lista en un 404', () => {
    useAdminUserMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404 },
      refetch: vi.fn(),
    });
    useAdminUserActivityMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: false, refetch: vi.fn() });
    mockChangeTier();
    renderPage();
    expect(screen.getByText(/Usuario no encontrado/)).toBeInTheDocument();
    // Hay dos salidas a la lista (el enlace superior y el de la tarjeta de no encontrado); ambas a /admin.
    const backLinks = screen.getAllByRole('link', { name: /Volver a la lista/ });
    expect(backLinks.length).toBeGreaterThan(0);
    for (const link of backLinks) {
      expect(link).toHaveAttribute('href', '/admin');
    }
  });

  it('el cambio de tier pide confirmacion ANTES de ejecutar', () => {
    useAdminUserMock.mockReturnValue({ data: detail(), isLoading: false, isError: false, refetch: vi.fn() });
    useAdminUserActivityMock.mockReturnValue({
      data: EMPTY_ACTIVITY,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const mutate = mockChangeTier();
    renderPage();

    // Seleccionar un tier distinto (Pro) NO ejecuta: abre el dialogo de confirmacion.
    fireEvent.click(screen.getByRole('button', { name: 'Pro' }));
    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Cambiar tier' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/de\s+Free\s+a\s+Pro/);

    // Confirmar ejecuta la mutation con el body correcto.
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar tier' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ id: 'u1', tier: 'pro' });
  });

  it('cancelar cierra el dialogo sin ejecutar', () => {
    useAdminUserMock.mockReturnValue({ data: detail(), isLoading: false, isError: false, refetch: vi.fn() });
    useAdminUserActivityMock.mockReturnValue({
      data: EMPTY_ACTIVITY,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const mutate = mockChangeTier();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Autónomo' }));
    expect(screen.getByRole('dialog', { name: 'Cambiar tier' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Cambiar tier' })).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
