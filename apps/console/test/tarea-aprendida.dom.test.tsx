// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { JobActivity } from '../src/lib/jobs';

// Mismo aislamiento que job-activity-card.dom.test.tsx: se mockean los hooks con red para renderizar
// la tarjeta sin QueryClient ni env de Supabase.
vi.mock('../src/lib/queries', () => ({
  useTrayectoriasDeJob: () => ({ data: [], isLoading: false, isError: false }),
}));
/** Estado mutable del mock de guardado: cada test lo ajusta antes de renderizar. */
const guardarState: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  mutate: ReturnType<typeof vi.fn>;
} = { isPending: false, isError: false, isSuccess: false, error: null, mutate: vi.fn() };

vi.mock('../src/lib/mutations', () => ({
  useTerminarJob: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useGuardarTareaAprendida: () => guardarState,
}));

import i18n from '../src/i18n';
import { JobActivityCard } from '../src/components/activity/JobActivityCard';

/**
 * VISIBILIDAD de una tarea ejecutada con lo APRENDIDO (Fase F paso 2, CAMBIO 6). Lo que estos tests
 * fijan es que el usuario se entera en lenguaje llano y que el mecanismo NO se filtra a la pantalla:
 * ni receta, ni selector, ni xpath, ni Stagehand, ni determinista, ni modelo, ni token.
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
  guardarState.isPending = false;
  guardarState.isError = false;
  guardarState.isSuccess = false;
  guardarState.error = null;
  await i18n.changeLanguage('es');
});

/** Palabras del mecanismo que TIENEN PROHIBIDO aparecer en pantalla. */
const PROHIBIDAS = ['receta', 'selector', 'xpath', 'stagehand', 'determinista', 'modelo', 'token'];

describe('etiqueta de tarea aprendida', () => {
  it('una tarea ejecutada con lo aprendido muestra la etiqueta y su explicacion', () => {
    render(<JobActivityCard job={makeJob({ conLoAprendido: true })} agentName={null} />);
    expect(screen.getByText('Tarea aprendida')).toBeInTheDocument();
    expect(
      screen.getByText(/se ejecuto con lo aprendido de una vez anterior, sin volver a analizar el sitio/i),
    ).toBeInTheDocument();
  });

  it('si ademas hubo que ajustarla, lo dice sin hablar del mecanismo', () => {
    render(<JobActivityCard job={makeJob({ conLoAprendido: true, ajustadaSola: true })} agentName={null} />);
    expect(screen.getByText(/El sitio cambio y la tarea se ajusto sola\./)).toBeInTheDocument();
  });

  it('una tarea aprendida SIN ajustes no muestra el aviso de ajuste', () => {
    render(<JobActivityCard job={makeJob({ conLoAprendido: true })} agentName={null} />);
    expect(screen.queryByText(/se ajusto sola/i)).not.toBeInTheDocument();
  });

  it('una tarea normal no muestra ninguna de las dos cosas', () => {
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    expect(screen.queryByText('Tarea aprendida')).not.toBeInTheDocument();
    expect(screen.queryByText(/lo aprendido de una vez anterior/i)).not.toBeInTheDocument();
  });

  it('el texto visible NO menciona el mecanismo en ninguno de los dos idiomas', async () => {
    for (const idioma of ['es', 'en']) {
      await i18n.changeLanguage(idioma);
      const { container } = render(
        <JobActivityCard job={makeJob({ conLoAprendido: true, ajustadaSola: true })} agentName={null} />,
      );
      const texto = (container.textContent ?? '').toLowerCase();
      for (const prohibida of PROHIBIDAS) {
        expect(texto).not.toContain(prohibida);
      }
      cleanup();
    }
  });

  it('en ingles la etiqueta se traduce', async () => {
    await i18n.changeLanguage('en');
    render(<JobActivityCard job={makeJob({ conLoAprendido: true })} agentName={null} />);
    expect(screen.getByText('Learned task')).toBeInTheDocument();
  });
});

describe('fallo del guardado como tarea aprendida (FIX C)', () => {
  const guardable = () => makeJob({ guardableComoTarea: true });

  it('un fallo PERMANENTE (prefijo PROMOCION_NO_REPETIBLE) muestra el motivo real sin invitar a reintentar', () => {
    guardarState.isError = true;
    guardarState.error = new Error(
      'PROMOCION_NO_REPETIBLE: paso fillFormVision de llenado sin campos registrados: asunto sin ningun otro paso que lo cubra',
    );
    render(<JobActivityCard job={guardable()} agentName={null} />);
    expect(
      screen.getByText(/incluye un paso que todavía no se puede convertir en repetible/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Inténtalo de nuevo/)).not.toBeInTheDocument();
    // El motivo tecnico interno no se filtra a la pantalla.
    expect(screen.queryByText(/fillFormVision/)).not.toBeInTheDocument();
  });

  it('cualquier otro fallo conserva el mensaje generico con reintento', () => {
    guardarState.isError = true;
    guardarState.error = new Error('fetch failed');
    render(<JobActivityCard job={guardable()} agentName={null} />);
    expect(screen.getByText(/No se pudo guardar la tarea aprendida/)).toBeInTheDocument();
  });

  it('en ingles el fallo permanente usa la clave EN', async () => {
    await i18n.changeLanguage('en');
    guardarState.isError = true;
    guardarState.error = new Error('PROMOCION_NO_REPETIBLE: motivo interno');
    render(<JobActivityCard job={guardable()} agentName={null} />);
    expect(
      screen.getByText(/includes a step that cannot be made repeatable yet/),
    ).toBeInTheDocument();
  });

  it('el boton se deshabilita mientras el guardado esta en curso', () => {
    guardarState.isPending = true;
    render(<JobActivityCard job={guardable()} agentName={null} />);
    const boton = screen.getByRole('button', { name: /Guardando la tarea aprendida/ });
    expect(boton).toBeDisabled();
  });
});
