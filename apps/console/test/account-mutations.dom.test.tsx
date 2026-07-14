// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// apiFetch, el cliente Supabase y useNavigate se mockean: asi se ejerce el hook (endpoint/body exactos +
// el efecto de exito signOut + redirect) sin red, sin Supabase real y sin un Router de verdad.
const { apiFetchMock, signOutMock, navigateMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  signOutMock: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: signOutMock } } }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { useDeleteAccount } from '../src/lib/account-mutations';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

afterEach(() => {
  apiFetchMock.mockReset();
  signOutMock.mockReset();
  navigateMock.mockReset();
});

describe('useDeleteAccount', () => {
  it('llama DELETE /v1/me con { confirmEmail } y, al exito, dispara signOut + redirect a la landing (/)', async () => {
    apiFetchMock.mockResolvedValue({ accountDeleted: true, authUser: 'deleted', data: {} });
    signOutMock.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useDeleteAccount(), { wrapper: makeWrapper(newClient()) });

    result.current.mutate('ada@example.com');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiFetchMock).toHaveBeenCalledWith('/v1/me', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'ada@example.com' }),
    });
    // Efecto de exito: cerrar sesion del lado cliente y salir de la consola a la landing publica.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('igual redirige aunque el signOut falle (la cuenta ya se borro; la sesion no debe persistir)', async () => {
    apiFetchMock.mockResolvedValue({ accountDeleted: true, authUser: 'failed', data: {} });
    signOutMock.mockRejectedValue(new Error('revoke fallo: identidad ya no existe'));

    const { result } = renderHook(() => useDeleteAccount(), { wrapper: makeWrapper(newClient()) });

    result.current.mutate('ada@example.com');

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('ante un error (p.ej. 400 email no coincide) NO cierra sesion ni redirige', async () => {
    apiFetchMock.mockRejectedValue(Object.assign(new Error('API 400'), { status: 400 }));

    const { result } = renderHook(() => useDeleteAccount(), { wrapper: makeWrapper(newClient()) });

    result.current.mutate('no-coincide@example.com');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(signOutMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
