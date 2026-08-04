// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Se ejercita el CABLEADO REAL de /actividad (useJobs con react-query de verdad, useInfiniteScroll y
// el pie de lista): lo unico mockeado es apiFetch (la red) y supabase, que api.ts importa al cargarse.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {},
}));

import { ActivityPage } from '../src/pages/ActivityPage';
import { JOB_PAGE_SIZE, type JobActivity, type JobsPage } from '../src/lib/jobs';

/**
 * SCROLL INFINITO EN /actividad. Lo que estos tests fijan (todos fallan con el boton "cargar mas"):
 *  - el centinela visible pide la pagina siguiente UNA sola vez aunque se intersecte varias veces
 *    mientras la carga esta en vuelo;
 *  - si una pagina falla, la lista ya cargada queda intacta y aparece Reintentar (unico boton), que
 *    carga la pagina;
 *  - al llegar al fin de la lista el observador se desconecta: cero peticiones nuevas;
 *  - cambiar el filtro de estado reinicia la lista y pagina DENTRO del filtro;
 *  - dos paginas con un id repetido (la ventana por offset se corre) renderizan una sola tarjeta;
 *  - si la primera pagina no llena el viewport, se encadena la siguiente sola hasta agotar.
 */

// --- Doble de IntersectionObserver (jsdom no lo implementa) -------------------------------------

type ObserverDoble = { callback: IntersectionObserverCallback; conectado: boolean; observados: number };
const observadores: ObserverDoble[] = [];

class IntersectionObserverDoble {
  private doble: ObserverDoble;
  constructor(callback: IntersectionObserverCallback) {
    this.doble = { callback, conectado: true, observados: 0 };
    observadores.push(this.doble);
  }
  observe() {
    this.doble.observados += 1;
  }
  unobserve() {}
  disconnect() {
    this.doble.conectado = false;
  }
  takeRecords() {
    return [];
  }
}

/** Simula que el centinela entra (o sale) del viewport en todos los observadores vivos. */
function intersectarCentinela(isIntersecting = true) {
  for (const observador of observadores) {
    if (!observador.conectado) continue;
    observador.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      null as unknown as IntersectionObserver,
    );
  }
}

const hayObservadorConectado = () => observadores.some((o) => o.conectado);

// --- Datos -------------------------------------------------------------------------------------

/**
 * Un job cuyo TITULO en la tarjeta es su propio id: el agente que corrio se resuelve por agentId
 * contra /v1/agents (ver el mock de abajo), asi cada tarjeta es identificable por texto.
 */
function makeJob(id: string, overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id,
    type: 'simple',
    agentId: id,
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

function pagina(jobs: JobActivity[], offset: number, hasMore: boolean): JobsPage {
  return { jobs, pagination: { limit: JOB_PAGE_SIZE, offset, hasMore } };
}

/** Peticiones de historial hechas hasta ahora (ignora /v1/agents y /v1/aprobaciones). */
function peticionesDeJobs(): string[] {
  return apiFetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/v1/jobs'));
}

/**
 * Enruta apiFetch: el historial lo resuelve `responder` (por numero de peticion); el resto de los
 * endpoints que toca la pantalla responden vacio.
 */
function mockApi(responder: (peticion: number, url: string) => unknown, agentes: string[] = []) {
  let peticion = 0;
  apiFetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/v1/agents')) {
      return Promise.resolve({ agents: agentes.map((id) => ({ id, name: id })) });
    }
    if (url.startsWith('/v1/aprobaciones')) return Promise.resolve({ aprobaciones: [] });
    if (url.startsWith('/v1/jobs')) {
      peticion += 1;
      return Promise.resolve(responder(peticion, url));
    }
    return Promise.resolve({});
  });
}

function renderActividad() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/actividad']}>
      <QueryClientProvider client={qc}>
        <ActivityPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Una tarjeta por job: el titulo de cada JobActivityCard es un heading de nivel 3. */
const tarjetas = () => screen.queryAllByRole('heading', { level: 3 });

const esperarTarjetas = (n: number) => waitFor(() => expect(tarjetas()).toHaveLength(n));

beforeEach(() => {
  observadores.length = 0;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverDoble);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  apiFetchMock.mockReset();
});

