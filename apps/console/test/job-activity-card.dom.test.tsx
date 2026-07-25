// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// La tarjeta importa TrayectoriaDetalle (que arrastra queries/api/supabase); este test solo ejercita
// el bloque de error, asi que se stubbea el detalle para no requerir env de Supabase.
vi.mock('../src/components/activity/TrayectoriaDetalle', () => ({
  TrayectoriaDetalle: () => null,
}));

import i18n from '../src/i18n';
import { JobActivityCard } from '../src/components/activity/JobActivityCard';
import type { JobActivity } from '../src/lib/jobs';

const ERROR_TECNICO =
  'PermanentExecutionError: el agente termino con DONE sin cumplir el objetivo (consumio 15 de 120 pasos)';

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'job-1',
    type: 'tarea_web',
    agentId: null,
    status: 'failed',
    attempts: 1,
    lastError: ERROR_TECNICO,
    scheduledFor: null,
    createdAt: '2026-07-24T22:52:00.000Z',
    startedAt: '2026-07-24T22:52:00.000Z',
    finishedAt: '2026-07-24T22:54:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('es');
});

describe('JobActivityCard: error amable con detalle tecnico colapsable (BUG C)', () => {
  it('un job fallido muestra el texto amable y OCULTA el error crudo hasta abrir Detalle tecnico', () => {
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    expect(screen.getByText('La tarea no se pudo completar.')).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TECNICO)).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Detalle tecnico/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(ERROR_TECNICO)).toBeInTheDocument();

    // Se puede volver a colapsar.
    fireEvent.click(toggle);
    expect(screen.queryByText(ERROR_TECNICO)).not.toBeInTheDocument();
  });

  it('en ingles usa las claves EN del texto amable', async () => {
    await i18n.changeLanguage('en');
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    expect(screen.getByText('The task could not be completed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Technical detail/ })).toBeInTheDocument();
  });

  it('un job fallido SIN lastError no muestra el bloque de error', () => {
    render(<JobActivityCard job={makeJob({ lastError: null })} agentName={null} />);
    expect(screen.queryByText('La tarea no se pudo completar.')).not.toBeInTheDocument();
  });

  it('un job completado no muestra el bloque de error aunque tenga lastError viejo', () => {
    render(<JobActivityCard job={makeJob({ status: 'completed' })} agentName={null} />);
    expect(screen.queryByText('La tarea no se pudo completar.')).not.toBeInTheDocument();
    expect(screen.queryByText(ERROR_TECNICO)).not.toBeInTheDocument();
  });
});
