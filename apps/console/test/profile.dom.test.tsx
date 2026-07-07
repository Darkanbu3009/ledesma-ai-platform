// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import type { RegistrationState } from '../src/lib/registration';

// Los hooks de datos, la mutation, el email (Supabase) y el cliente Supabase se mockean: asi se ejerce la
// pantalla y el flujo del form sin red, sin react-query y sin leer las env (supabase.ts lanza sin ellas).
const { useMeMock, useAuthMock, useUpdateProfileNameMock, useDeleteAccountMock } = vi.hoisted(() => ({
  useMeMock: vi.fn(),
  useAuthMock: vi.fn(),
  useUpdateProfileNameMock: vi.fn(),
  useDeleteAccountMock: vi.fn(),
}));
vi.mock('../src/lib/queries', () => ({ useMe: useMeMock }));
vi.mock('../src/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../src/lib/mutations', () => ({ useUpdateProfileName: useUpdateProfileNameMock }));
// La Zona de peligro usa useDeleteAccount (arrastra supabase + react-router): se mockea para ejercer la
// pantalla sin QueryClient ni Router real; su comportamiento propio se testea en danger-zone.dom.test.tsx.
vi.mock('../src/lib/account-mutations', () => ({ useDeleteAccount: useDeleteAccountMock }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { ProfilePage } from '../src/pages/ProfilePage';

function state(overrides?: Partial<RegistrationState['profile']>): RegistrationState {
  return {
    needsRegistration: false,
    profile: {
      id: 'u1',
      orgId: null,
      accountType: 'individual',
      role: 'individual',
      fullName: 'Ada Lovelace',
      identityVerified: true,
      tier: 'free',
      createdAt: '2026-06-10T12:00:00.000Z',
      updatedAt: '2026-06-10T12:00:00.000Z',
      ...overrides,
    },
    organization: null,
    subscription: { id: 's1', profileId: 'u1', plan: 'free', status: 'active', createdAt: 'x' },
    usageCounter: {
      id: 'c1',
      profileId: 'u1',
      runsUsed: 3,
      runsLimit: 10,
      periodKind: 'lifetime',
      createdAt: 'x',
    },
    isAdmin: false,
  };
}

function mockMutation() {
  const mutate = vi.fn();
  useUpdateProfileNameMock.mockReturnValue({
    mutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  // La Zona de peligro (DangerZoneSection) tambien consume una mutacion: se le da un stub inerte.
  useDeleteAccountMock.mockReturnValue({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  return mutate;
}

function mockData(data: RegistrationState) {
  useMeMock.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });
  useAuthMock.mockReturnValue({ user: { email: 'ada@example.com' }, session: null, loading: false });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useMeMock.mockReset();
  useAuthMock.mockReset();
  useUpdateProfileNameMock.mockReset();
  useDeleteAccountMock.mockReset();
});

describe('ProfilePage', () => {
  it('muestra los datos de cuenta (email de Supabase, tipo, plan, registro) y precarga el nombre', () => {
    mockData(state());
    mockMutation();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument();
    // Email tomado de useAuth().user?.email, no de /v1/me.
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Individual')).toBeInTheDocument();
    // Plan mostrado como badge de tier (no editable aqui).
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Miembro desde')).toBeInTheDocument();
    // El form del nombre viene precargado con el valor actual de ['me'].
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Ada Lovelace');
  });

  it('muestra el resumen de cuota y el enlace al Panel (sin reconstruir el dashboard)', () => {
    mockData(state());
    mockMutation();
    renderPage();

    expect(screen.getByText('Ejecuciones usadas')).toBeInTheDocument();
    // El numero va partido en un nodo de texto ("3") y un span (" / 10"): se afirma la linea completa.
    expect(screen.getByText((_, el) => el?.textContent === '3 / 10')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver mi actividad completa/ });
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('envia el nombre recortado al PATCH cuando cambia y es valido', () => {
    mockData(state());
    const mutate = mockMutation();
    renderPage();

    const input = screen.getByLabelText('Nombre completo');
    fireEvent.change(input, { target: { value: '  Ada Nueva  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ fullName: 'Ada Nueva' });
  });

  it('no envia el PATCH y muestra el error de validacion cuando el nombre queda vacio', () => {
    mockData(state());
    const mutate = mockMutation();
    renderPage();

    const input = screen.getByLabelText('Nombre completo');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/obligatorio/);
  });

  it('incluye cerrar sesion (login passwordless: sin cambio de contrasena)', () => {
    mockData(state());
    mockMutation();
    renderPage();

    expect(screen.getByRole('button', { name: /Cerrar sesión/ })).toBeInTheDocument();
  });

  it('incluye la Zona de peligro con el boton para eliminar la cuenta', () => {
    mockData(state());
    mockMutation();
    renderPage();

    expect(screen.getByRole('heading', { name: /Zona de peligro/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eliminar mi cuenta/i })).toBeInTheDocument();
  });

  it('muestra un estado de error con reintento si /v1/me falla', () => {
    useMeMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    useAuthMock.mockReturnValue({ user: null, session: null, loading: false });
    mockMutation();
    renderPage();

    expect(screen.getByText('No pudimos cargar tu cuenta')).toBeInTheDocument();
  });
});