describe('/actividad con scroll infinito', () => {
  it('el centinela visible carga la pagina siguiente UNA vez aunque se intersecte varias veces', async () => {
    // La pagina 2 queda en vuelo hasta que el test la resuelve a mano.
    const enVuelo: { resolver?: (page: JobsPage) => void } = {};
    mockApi((peticion) => {
      if (peticion === 1) return pagina([makeJob('job-1')], 0, true);
      return new Promise<JobsPage>((resolve) => {
        enVuelo.resolver = resolve;
      });
    }, ['job-1', 'job-2']);

    renderActividad();
    await esperarTarjetas(1);
    expect(peticionesDeJobs()).toHaveLength(1);

    // Scroll rapido: el centinela se intersecta tres veces mientras la pagina 2 sigue en vuelo.
    intersectarCentinela();
    await waitFor(() => expect(peticionesDeJobs()).toHaveLength(2));
    intersectarCentinela();
    intersectarCentinela();
    await Promise.resolve();
    expect(peticionesDeJobs()).toHaveLength(2);

    enVuelo.resolver?.(pagina([makeJob('job-2')], JOB_PAGE_SIZE, false));
    await esperarTarjetas(2);
    expect(peticionesDeJobs()).toHaveLength(2);
  });

  it('si una pagina falla, la lista queda intacta y Reintentar carga la pagina', async () => {
    mockApi((peticion) => {
      if (peticion === 1) return pagina([makeJob('job-1')], 0, true);
      if (peticion === 2) return Promise.reject(new Error('caida de red'));
      return pagina([makeJob('job-2')], JOB_PAGE_SIZE, false);
    }, ['job-1', 'job-2']);

    renderActividad();
    await esperarTarjetas(1);

    intersectarCentinela();
    const reintentar = await screen.findByRole('button', { name: /Reintentar/ });
    // La tarjeta ya cargada sigue ahi: el fallo de una pagina no rompe la lista.
    expect(tarjetas()).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar mas resultados');

    fireEvent.click(reintentar);
    await esperarTarjetas(2);
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it('al agotar la lista muestra el cierre, desconecta el observador y no pide nada mas', async () => {
    mockApi((peticion) =>
      peticion === 1
        ? pagina([makeJob('job-1')], 0, true)
        : pagina([makeJob('job-2')], JOB_PAGE_SIZE, false),
      ['job-1', 'job-2'],
    );

    renderActividad();
    await esperarTarjetas(1);
    intersectarCentinela();
    await esperarTarjetas(2);

    expect(screen.getByText('No hay mas resultados')).toBeInTheDocument();
    await waitFor(() => expect(hayObservadorConectado()).toBe(false));

    // Aunque el centinela vuelva a intersectarse, no hay observador que escuche ni peticiones nuevas.
    intersectarCentinela();
    await Promise.resolve();
    expect(peticionesDeJobs()).toHaveLength(2);
  });

  it('cambiar el filtro de estado reinicia la lista y pagina dentro del filtro', async () => {
    mockApi((peticion, url) => {
      if (!url.includes('status=completed')) return pagina([makeJob('job-todas')], 0, false);
      return peticion > 2
        ? pagina([makeJob('job-completada-2')], JOB_PAGE_SIZE, false)
        : pagina([makeJob('job-completada-1')], 0, true);
    }, ['job-todas', 'job-completada-1', 'job-completada-2']);

    renderActividad();
    await esperarTarjetas(1);

    fireEvent.click(screen.getByRole('button', { name: 'Completada' }));
    await waitFor(() => expect(screen.getByText('job-completada-1')).toBeInTheDocument());
    expect(screen.queryByText('job-todas')).not.toBeInTheDocument();
    expect(tarjetas()).toHaveLength(1);

    intersectarCentinela();
    await esperarTarjetas(2);
    // Todas las peticiones del filtro activo llevan su status: se pagina DENTRO del filtro.
    const delFiltro = peticionesDeJobs().filter((url) => url.includes('status=completed'));
    expect(delFiltro).toHaveLength(2);
    expect(delFiltro[1]).toContain(`offset=${JOB_PAGE_SIZE}`);
  });

  it('dos paginas con un id repetido renderizan una sola tarjeta', async () => {
    mockApi((peticion) =>
      peticion === 1
        ? pagina([makeJob('job-a'), makeJob('job-b')], 0, true)
        : pagina([makeJob('job-b'), makeJob('job-c')], JOB_PAGE_SIZE, false),
      ['job-a', 'job-b', 'job-c'],
    );

    renderActividad();
    await esperarTarjetas(2);
    intersectarCentinela();

    await esperarTarjetas(3);
    expect(screen.getAllByText('job-b')).toHaveLength(1);
  });

  it('si la primera pagina no llena el viewport, encadena la siguiente sola hasta agotar', async () => {
    mockApi((peticion) =>
      peticion < 3
        ? pagina([makeJob(`job-${peticion}`)], (peticion - 1) * JOB_PAGE_SIZE, true)
        : pagina([makeJob('job-3')], 2 * JOB_PAGE_SIZE, false),
      ['job-1', 'job-2', 'job-3'],
    );

    renderActividad();
    await esperarTarjetas(1);

    // Un solo cruce: el centinela sigue visible tras cada pagina (pantalla alta) y la carga encadena.
    intersectarCentinela();
    await esperarTarjetas(3);
    expect(peticionesDeJobs()).toHaveLength(3);
    expect(screen.getByText('No hay mas resultados')).toBeInTheDocument();
  });
});
