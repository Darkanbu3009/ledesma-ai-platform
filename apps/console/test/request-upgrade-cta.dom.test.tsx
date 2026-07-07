// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Se mockea apiFetch para verificar el endpoint/body exactos sin red (mismo enfoque que profile-mutations).
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: apiFetchMock }));

import { RequestUpgradeCta } from '../src/components/upgrade/RequestUpgradeCta';
import type {
  FeatureContext,
  MyUpgradeRequestsState,
  UpgradeRequest,
} from '../src/lib/upgrade-requests';

afterEach(() => {
  apiFetchMock.mockReset();
  cleanup();
});

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Rutea el mock: GET /me devuelve `meState`; POST /upgrade-requests devuelve la solicitud creada. */
function mockApi(meState: MyUpgradeRequestsState) {
  apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/v1/upgrade-requests/me') return Promise.resolve(meState);
    if (path === '/v1/upgrade-requests' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        requestedTier: 'pro' | 'autonomous';
        featureContext?: FeatureContext;
      };
      const upgradeRequest: UpgradeRequest = {
        id: 'new',
        ownerId: 'u1',
        requestedTier: body.requestedTier,
        featureContext: body.featureContext ?? null,
        status: 'pending',
        note: null,
        createdAt: 'x',
        updatedAt: 'y',
      };
      return Promise.resolve({ upgradeRequest, created: true });
    }
    return Promise.reject(new Error(`unexpected apiFetch ${path}`));
  });
}

function activeRequest(featureContext: FeatureContext): UpgradeRequest {
  return {
    id: 'r1',
    ownerId: 'u1',
    requestedTier: 'autonomous',
    featureContext,
    status: 'pending',
    note: null,
    createdAt: 'x',
    updatedAt: 'y',
  };
}

const FEATURES: FeatureContext[] = ['scheduled_tasks', 'triggers', 'recipes', 'configurator'];

describe('RequestUpgradeCta', () => {
  it.each(FEATURES)(
    'no solicitado: el boton solicita con requestedTier=autonomous y featureContext=%s, y pasa a "enviada"',
    async (featureContext) => {
      mockApi({ upgradeRequests: [] });
      const client = makeClient();
      render(
        <Wrapper client={client}>
          <RequestUpgradeCta featureContext={featureContext} />
        </Wrapper>,
      );

      const button = await screen.findByRole('button', { name: /Solicitar acceso/i });
      await waitFor(() => expect(button).toBeEnabled());

      fireEvent.click(button);

      // POST con el featureContext EXACTO de la pagina (nunca sube el tier: requestedTier siempre autonomous).
      await waitFor(() =>
        expect(apiFetchMock).toHaveBeenCalledWith('/v1/upgrade-requests', {
          method: 'POST',
          body: JSON.stringify({ requestedTier: 'autonomous', featureContext }),
        }),
      );

      // Tras el exito: badge "enviada" y el boton ya no se re-ofrece (evita duplicados).
      expect(await screen.findByText(/Solicitud enviada/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Solicitar acceso/i })).toBeNull();
    },
  );

  it('ya solicitado (GET /me con una pending): muestra "enviada", sin boton ni POST', async () => {
    mockApi({ upgradeRequests: [activeRequest('triggers')] });
    const client = makeClient();
    render(
      <Wrapper client={client}>
        <RequestUpgradeCta featureContext="triggers" />
      </Wrapper>,
    );

    expect(await screen.findByText(/Solicitud enviada/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Solicitar acceso/i })).toBeNull();

    const postCalled = apiFetchMock.mock.calls.some(
      ([path, init]) =>
        path === '/v1/upgrade-requests' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalled).toBe(false);
  });

  it('error: muestra el aviso y mantiene el boton para reintentar', async () => {
    apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/v1/upgrade-requests/me') return Promise.resolve({ upgradeRequests: [] });
      if (path === '/v1/upgrade-requests' && init?.method === 'POST')
        return Promise.reject({ status: 500 });
      return Promise.reject(new Error(`unexpected apiFetch ${path}`));
    });
    const client = makeClient();
    render(
      <Wrapper client={client}>
        <RequestUpgradeCta featureContext="recipes" />
      </Wrapper>,
    );

    const button = await screen.findByRole('button', { name: /Solicitar acceso/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/No pudimos enviar tu solicitud/i)).toBeInTheDocument();
    // El boton sigue visible: el usuario puede reintentar.
    expect(screen.getByRole('button', { name: /Solicitar acceso/i })).toBeInTheDocument();
  });
});
