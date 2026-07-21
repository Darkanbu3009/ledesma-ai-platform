// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { MetricCard } from '../src/components/dashboard/MetricCard';
import { RangeSelector } from '../src/components/dashboard/RangeSelector';
import type { DashboardSummary } from '../src/lib/dashboard';

// El hook de datos se mockea para poder ejercer la maquina de estados de la pantalla (carga / error /
// vacio) sin red, sin react-query y sin renderizar Recharts (que necesita medir el contenedor).
const { useDashboardMock } = vi.hoisted(() => ({ useDashboardMock: vi.fn() }));
// DashboardPage ahora corona el Panel con <OnboardingChecklist/>, que lee useOnboardingProgress. No es el
// foco de estos tests: se fuerza a "cargando" para que el checklist renderice null y no interfiera con los
// estados del Panel (skeleton / error / vacio) que aqui se ejercitan.
vi.mock('../src/lib/queries', () => ({
  useDashboard: useDashboardMock,
  useOnboardingProgress: () => ({ isLoading: true }),
}));

import { DashboardPage } from '../src/pages/DashboardPage';

afterEach(() => {
  cleanup();
  useDashboardMock.mockReset();
});

describe('MetricCard', () => {
  it('muestra la etiqueta y el valor', () => {
    render(<MetricCard label="Pendientes" value="7" />);
    expect(screen.getByText('Pendientes')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('resalta el valor en brasa con emphasis', () => {
    render(<MetricCard label="Fallidas" value="3" emphasis />);
    expect(screen.getByText('3')).toHaveClass('text-brasa');
  });
});

describe('RangeSelector', () => {
  it('marca el rango activo con aria-pressed y avisa el cambio', () => {
    const onChange = vi.fn();
    render(<RangeSelector value="30d" onChange={onChange} />);
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(onChange).toHaveBeenCalledWith('7d');
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

const EMPTY_SUMMARY: DashboardSummary = {
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

describe('DashboardPage', () => {
  it('muestra el skeleton mientras carga', () => {
    useDashboardMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Panel' })).toBeInTheDocument();
  });

  it('muestra ErrorState con reintento cuando falla', () => {
    const refetch = vi.fn();
    useDashboardMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tu panel');
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('guia con un EmptyState cuando el owner aun no ejecuto nada', () => {
    useDashboardMock.mockReturnValue({
      data: EMPTY_SUMMARY,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('heading', { name: /Aun no hay actividad/ })).toBeInTheDocument();
    // El CTA "Crear un agente" ya no se duplica en el estado vacio: la accion vive en el checklist.
    expect(screen.queryByRole('link', { name: /Crear un agente/ })).not.toBeInTheDocument();
    // La fila de metricas en cero acompana al estado vacio.
    expect(screen.getByText('Corridas')).toBeInTheDocument();
    expect(screen.getByText('Gasto estimado')).toBeInTheDocument();
  });
});
