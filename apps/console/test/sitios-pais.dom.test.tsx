// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { RegistrationState } from '../src/lib/registration';

// Se mockean los hooks de datos y de mutaciones: asi se ejerce el FLUJO DE CAPTURA DE PAIS de la
// pagina de Sitios (la parte nueva de este PR) sin red ni react-query. El resto de la pagina
// (login en vivo, eliminar) se cubre en sus propios tests.
const {
  useMeMock,
  useSitiosMock,
  useJobSeguimientoMock,
  useJobsSeguimientoMock,
  conectarMock,
  guardarPaisMock,
} = vi.hoisted(() => ({
  useMeMock: vi.fn(),
  useSitiosMock: vi.fn(),
  useJobSeguimientoMock: vi.fn(),
  useJobsSeguimientoMock: vi.fn(),
  conectarMock: vi.fn(),
  guardarPaisMock: vi.fn(),
}));

// La pagina importa ApiError (lib/api), que arrastra el cliente de Supabase: se mockea para no
// leer las env (supabase.ts lanza sin ellas), igual que en profile.dom.test.tsx.
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
    useConectarSitio: () => ({ mutate: conectarMock, reset: vi.fn(), isPending: false, isError: false, error: null }),
    useConfirmarSitio: mutacionInerte,
    useEliminarSitio: mutacionInerte,
    useUpdateProfilePais: () => ({ mutate: guardarPaisMock, reset: vi.fn(), isPending: false, isError: false, error: null }),
    useAbrirGrabacion: mutacionInerte,
    useTerminarGrabacion: mutacionInerte,
    useGuardarGrabacion: mutacionInerte,
  };
});

import { SitiosConectadosPage } from '../src/pages/SitiosConectadosPage';

function me(pais: string | null): RegistrationState {
  return {
    needsRegistration: false,
    profile: {
      id: 'u1',
      orgId: null,
      accountType: 'individual',
      role: 'individual',
      fullName: 'Ada',
      identityVerified: true,
      tier: 'autonomous',
      pais,
      createdAt: 'x',
      updatedAt: 'x',
    },
    organization: null,
    subscription: null,
    usageCounter: null,
    isAdmin: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSitiosMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  useJobSeguimientoMock.mockReturnValue({ data: undefined, isError: false });
  useJobsSeguimientoMock.mockReturnValue([]);
});

afterEach(cleanup);

function conectarSitio(url: string) {
  fireEvent.change(screen.getByLabelText('URL del sitio'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: /Conectar sitio/ }));
}

describe('SitiosConectadosPage: captura del pais antes de la primera conexion', () => {
  it('perfil SIN pais: conectar abre el dialogo de pais y NO encola nada todavia', () => {
    useMeMock.mockReturnValue({ data: me(null), isLoading: false });
    render(<SitiosConectadosPage />);
    conectarSitio('https://en.wikipedia.org');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Tus agentes navegarán desde tu país/)).toBeInTheDocument();
    expect(conectarMock).not.toHaveBeenCalled();
    expect(guardarPaisMock).not.toHaveBeenCalled();
  });

  it('al guardar el pais elegido, se persiste en el perfil y la conexion CONTINUA con ese pais', () => {
    useMeMock.mockReturnValue({ data: me(null), isLoading: false });
    // El PATCH responde el estado consolidado con el pais ya normalizado: la conexion usa ESE valor.
    guardarPaisMock.mockImplementation((_input, opts?: { onSuccess?: (state: RegistrationState) => void }) => {
      opts?.onSuccess?.(me('AR'));
    });
    render(<SitiosConectadosPage />);
    conectarSitio('https://en.wikipedia.org');
    fireEvent.change(screen.getByLabelText('País'), { target: { value: 'AR' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar y conectar/ }));
    expect(guardarPaisMock).toHaveBeenCalledWith({ pais: 'AR' }, expect.anything());
    expect(conectarMock).toHaveBeenCalledWith(
      { url: 'https://en.wikipedia.org', pais: 'AR' },
      expect.anything(),
    );
    // El dialogo se cierra: la captura fue de UNA sola vez.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('perfil CON pais: conectar va DIRECTO con el pais del perfil, sin volver a pedirlo', () => {
    useMeMock.mockReturnValue({ data: me('CL'), isLoading: false });
    render(<SitiosConectadosPage />);
    conectarSitio('https://en.wikipedia.org');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(guardarPaisMock).not.toHaveBeenCalled();
    expect(conectarMock).toHaveBeenCalledWith(
      { url: 'https://en.wikipedia.org', pais: 'CL' },
      expect.anything(),
    );
  });

  it('cancelar el dialogo descarta la conexion pendiente (no encola nada)', () => {
    useMeMock.mockReturnValue({ data: me(null), isLoading: false });
    render(<SitiosConectadosPage />);
    conectarSitio('https://en.wikipedia.org');
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(conectarMock).not.toHaveBeenCalled();
    expect(guardarPaisMock).not.toHaveBeenCalled();
  });
});
