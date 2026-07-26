// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { RegistrationState } from '../src/lib/registration';
import type { EstadoSitio, SitioConectado } from '../src/lib/sitios';

// Se mockean los hooks de datos y de mutaciones para ejercer la ACCION UNICA DE ELIMINAR de la
// lista de sitios sin red ni react-query: un solo boton por fila (bote de basura + "Eliminar"),
// confirmacion previa, borrado forzado desde cualquier estado y fila que desaparece de inmediato.
const {
  useMeMock,
  useSitiosMock,
  useJobSeguimientoMock,
  useJobsSeguimientoMock,
  eliminarMock,
} = vi.hoisted(() => ({
  useMeMock: vi.fn(),
  useSitiosMock: vi.fn(),
  useJobSeguimientoMock: vi.fn(),
  useJobsSeguimientoMock: vi.fn(),
  eliminarMock: vi.fn(),
}));

// La pagina importa ApiError (lib/api), que arrastra el cliente de Supabase: se mockea para no
// leer las env (supabase.ts lanza sin ellas), igual que en sitios-pais.dom.test.tsx.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

vi.mock('../src/lib/queries', () => ({
  useMe: useMeMock,
  useSitios: useSitiosMock,
  useJobSeguimiento: useJobSeguimientoMock,
  useJobsSeguimiento: useJobsSeguimientoMock,
  // La pagina tambien puede ensenarle una tarea a un sitio; ese flujo tiene su propio test de
  // componente (grabar-tarea-dialog.dom.test.tsx) y aqui basta con que el hook exista y no consulte.
  useGrabacion: () => ({ data: undefined }),
}));

vi.mock('../src/lib/mutations', () => {
  const mutacionInerte = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null });
  return {
    useConectarSitio: mutacionInerte,
    useConfirmarSitio: mutacionInerte,
    useEliminarSitio: () => ({ mutate: eliminarMock, reset: vi.fn(), isPending: false, isError: false, error: null }),
    useUpdateProfilePais: mutacionInerte,
    useAbrirGrabacion: mutacionInerte,
    useTerminarGrabacion: mutacionInerte,
    useGuardarGrabacion: mutacionInerte,
  };
});

import { SitiosConectadosPage } from '../src/pages/SitiosConectadosPage';

const ME: RegistrationState = {
  needsRegistration: false,
  profile: {
    id: 'u1',
    orgId: null,
    accountType: 'individual',
    role: 'individual',
    fullName: 'Ada',
    identityVerified: true,
    tier: 'autonomous',
    pais: 'AR',
    createdAt: 'x',
    updatedAt: 'x',
  },
  organization: null,
  subscription: null,
  usageCounter: null,
  isAdmin: false,
};

function sitio(estado: EstadoSitio): SitioConectado {
  return {
    id: 's1',
    dominio: 'en.wikipedia.org',
    estado,
    vistaEnVivoUrl: null,
    creadoEn: '2026-07-01T00:00:00Z',
    ultimoUsoEn: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMeMock.mockReturnValue({ data: ME, isLoading: false });
  useSitiosMock.mockImplementation(() => ({
    data: [sitio('activo')],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }));
  useJobSeguimientoMock.mockReturnValue({ data: undefined, isError: false });
  useJobsSeguimientoMock.mockReturnValue([]);
});

afterEach(cleanup);

describe('SitiosConectadosPage: una sola accion de eliminar por fila', () => {
  it('la fila tiene UN solo boton, con el bote de basura y la etiqueta "Eliminar" visibles', () => {
    render(<SitiosConectadosPage />);
    const boton = screen.getByRole('button', { name: 'Eliminar la conexión con en.wikipedia.org' });
    expect(boton).toHaveTextContent('Eliminar');
    expect(screen.queryByText('Desconectar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desconectar/ })).not.toBeInTheDocument();
  });

  it.each(['activo', 'esperando_login', 'error', 'caducado'] as const)(
    'desde el estado %s: el boton esta habilitado y, tras confirmar, encola el borrado forzado',
    (estado) => {
      useSitiosMock.mockImplementation(() => ({
        data: [sitio(estado)],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      }));
      render(<SitiosConectadosPage />);
      const boton = screen.getByRole('button', { name: 'Eliminar la conexión con en.wikipedia.org' });
      expect(boton).toBeEnabled();
      fireEvent.click(boton);
      // Confirmacion previa: nada se elimina al primer click.
      expect(eliminarMock).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/eliminará permanentemente/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar de todos modos' }));
      expect(eliminarMock).toHaveBeenCalledWith('s1', expect.anything());
    },
  );

  it('cancelar la confirmacion no elimina nada y cierra el dialogo', () => {
    render(<SitiosConectadosPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar la conexión con en.wikipedia.org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(eliminarMock).not.toHaveBeenCalled();
  });

  it('al aceptarse el borrado, la fila desaparece DE INMEDIATO y no queda ningun mensaje de error', () => {
    eliminarMock.mockImplementation(
      (_id, opts?: { onSuccess?: (r: { status: string; jobId: string }) => void }) => {
        opts?.onSuccess?.({ status: 'accepted', jobId: 'job-1' });
      },
    );
    // El job encolado sigue en vuelo y la lista todavia trae la fila: la pagina la oculta igual.
    useJobsSeguimientoMock.mockImplementation((ids: string[]) =>
      ids.map(() => ({ data: { status: 'queued' }, isError: false })),
    );
    render(<SitiosConectadosPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar la conexión con en.wikipedia.org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar de todos modos' }));
    expect(screen.queryByText('en.wikipedia.org')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
