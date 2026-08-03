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
vi.mock('../src/lib/mutations', () => ({
  useTerminarJob: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useGuardarTareaAprendida: () => ({ isPending: false, isError: false, isSuccess: false, mutate: vi.fn() }),
  useEliminarActividad: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));

import i18n from '../src/i18n';
import { JobActivityCard } from '../src/components/activity/JobActivityCard';

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

describe('JobActivityCard: titular de un job sin agente (FIX B)', () => {
  it('un job simple SIN agente (agentId null) NO se titula "Agente eliminado"', () => {
    render(<JobActivityCard job={makeJob({ type: 'simple', agentId: null })} agentName={null} />);
    expect(screen.queryByText('Agente eliminado')).not.toBeInTheDocument();
    expect(screen.getByText('Tarea de la plataforma')).toBeInTheDocument();
  });

  it('"Agente eliminado" queda reservado para un job que TUVO agente y ya no resuelve nombre', () => {
    render(
      <JobActivityCard job={makeJob({ type: 'simple', agentId: 'agente-1' })} agentName={null} />,
    );
    expect(screen.getByText('Agente eliminado')).toBeInTheDocument();
  });
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

  // Convivencia con las etiquetas Cancelada / Detenida: cada desenlace de 'failed' conserva SU texto.
  it('un job CANCELADO por el usuario no muestra el texto amable ni el detalle tecnico', () => {
    render(
      <JobActivityCard
        job={makeJob({ lastError: 'CANCELADO_POR_USUARIO: terminada por el usuario' })}
        agentName={null}
      />,
    );
    expect(screen.queryByText('La tarea no se pudo completar.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Detalle tecnico/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/CANCELADO_POR_USUARIO/)).not.toBeInTheDocument();
  });

  it('un job DETENIDO por el sistema conserva su texto legible, sin detalle tecnico ni prefijo crudo', () => {
    render(
      <JobActivityCard
        job={{
          ...makeJob(),
          lastError: 'SISTEMA_DETUVO_TAREA: la tarea dejo de responder y el sistema la termino automaticamente',
        }}
        agentName={null}
      />,
    );
    expect(
      screen.getByText('El sistema termino esta tarea porque dejo de responder.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('La tarea no se pudo completar.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Detalle tecnico/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/SISTEMA_DETUVO_TAREA/)).not.toBeInTheDocument();
  });

  // Tarea DETENIDA ANTES DE EJECUTAR (verificacion determinista): no es un fallo tecnico, asi que
  // muestra que se pidio, que se encontro y que hacer, y NO ofrece detalle tecnico.
  it('un job detenido antes de ejecutar muestra que se pidio y que se encontro', () => {
    render(
      <JobActivityCard
        job={makeJob({
          lastError:
            'PermanentExecutionError: DETENIDA_VERIFICACION: ' +
            JSON.stringify({
              motivo: 'noCoincide',
              pedido: 'juan@ejemplo.com',
              encontrado: 'otro@atacante.com',
            }),
        })}
        agentName={null}
      />,
    );
    expect(screen.getByText('La tarea se detuvo antes de ejecutar')).toBeInTheDocument();
    expect(
      screen.getByText(/Pediste juan@ejemplo.com y en el sitio aparecia otro@atacante.com/),
    ).toBeInTheDocument();
    expect(screen.queryByText('La tarea no se pudo completar.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Detalle tecnico/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/DETENIDA_VERIFICACION/)).not.toBeInTheDocument();
  });

  it('un job detenido por el limite de monto explica el limite y donde cambiarlo', () => {
    render(
      <JobActivityCard
        job={makeJob({
          lastError:
            'PermanentExecutionError: DETENIDA_VERIFICACION: ' +
            JSON.stringify({ motivo: 'topeExcedido', monto: '9900 MXN', tope: '5000 MXN' }),
        })}
        agentName={null}
      />,
    );
    expect(screen.getByText(/supera tu limite configurado de 5000 MXN/)).toBeInTheDocument();
  });
});

describe('JobActivityCard: la etiqueta de procedimiento de otra cuenta (V041, consumo directo)', () => {
  it('una tarea con procedimiento ajeno muestra la etiqueta SIEMPRE (no hubo aprobacion previa)', () => {
    render(
      <JobActivityCard
        job={makeJob({ status: 'completed', lastError: null, conProcedimientoAjeno: true })}
        agentName={null}
      />,
    );
    expect(screen.getByText('Procedimiento de otra cuenta')).toBeInTheDocument();
    expect(
      screen.getByText(/uso un procedimiento que otra cuenta ya habia descubierto/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Corroborado')).not.toBeInTheDocument();
  });

  it('el badge Corroborado aparece solo cuando la plantilla ya estaba corroborada (D3)', () => {
    render(
      <JobActivityCard
        job={makeJob({
          status: 'completed',
          lastError: null,
          conProcedimientoAjeno: true,
          procedimientoCorroborado: true,
        })}
        agentName={null}
      />,
    );
    expect(screen.getByText('Procedimiento de otra cuenta')).toBeInTheDocument();
    expect(screen.getByText('Corroborado')).toBeInTheDocument();
  });

  it('en ingles usa las claves EN de la etiqueta', async () => {
    await i18n.changeLanguage('en');
    render(
      <JobActivityCard
        job={makeJob({ status: 'completed', lastError: null, conProcedimientoAjeno: true })}
        agentName={null}
      />,
    );
    expect(screen.getByText('Procedure from another account')).toBeInTheDocument();
  });

  it('sin la marca, la tarjeta no dice nada de procedimientos ajenos', () => {
    render(<JobActivityCard job={makeJob({ status: 'completed', lastError: null })} agentName={null} />);
    expect(screen.queryByText('Procedimiento de otra cuenta')).not.toBeInTheDocument();
  });
});
