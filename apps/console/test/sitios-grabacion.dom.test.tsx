// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { RegistrationState } from '../src/lib/registration';
import type { EstadoSitio, SitioConectado } from '../src/lib/sitios';

/**
 * La pagina de Sitios ofrece ENSENARLE UNA TAREA a un sitio, y SOLO a uno que ya esta conectado. Es el
 * mismo invariante que el backend aplica (una grabacion solo se abre sobre un sitio 'activo'): en
 * 'esperando_login' -- la pantalla donde el usuario esta tecleando su contrasena -- la opcion ni
 * siquiera aparece.
 *
 * Mismo aislamiento que sitios-eliminar.dom.test.tsx: se mockean los hooks de datos y de mutaciones
 * para ejercer la pagina sin red ni react-query.
 */

const {
  useMeMock,
  useSitiosMock,
  useJobSeguimientoMock,
  useJobsSeguimientoMock,
  useGrabacionMock,
  abrirGrabacionMock,
} = vi.hoisted(() => ({
  useMeMock: vi.fn(),
  useSitiosMock: vi.fn(),
  useJobSeguimientoMock: vi.fn(),
  useJobsSeguimientoMock: vi.fn(),
  useGrabacionMock: vi.fn(),
  abrirGrabacionMock: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

vi.mock('../src/lib/queries', () => ({
  useMe: useMeMock,
  useSitios: useSitiosMock,
  useJobSeguimiento: useJobSeguimientoMock,
  useJobsSeguimiento: useJobsSeguimientoMock,
  useGrabacion: useGrabacionMock,
}));

vi.mock('../src/lib/mutations', () => {
  const mutacionInerte = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null });
  return {
    useConectarSitio: mutacionInerte,
    useConfirmarSitio: mutacionInerte,
    useEliminarSitio: mutacionInerte,
    useUpdateProfilePais: mutacionInerte,
    useAbrirGrabacion: () => ({
      mutate: abrirGrabacionMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    }),
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
    dominio: 'correo.ejemplo.com',
    estado,
    vistaEnVivoUrl: null,
    creadoEn: '2026-07-01T00:00:00Z',
    ultimoUsoEn: null,
  };
}

function conSitio(estado: EstadoSitio) {
  useSitiosMock.mockImplementation(() => ({
    data: [sitio(estado)],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useMeMock.mockReturnValue({ data: ME, isLoading: false });
  conSitio('activo');
  useJobSeguimientoMock.mockReturnValue({ data: undefined, isError: false });
  useJobsSeguimientoMock.mockReturnValue([]);
  useGrabacionMock.mockReturnValue({ data: undefined });
});

afterEach(cleanup);

describe('SitiosConectadosPage: ensenarle una tarea', () => {
  it('un sitio conectado ofrece la opcion con el texto acordado', () => {
    render(<SitiosConectadosPage />);
    expect(screen.getByRole('button', { name: 'Enseñarle una tarea' })).toBeEnabled();
  });

  it.each(['esperando_login', 'caducado', 'error'] as const)(
    'un sitio en estado %s NO ofrece ensenarle una tarea (el login jamas se graba)',
    (estado) => {
      conSitio(estado);
      render(<SitiosConectadosPage />);
      expect(screen.queryByRole('button', { name: 'Enseñarle una tarea' })).not.toBeInTheDocument();
    },
  );

  it('al elegirla se abre el dialogo que pide que le vas a ensenar, sin encolar nada todavia', () => {
    render(<SitiosConectadosPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Enseñarle una tarea' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Qué le vas a enseñar')).toBeInTheDocument();
    expect(abrirGrabacionMock).not.toHaveBeenCalled();
  });

  it('al describir la tarea y empezar, se abre la grabacion sobre ESE sitio', () => {
    render(<SitiosConectadosPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Enseñarle una tarea' }));
    fireEvent.change(screen.getByLabelText('Qué le vas a enseñar'), {
      target: { value: 'mandar el reporte semanal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(abrirGrabacionMock).toHaveBeenCalledWith(
      { connectionId: 's1', descripcion: 'mandar el reporte semanal' },
      expect.anything(),
    );
  });
});
