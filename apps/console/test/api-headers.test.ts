import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/lib/api';

const API_URL = 'https://api.test';

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'token-test' } },
      })),
    },
  },
}));

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Record<string, string> {
  return fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
}

describe('apiFetch headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('NO manda Content-Type en peticiones sin body (DELETE)', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await apiFetch('/x', { method: 'DELETE' });

    const headers = sentHeaders(fetchMock);
    expect(headers).not.toHaveProperty('Content-Type');
    expect(headers.Authorization).toBe('Bearer token-test');
  });

  it('manda Content-Type: application/json en peticiones con body (POST)', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));

    await apiFetch('/x', { method: 'POST', body: '{}' });

    const headers = sentHeaders(fetchMock);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer token-test');
  });
});
