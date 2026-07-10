// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ProfileTier, RegistrationState } from '../src/lib/registration';

// Solo se mockea useMe: el catalogo es estatico (lib/plans.ts) y NO dispara mutaciones ni red; el
// tier de ['me'] se usa unicamente para marcar el plan actual y deshabilitar su CTA.
const { useMeMock } = vi.hoisted(() => ({ useMeMock: vi.fn() }));
vi.mock('../src/lib/queries', () => ({ useMe: useMeMock }));

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

afterEach(() => {
  cleanup();
  useMeMock.mockReset();
});

describe('PlansPage', () => {
  it('muestra los tres planes con el aviso de lanzamiento y el recomendado', () => {
    mockTier('free');
    render(<PlansPage />);

    expect(screen.getByText(LAUNCH_NOTICE)).toBeInTheDocument();
    for (const name of ['Free', 'Pro', 'Business']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Recomendado')).toBeInTheDocument();
  });

  it('marca el plan actual del usuario y deshabilita su CTA', () => {
    mockTier('free');
    render(<PlansPage />);

    expect(screen.getByText('Tu plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan actual' })).toBeDisabled();
    // Los otros dos planes ofrecen el CTA de eleccion (accion real en el PR de contratacion).
    expect(screen.getByRole('button', { name: 'Elegir Pro' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Elegir Business' })).toBeEnabled();
  });

  it('mapea el tier autonomous al plan Business', () => {
    mockTier('autonomous');
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Plan actual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir Free' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Elegir Pro' })).toBeEnabled();
  });

  it('el CTA de eleccion es un stub: clickearlo no rompe ni dispara nada', () => {
    mockTier('free');
    render(<PlansPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Elegir Pro' }));
    // Sin mutaciones ni navegacion: la pantalla sigue intacta.
    expect(screen.getByText(LAUNCH_NOTICE)).toBeInTheDocument();
  });

  it('sin tier resuelto no marca ningun plan como actual', () => {
    useMeMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    render(<PlansPage />);

    expect(screen.queryByText('Tu plan')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan actual' })).not.toBeInTheDocument();
  });
});
