import { describe, expect, it, vi } from 'vitest';
import { createTokenManager } from '../src/token-manager.js';

const TOKEN_URL = 'https://cliente.test/api/token-agente';

/** Respuesta como la que el backend del cliente retransmite desde /v1/session-tokens. */
function tokenResponse(token: string, expiresAtMs: number): Response {
  return new Response(JSON.stringify({ token, expiresAt: new Date(expiresAtMs).toISOString() }), {
    status: 200,
  });
}

describe('createTokenManager', () => {
  it('hace POST al token-url sin headers especiales y devuelve el token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => tokenResponse('tok-1', 600_000));
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    await expect(manager.get()).resolves.toBe('tok-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TOKEN_URL);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('reutiliza el token cacheado mientras no este por expirar', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => tokenResponse('tok-1', 600_000));
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    await manager.get();
    await expect(manager.get()).resolves.toBe('tok-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pide un token nuevo cuando el cacheado entra en el margen de renovacion', async () => {
    let now = 0;
    let emitted = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      emitted += 1;
      return tokenResponse(`tok-${emitted}`, now + 60_000);
    });
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => now });

    await expect(manager.get()).resolves.toBe('tok-1');
    // Expira en 60s y el margen default es 30s: a los 30s ya se considera por expirar.
    now = 30_000;
    await expect(manager.get()).resolves.toBe('tok-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respeta un refreshMarginMs custom', async () => {
    let now = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => tokenResponse('tok-1', 60_000));
    const manager = createTokenManager({
      tokenUrl: TOKEN_URL,
      fetchImpl: fetchMock,
      nowFn: () => now,
      refreshMarginMs: 5_000,
    });

    await manager.get();
    now = 30_000; // con margen de 5s el token sigue valido hasta los 55s
    await manager.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dos get() concurrentes comparten el mismo fetch en vuelo', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    const first = manager.get();
    const second = manager.get();
    release(tokenResponse('tok-1', 600_000));

    await expect(first).resolves.toBe('tok-1');
    await expect(second).resolves.toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidate() borra el cache y el proximo get() pide token nuevo', async () => {
    let emitted = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      emitted += 1;
      return tokenResponse(`tok-${emitted}`, 600_000);
    });
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    await expect(manager.get()).resolves.toBe('tok-1');
    manager.invalidate();
    await expect(manager.get()).resolves.toBe('tok-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lanza el error esperado si la respuesta no es ok', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { code: 'AUTHENTICATION' } }), { status: 401 }),
    );
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    await expect(manager.get()).rejects.toThrow('No se pudo obtener el token de sesion');
  });

  it('lanza el error esperado si el JSON no trae un token string', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ token: 123, expiresAt: 'x' }), { status: 200 }),
    );
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    await expect(manager.get()).rejects.toThrow('No se pudo obtener el token de sesion');
  });

  it('tras un fallo, el siguiente get() vuelve a intentar', async () => {
    let calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return calls === 1 ? new Response('', { status: 500 }) : tokenResponse('tok-1', 600_000);
    });
    const manager = createTokenManager({ tokenUrl: TOKEN_URL, fetchImpl: fetchMock, nowFn: () => 0 });

    await expect(manager.get()).rejects.toThrow('No se pudo obtener el token de sesion');
    await expect(manager.get()).resolves.toBe('tok-1');
  });
});
