// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { JobActivity } from '../src/lib/jobs';

// Mismo aislamiento que terminar-tarea.dom.test.tsx: se mockean los hooks con red para renderizar la
// tarjeta sin QueryClient ni env de Supabase.
vi.mock('../src/lib/queries', () => ({
  useTrayectoriasDeJob: () => ({ data: [], isLoading: false, isError: false }),
}));
const mutate = vi.fn();
vi.mock('../src/lib/mutations', () => ({
  useTerminarJob: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useGuardarTareaAprendida: () => ({ isPending: false, isError: false, isSuccess: false, mutate: vi.fn() }),
  useEliminarActividad: () => ({ isPending: false, isError: false, mutate }),
}));

import i18n from '../src/i18n';
import { JobActivityCard } from '../src/components/activity/JobActivityCard';

/**
 * ELIMINAR UNA ACTIVIDAD desde /actividad (FIX D). Lo que estos tests fijan:
 *  - el icono de borrar SOLO aparece en estados terminales (un job en vuelo tiene Terminar tarea);
 *  - la confirmacion es obligatoria, dice que se elimina el registro y que no se puede deshacer;
 *  - si la ejecucion ya se guardo como tarea aprendida, el dialogo aclara que esa tarea se conserva;
 *  - confirmar dispara la mutacion con el id del job; cancelar no dispara nada.
 */

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'job-1',
    type: 'tarea_web',
    agentId: null,
    status: 'completed',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-07-24T22:52:00.000Z',
    startedAt: '2026-07-24T22:52:00.000Z',
    finishedAt: '2026-07-24T22:54:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  cleanup();
  mutate.mockClear();
  await i18n.changeLanguage('es');
});

const ARIA_ELIMINAR = 'Eliminar el registro de esta actividad';

describe('icono de eliminar una actividad', () => {
  it('aparece en una actividad completada', () => {
    render(<JobActivityCard job={makeJob({ status: 'completed' })} agentName={null} />);
    expect(screen.getByRole('button', { name: ARIA_ELIMINAR })).toBeInTheDocument();
  });

  it('aparece en una fallida y en una cancelada (estados terminales sobre failed)', () => {
    render(<JobActivityCard job={makeJob({ status: 'failed', lastError: 'boom' })} agentName={null} />);
    expect(screen.getByRole('button', { name: ARIA_ELIMINAR })).toBeInTheDocument();
    cleanup();
    render(
      <JobActivityCard
        job={makeJob({ status: 'failed', lastError: 'CANCELADO_POR_USUARIO: terminada por el usuario' })}
        agentName={null}
      />,
    );
    expect(screen.getByRole('button', { name: ARIA_ELIMINAR })).toBeInTheDocument();
  });

  it('NO aparece en un job en vuelo (pending, running, pausado): para eso existe Terminar tarea', () => {
    for (const status of ['pending', 'running', 'pausado'] as const) {
      render(<JobActivityCard job={makeJob({ status, finishedAt: null })} agentName={null} />);
      expect(screen.queryByRole('button', { name: ARIA_ELIMINAR })).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('dialogo de confirmacion de eliminar', () => {
  function abrir(job: JobActivity = makeJob()) {
    render(<JobActivityCard job={job} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: ARIA_ELIMINAR }));
  }

  it('abre un dialogo que dice que se elimina el registro y que no se puede deshacer', () => {
    abrir();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Eliminar esta actividad')).toBeInTheDocument();
    expect(
      screen.getByText(/Se eliminará el registro de esta actividad y no se puede deshacer/),
    ).toBeInTheDocument();
    // Nada se dispara hasta confirmar.
    expect(mutate).not.toHaveBeenCalled();
  });

  it('si la ejecucion ya se guardo como tarea aprendida, aclara que esa tarea se conserva', () => {
    abrir(makeJob({ guardadaComoTarea: true }));
    expect(
      screen.getByText(/La tarea aprendida derivada de esta ejecución se conserva/),
    ).toBeInTheDocument();
  });

  it('sin tarea aprendida derivada, no menciona la conservacion', () => {
    abrir();
    expect(screen.queryByText(/tarea aprendida derivada/)).not.toBeInTheDocument();
  });

  it('confirmar dispara la mutacion con el id del job', () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(mutate).toHaveBeenCalledWith('job-1', expect.anything());
  });

  it('cancelar cierra el dialogo sin disparar nada', () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('en ingles el dialogo usa las claves EN', async () => {
    await i18n.changeLanguage('en');
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the record of this activity' }));
    expect(screen.getByText('Delete this activity')).toBeInTheDocument();
    expect(
      screen.getByText(/The record of this activity will be deleted and this cannot be undone/),
    ).toBeInTheDocument();
  });
});
