// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// Se mockea apiFetch para verificar el endpoint/body exactos sin red (mismo enfoque que admin-mutations).
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock }));

import { useUpdateProfileName } from '../src/lib/mutations';
import type { RegistrationState } from '../src/lib/registration';

const UPDATED_STATE: RegistrationState = {
  needsRegistration: false,
  profile: {
    id: 'u1',
    orgId: null,
    accountType: 'individual',
    role: 'individual',
    fullName: 'Ada Nueva',
    identityVerified: false,
    tier: 'free',
    pais: null,
    createdAt: 'x',
    updatedAt: 'y',
  },
  organization: null,
  subscription: null,
  usageCounter: null,
  isAdmin: false,
};

afterEach(() => {
  apiFetchMock.mockReset();
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useUpdateProfileName', () => {
  it('llama PATCH /v1/me/profile con { fullName } y refresca ["me"] con la respuesta', async () => {
    apiFetchMock.mockResolvedValue(UPDATED_STATE);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    // Cache previa con el nombre viejo: la mutacion debe reemplazarla por el estado consolidado devuelto.
    client.setQueryData(['me'], {
      ...UPDATED_STATE,
      profile: { ...UPDATED_STATE.profile!, fullName: 'Ada Vieja' },
    });

    const { result } = renderHook(() => useUpdateProfileName(), { wrapper: makeWrapper(client) });

    result.current.mutate({ fullName: 'Ada Nueva' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiFetchMock).toHaveBeenCalledWith('/v1/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ fullName: 'Ada Nueva' }),
    });
    // setQueryData(['me'], state): la cache queda con el estado consolidado que devolvio el backend.
    expect(client.getQueryData(['me'])).toEqual(UPDATED_STATE);
  });
});
