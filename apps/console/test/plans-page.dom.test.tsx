// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { RegistrationState } from '../src/lib/registration';
import type { ProfileTier } from '../src/lib/registration';

// Se mockean useMe (tier actual) y useSelectPlan (la mutacion real): asi el test cubre el cableado
// del catalogo (CTA -> mutate, carga, confirmacion de downgrade, error visible) sin red.
const { useMeMock, useSelectPlanMock, mutateMock } = vi.hoisted(() => ({
  useMeMock: vi.fn(),
  useSelectPlanMock: vi.fn(),
  mutateMock: vi.fn(),
}));
vi.mock('../src/lib/queries', () => ({ useMe: useMeMock }));
vi.mock('../src/lib/mutations', () => ({ useSelectPlan: useSelectPlanMock }));

import { PlansPage } from '../src/pages/PlansPage';
import { LAUNCH_NOTICE } from '../src/lib/plans';

function state(tier: ProfileTier): RegistrationState {
  return {
    needsRegistration: false,
    profile: {
      id: 'u1',
      orgId: null,
      accountType: 'individual',
      role: 'individual',
      fullName: 'Ada Lovelace',
      identityVerified: true,
      tier,
      createdAt: '2026-06-10T12:00:00.000Z',
      updatedAt: '2026-06-10T12:00:00.000Z',
    },
    organization: null,
    subscription: { id: 's1', profileId: 'u1', plan: 'free', status: 'active', createdAt: 'x' },
    usageCounter: null,
    isAdmin: false,
  };
}

function mockTier(tier: ProfileTier) {
  useMeMock.mockReturnValue({
    data: state(tier),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function mockSelectPlan({ isPending = false } = {}) {
  useSelectPlanMock.mockReturnValue({ mutate: mutateMock, isPending });
}

afterEach(() => {
  cleanup();
  useMeMock.mockReset();
  useSelectPlanMock.mockReset();
  mutateMock.mockReset();
});

describe('PlansPage', () => {
  it('muestra los tres planes con el aviso de lanzamiento y el recomendado', () => {
    mockTier('free');
    mockSelectPlan();
    render(<PlansPage />);

    expect(screen.getByText(LAUNCH_NOTICE)).toBeInTheDocument();
    for (const name of ['Free', 'Pro', 'Business']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Recomendado')).toBeInTheDocument();
  });

  it('marca el plan actual del usuario y deshabilita su CTA', () => {
    mockTier('free');
    mockSelectPlan();
    render(<PlansPage />);

    expect(screen.getByText('Tu plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan actual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir Pro' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Elegir Business' })).toBeEnabled();
  });

  it('mapea el tier autonomous al plan Business', () => {
    mockTier('autonomous');
    mockSelectPlan();
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Plan actual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir Free' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Elegir Pro' })).toBeEnabled();
  });

  it('UPGRADE directo: elegir Pro desde Free dispara la seleccion sin confirmacion', () => {
    mockTier('free');
    mockSelectPlan();
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Pro' }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toBe('pro');
    // Sin dialogo de confirmacion para un upgrade.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('DOWNGRADE: elegir Free desde Pro pide confirmacion (con las capacidades que se pierden) y solo confirma al aceptar', () => {
    mockTier('pro');
    mockSelectPlan();
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Free' }));
    // Aun no se dispara nada: primero la confirmacion.
    expect(mutateMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Cambiar de plan' });
    expect(dialog).toHaveTextContent('Vas a cambiar al plan Free');
    expect(dialog).toHaveTextContent('autonomia');

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a Free' }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toBe('free');
  });

  it('DOWNGRADE cancelado: cerrar la confirmacion no dispara la seleccion', () => {
    mockTier('autonomous');
    mockSelectPlan();
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra estado de carga en el boton elegido y bloquea los demas CTAs mientras esta en vuelo', () => {
    mockTier('free');
    mockSelectPlan({ isPending: true });
    render(<PlansPage />);

    // Con la mutacion en vuelo, los CTAs de eleccion quedan deshabilitados (no se encadenan cambios).
    expect(screen.getByRole('button', { name: 'Elegir Pro' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir Business' })).toBeDisabled();
  });

  it('ERROR visible y no destructivo: un fallo muestra el aviso y el catalogo sigue intacto', () => {
    mockTier('free');
    mockSelectPlan();
    mutateMock.mockImplementation((_planId: unknown, opts?: { onError?: (e: unknown) => void; onSettled?: () => void }) => {
      opts?.onError?.({ status: 500 });
      opts?.onSettled?.();
    });
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Pro' }));
    expect(screen.getByText('No pudimos cambiar tu plan. Intenta de nuevo.')).toBeInTheDocument();
    // No destructivo: el CTA sigue disponible para reintentar.
    expect(screen.getByRole('button', { name: 'Elegir Pro' })).toBeEnabled();
  });

  it('ERROR en downgrade confirmado: cierra el dialogo para que el aviso quede visible', () => {
    mockTier('pro');
    mockSelectPlan();
    mutateMock.mockImplementation((_planId: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.({ status: 500 });
    });
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a Free' }));
    // El dialogo se cierra (el overlay taparia el aviso) y el error queda a la vista.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('No pudimos cambiar tu plan. Intenta de nuevo.')).toBeInTheDocument();
  });

  it('EXITO: confirma con un aviso (la cache de ["me"] la refresca la mutacion real)', () => {
    mockTier('free');
    mockSelectPlan();
    mutateMock.mockImplementation((_planId: unknown, opts?: { onSuccess?: () => void; onSettled?: () => void }) => {
      opts?.onSuccess?.();
      opts?.onSettled?.();
    });
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Pro' }));
    expect(screen.getByText('Listo. Tu plan ya esta activo.')).toBeInTheDocument();
  });

  it('sin tier resuelto no marca ningun plan como actual', () => {
    useMeMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    mockSelectPlan();
    render(<PlansPage />);

    expect(screen.queryByText('Tu plan')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan actual' })).not.toBeInTheDocument();
  });
});
