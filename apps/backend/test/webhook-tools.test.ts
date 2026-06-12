import { describe, it, expect, vi, afterEach } from 'vitest';
import type { StoredTool } from '../src/agents/types.js';
import type { LookupFn } from '../src/tools/ip-guard.js';
import { createWebhookExecutor, isForbiddenWebhookUrl, WEBHOOK_LIMITS } from '../src/tools/webhook-tools.js';
import { signWebhookPayload, verifyWebhookSignature } from '../src/tools/webhook-signature.js';

const TEST_SECRET = 'whsec_secreto_de_prueba_0123456789abcdef';

/** lookup inyectado que resuelve a una IP publica: los tests nunca tocan la red. */
const lookupPublic: LookupFn = async () => [{ address: '34.107.221.82', family: 4 }];

function makeTool(overrides: Partial<StoredTool> = {}): StoredTool {
  return {
    name: 'cotizar',
    description: 'Calcula el precio de N piezas',
    inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
    url: 'https://api.cliente.com/hooks/cotizar',
    ...overrides,
  };
}

/** Respuesta minima compatible con lo que usa el ejecutor: ok, status y text(). */
function fakeResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createWebhookExecutor', () => {
  it('ejecuta una tool: POST a la url con { tool, input } y regresa el content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: { piezas: 2 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cliente.com/hooks/cotizar',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tool: 'cotizar', input: { piezas: 2 } }),
      }),
    );
    expect(result).toEqual({ content: 'ok', isError: false });
  });

  it('firma cada POST: timestamp numerico y firma v1 verificable con el secreto y el body exacto', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    await execute({ id: 'tu_1', name: 'cotizar', input: { piezas: 2 } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const ts = Number(headers['x-ledesma-timestamp']);
    expect(Number.isInteger(ts)).toBe(true);
    expect(Math.abs(Math.floor(Date.now() / 1000) - ts)).toBeLessThanOrEqual(5);
    expect(headers['x-ledesma-signature']).toMatch(/^v1=[0-9a-f]{64}$/);

    // La firma corresponde EXACTAMENTE a la cadena enviada como body.
    const signature = headers['x-ledesma-signature']!.replace('v1=', '');
    expect(signature).toBe(signWebhookPayload(String(init.body), ts, TEST_SECRET));
    expect(verifyWebhookSignature(String(init.body), ts, signature, TEST_SECRET, 300, ts)).toBe(true);
  });

  it('los headers del POST no contienen el secreto en claro', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    await execute({ id: 'tu_1', name: 'cotizar', input: { piezas: 2 } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const serialized = JSON.stringify(init.headers) + String(init.body);
    expect(serialized).not.toContain(TEST_SECRET);
    expect(serialized).not.toContain('whsec_');
  });

  it('respuesta JSON sin content: regresa el body serializado con isError false', async () => {
    const body = JSON.stringify({ resultado: 42 });
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(body));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result).toEqual({ content: body, isError: false });
  });

  it('respuesta { content, isError: true }: propaga isError true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'x', isError: true })));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result).toEqual({ content: 'x', isError: true });
  });

  it('status 500: isError true con el status en el mensaje, sin lanzar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse('boom', 500));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('500');
  });

  it('fetch lanza: isError true, sin lanzar', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('failed');
  });

  it('timeout: aborta a los timeoutMs y regresa isError con timed out', async () => {
    vi.useFakeTimers();
    // fetch que nunca resuelve pero respeta el signal: rechaza con AbortError al abortar.
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const pending = execute({ id: 'tu_1', name: 'cotizar', input: {} });
    await vi.advanceTimersByTimeAsync(WEBHOOK_LIMITS.timeoutMs);
    const result = await pending;

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out');
  });

  it('tool desconocida: isError true sin llamar al webhook', async () => {
    const fetchMock = vi.fn();
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'inexistente', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tool');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hostname que resuelve a IP privada: isError true y fetch NUNCA llamado', async () => {
    const fetchMock = vi.fn();
    const lookupPrivada: LookupFn = async () => [{ address: '10.0.0.5', family: 4 }];
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPrivada });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toBe('Tool cotizar has a forbidden webhook URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hostname que no resuelve (lookup lanza): isError true y fetch NUNCA llamado', async () => {
    const fetchMock = vi.fn();
    const lookupFalla: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupFalla });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toBe('Tool cotizar has a forbidden webhook URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el POST se hace con redirect manual', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
  });

  it('respuesta 302: isError true con mensaje de redirect, sin seguirla', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse('', 302));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('redirect');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respuesta mas larga que maxResponseChars se recorta', async () => {
    const long = 'a'.repeat(WEBHOOK_LIMITS.maxResponseChars + 500);
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(long));
    const execute = createWebhookExecutor([makeTool()], TEST_SECRET, asFetch(fetchMock), { lookupFn: lookupPublic });

    const result = await execute({ id: 'tu_1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(WEBHOOK_LIMITS.maxResponseChars);
    expect(result.content).toBe('a'.repeat(WEBHOOK_LIMITS.maxResponseChars));
  });
});

describe('isForbiddenWebhookUrl', () => {
  it.each([
    ['http://api.cliente.com/hook', true],
    ['https://localhost/hook', true],
    ['https://10.0.0.5/hook', true],
    ['https://192.168.1.1/hook', true],
    ['https://api.cliente.com/hook', false],
    ['no-es-una-url', true],
  ])('%s -> %s', (url, forbidden) => {
    expect(isForbiddenWebhookUrl(url)).toBe(forbidden);
  });
});
