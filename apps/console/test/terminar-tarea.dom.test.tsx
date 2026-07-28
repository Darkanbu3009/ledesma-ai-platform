// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { JobActivity } from '../src/lib/jobs';

// Mismo aislamiento que trayectoria-detalle.dom.test.tsx: se mockean los hooks con red para
// renderizar la tarjeta sin QueryClient ni backend.
const useTrayectoriasDeJob = vi.fn<
  (jobId: string, enabled: boolean) => { data: never[]; isLoading: boolean; isError: boolean }
>(() => ({ data: [], isLoading: false, isError: false }));
vi.mock('../src/lib/queries', () => ({
  useTrayectoriasDeJob: (jobId: string, enabled: boolean) => useTrayectoriasDeJob(jobId, enabled),
}));
const mutate = vi.fn();
vi.mock('../src/lib/mutations', () => ({
  useTerminarJob: () => ({ isPending: false, isError: false, mutate }),
  useGuardarTareaAprendida: () => ({ isPending: false, isError: false, isSuccess: false, mutate: vi.fn() }),
  useEliminarActividad: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));

import { JobActivityCard } from '../src/components/activity/JobActivityCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'job-1',
    type: 'simple',
    agentId: 'agent-1',
    status: 'running',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    startedAt: new Date(Date.now() - 30_000).toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

describe('JobActivityCard: boton Terminar tarea y confirmacion', () => {
  it('una tarea en curso ofrece Terminar tarea; una terminada no', () => {
    render(<JobActivityCard job={makeJob()} agentName="Mi agente" />);
    expect(screen.getByRole('button', { name: /terminar tarea/i })).toBeInTheDocument();
    cleanup();
    render(<JobActivityCard job={makeJob({ status: 'completed' })} agentName="Mi agente" />);
    expect(screen.queryByRole('button', { name: /terminar tarea/i })).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de disparar la mutacion y confirma con el id del job', () => {
    render(<JobActivityCard job={makeJob()} agentName="Mi agente" />);
    fireEvent.click(screen.getByRole('button', { name: /terminar tarea/i }));
    // Se abre el dialogo; la mutacion NO se dispara todavia.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /si, terminar/i }));
    expect(mutate).toHaveBeenCalledWith('job-1', expect.anything());
  });

  it('Seguir esperando cierra el dialogo sin disparar nada', () => {
    render(<JobActivityCard job={makeJob()} agentName="Mi agente" />);
    fireEvent.click(screen.getByRole('button', { name: /terminar tarea/i }));
    fireEvent.click(screen.getByRole('button', { name: /seguir esperando/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('JobActivityCard: etiquetas Cancelada y Detenida', () => {
  it('failed con prefijo CANCELADO_POR_USUARIO muestra Cancelada y oculta el error tecnico', () => {
    render(
      <JobActivityCard
        job={makeJob({ status: 'failed', lastError: 'CANCELADO_POR_USUARIO: terminada por el usuario' })}
        agentName="Mi agente"
      />,
    );
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    expect(screen.queryByText(/CANCELADO_POR_USUARIO/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /terminar tarea/i })).not.toBeInTheDocument();
  });

  it('failed con prefijo SISTEMA_DETUVO_TAREA muestra Detenida y el texto legible', () => {
    render(
      <JobActivityCard
        job={makeJob({
          status: 'failed',
          lastError: 'SISTEMA_DETUVO_TAREA: la tarea dejo de responder y el sistema la termino automaticamente',
        })}
        agentName="Mi agente"
      />,
    );
    expect(screen.getByText('Detenida')).toBeInTheDocument();
    expect(screen.getByText(/El sistema termino esta tarea porque dejo de responder/)).toBeInTheDocument();
    expect(screen.queryByText(/SISTEMA_DETUVO_TAREA/)).not.toBeInTheDocument();
  });
});

describe('JobActivityCard: aviso de tarea lenta', () => {
  it('en curso por mas de 3 minutos muestra el aviso con los minutos y el boton', () => {
    render(
      <JobActivityCard
        // 4 min 10 s: el reloj de la tarjeta avanza en cubetas de 10 s, asi que el margen extra
        // garantiza que el calculo vea al menos 4 minutos completos.
        job={makeJob({ startedAt: new Date(Date.now() - (4 * 60_000 + 10_000)).toISOString() })}
        agentName="Mi agente"
      />,
    );
    expect(screen.getByText('Esta tarea esta tardando mas de lo normal')).toBeInTheDocument();
    expect(screen.getByText(/Lleva 4 minutos en ejecucion/)).toBeInTheDocument();
  });

  it('en curso por menos del umbral NO muestra el aviso', () => {
    render(<JobActivityCard job={makeJob()} agentName="Mi agente" />);
    expect(screen.queryByText('Esta tarea esta tardando mas de lo normal')).not.toBeInTheDocument();
  });
});
