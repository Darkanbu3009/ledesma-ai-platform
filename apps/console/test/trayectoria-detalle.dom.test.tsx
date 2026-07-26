// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Trayectoria } from '../src/lib/trayectorias';
import type { JobActivity } from '../src/lib/jobs';

// La tarjeta usa react-query via useTrayectoriasDeJob (TrayectoriaDetalle) y useTerminarJob (boton
// Terminar tarea); se mockean los hooks para renderizar sin red ni QueryClient, mismo aislamiento
// que los otros dom tests.
const useTrayectoriasDeJob = vi.fn();
vi.mock('../src/lib/queries', () => ({
  useTrayectoriasDeJob: (jobId: string, enabled: boolean) => useTrayectoriasDeJob(jobId, enabled),
}));
const useTerminarJob = vi.fn(() => ({ isPending: false, isError: false, mutate: vi.fn() }));
vi.mock('../src/lib/mutations', () => ({
  useTerminarJob: () => useTerminarJob(),
}));

import { JobActivityCard } from '../src/components/activity/JobActivityCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'job-1',
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

function makeTrayectoria(overrides: Partial<Trayectoria> = {}): Trayectoria {
  return {
    id: 'tray-1',
    jobId: 'job-1',
    connectionId: 'conn-1',
    dominio: 'en.wikipedia.org',
    objetivo: 'lee el articulo destacado',
    estado: 'exitosa',
    iniciadaEn: '2026-07-20T00:00:01.000Z',
    terminadaEn: '2026-07-20T00:00:42.000Z',
    duracionMs: 41_000,
    tokensIn: 1200,
    tokensOut: 340,
    pasos: [
      {
        idx: 0,
        accion: { tipo: 'goto', instruccion: 'https://en.wikipedia.org/', metodo: null, argumentos: [] },
        selector: null,
        valorCensurado: null,
        url: 'https://en.wikipedia.org/',
        exito: true,
      },
      {
        idx: 1,
        accion: {
          tipo: 'act',
          instruccion: 'click the featured article link',
          metodo: 'click',
          argumentos: [],
        },
        selector: 'xpath=//a[@id="featured"]',
        valorCensurado: null,
        url: 'https://en.wikipedia.org/wiki/Main_Page',
        exito: true,
      },
    ],
    ...overrides,
  };
}

describe('JobActivityCard (tarea web) + TrayectoriaDetalle', () => {
  it('una tarea web ofrece "Ver pasos" y NO consulta la trayectoria hasta expandir', () => {
    useTrayectoriasDeJob.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    expect(screen.getByRole('button', { name: /ver pasos/i })).toBeInTheDocument();
    // Colapsada: el detalle no se monta, asi que el hook no corre.
    expect(useTrayectoriasDeJob).not.toHaveBeenCalled();
  });

  it('un job que NO es tarea web no ofrece el toggle', () => {
    render(<JobActivityCard job={makeJob({ type: 'simple' })} agentName="Mi agente" />);
    expect(screen.queryByRole('button', { name: /ver pasos/i })).not.toBeInTheDocument();
  });

  it('al expandir muestra estado, duracion, tokens y cada paso con accion, selector, url y exito', () => {
    useTrayectoriasDeJob.mockReturnValue({
      data: [makeTrayectoria()],
      isLoading: false,
      isError: false,
    });
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: /ver pasos/i }));

    expect(useTrayectoriasDeJob).toHaveBeenCalledWith('job-1', true);
    expect(screen.getByText('Exitosa')).toBeInTheDocument();
    expect(screen.getByText(/41\.0 s/)).toBeInTheDocument();
    expect(screen.getByText(/1200 entrada/)).toBeInTheDocument();
    expect(screen.getByText(/2 pasos/)).toBeInTheDocument();
    // Los dos pasos, con su instruccion, selector y url.
    expect(screen.getByText(/click the featured article link/)).toBeInTheDocument();
    expect(screen.getByText(/xpath=\/\/a\[@id="featured"\]/)).toBeInTheDocument();
    expect(screen.getByText('https://en.wikipedia.org/wiki/Main_Page')).toBeInTheDocument();
  });

  it('sin trayectorias registradas muestra el estado vacio', () => {
    useTrayectoriasDeJob.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: /ver pasos/i }));
    expect(screen.getByText(/no tiene pasos registrados/i)).toBeInTheDocument();
  });

  it('un valor censurado se muestra con su marcador (jamas el valor real)', () => {
    const trayectoria = makeTrayectoria();
    const paso = trayectoria.pasos[1];
    if (paso) {
      paso.valorCensurado = '[CENSURADO]';
    }
    useTrayectoriasDeJob.mockReturnValue({ data: [trayectoria], isLoading: false, isError: false });
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: /ver pasos/i }));
    expect(screen.getByText(/\[CENSURADO\]/)).toBeInTheDocument();
  });
});

/**
 * Una tarea puede trabajar en VARIOS sitios del usuario. Cuando eso pasa, /actividad los muestra
 * TODOS: cada tramo de la tarea deja su propia ejecucion registrada, con el sitio en el que corrio.
 * El texto es el del usuario final, sin terminos tecnicos.
 */
describe('sitios usados en una tarea', () => {
  it('una tarea que uso varios sitios los muestra todos', () => {
    useTrayectoriasDeJob.mockReturnValue({
      data: [
        makeTrayectoria({ id: 'tray-1', connectionId: 'conn-1', dominio: 'tienda.ejemplo.com' }),
        makeTrayectoria({ id: 'tray-2', connectionId: 'conn-2', dominio: 'correo.ejemplo.com' }),
      ],
      isLoading: false,
      isError: false,
    });
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: /ver pasos/i }));

    expect(screen.getByText('Sitios usados en esta tarea')).toBeInTheDocument();
    expect(screen.getByText('tienda.ejemplo.com')).toBeInTheDocument();
    expect(screen.getByText('correo.ejemplo.com')).toBeInTheDocument();
  });

  it('una tarea de un solo sitio no muestra la lista (no hay nada que aclarar)', () => {
    useTrayectoriasDeJob.mockReturnValue({
      data: [makeTrayectoria(), makeTrayectoria({ id: 'tray-2' })],
      isLoading: false,
      isError: false,
    });
    render(<JobActivityCard job={makeJob()} agentName={null} />);
    fireEvent.click(screen.getByRole('button', { name: /ver pasos/i }));
    expect(screen.queryByText('Sitios usados en esta tarea')).not.toBeInTheDocument();
  });
});
