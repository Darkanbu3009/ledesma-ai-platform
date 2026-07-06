// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Aca NO se mockea useIsAdmin (a diferencia de admin.dom.test.tsx): se ejercita el CABLEADO REAL
// useMe -> deriveIsAdmin sobre la query ['me'] sembrada. Solo se aisla supabase, que lee env al
// importarse (api.ts lo importa); con la data ya en cache la queryFn nunca corre, asi que ese modulo
// no se usa en runtime, solo se evita que su import reviente.
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
// apiFetch se mockea para el caso de CARGA: sin data sembrada, useMe corre su queryFn -> aca la dejamos
// colgada (promesa que nunca resuelve) para observar el estado pending real, sin red. En los casos con
// data sembrada + staleTime Infinity la queryFn no corre, asi que este mock queda inerte ahi.
vi.mock('../src/lib/api', () => ({ apiFetch: () => new Promise(() => {}) }));

import { useIsAdmin } from '../src/lib/queries';
import type { RegistrationState } from '../src/lib/registration';

afterEach(cleanup);

function meState(isAdmin: boolean): RegistrationState {
  return {
    needsRegistration: false,
    profile: null,
    organization: null,
    subscription: null,
    usageCounter: null,
    isAdmin,
  };
}

function renderUseIsAdmin(seed?: RegistrationState) {
  // staleTime Infinity + data ya sembrada: la query queda 'success' sin disparar la queryFn (sin red).
  // Sin seed, la query arranca pending (queryFn colgada por el mock de apiFetch) -> estado de carga real.
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  if (seed) qc.setQueryData(['me'], seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useIsAdmin(), { wrapper });
}

describe('useIsAdmin (cableado real: useMe -> deriveIsAdmin)', () => {
  it('deriva isAdmin=true cuando /v1/me lo marca', () => {
    const { result } = renderUseIsAdmin(meState(true));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('deriva isAdmin=false para un usuario normal', () => {
    const { result } = renderUseIsAdmin(meState(false));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('fail-closed mientras /v1/me no resuelve: isLoading=true, isAdmin=false (no parpadea)', () => {
    const { result } = renderUseIsAdmin();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAdmin).toBe(false);
  });
});
