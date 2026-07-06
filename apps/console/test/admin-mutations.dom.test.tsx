// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// Se mockea apiFetch para verificar el endpoint/body exactos sin red. El resto de api.ts (supabase/env) no
// se ejercita.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock }));

import { useChangeTier } from '../src/lib/mutations';

afterEach(() => {
  apiFetchMock.mockReset();
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useChangeTier', () => {
  it('llama PUT /v1/admin/users/:id/tier con el body { tier } e invalida ["admin"]', async () => {
    apiFetchMock.mockResolvedValue({ profile: { id: 'u1', tier: 'pro' } });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useChangeTier(), { wrapper: makeWrapper(client) });

    result.current.mutate({ id: 'u1', tier: 'pro' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiFetchMock).toHaveBeenCalledWith('/v1/admin/users/u1/tier', {
      method: 'PUT',
      body: JSON.stringify({ tier: 'pro' }),
    });
    // La mutacion devuelve el profile desanidado (r.profile), no el sobre completo.
    expect(result.current.data).toEqual({ id: 'u1', tier: 'pro' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin'] });
  });
});
