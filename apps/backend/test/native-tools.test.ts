import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  NATIVE_TOOLS,
  NATIVE_TOOL_NAMES,
  NATIVE_TOOL_PREFIX,
  NATIVE_TOOL_ROUTES,
  nativeToolsToDefinitions,
  createNativeExecutor,
} from '../src/tools/native-tools.js';
import { signWebhookPayload } from '../src/tools/webhook-signature.js';

// Secreto de plataforma (firma los POST al worker) y secreto de agente (jamas debe usarse aca).
const PLATFORM_SECRET = 'platform-SENTINEL-secret-0123456789abcdef0123';
const AGENT_SECRET = 'whsec_secreto_del_agente_NO_DEBE_USARSE_0123456789';
const WORKER_URL = 'https://web-worker.ledesma.example.com';

function fakeResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('nativeToolsToDefinitions', () => {
  it('devuelve exactamente las 2 tools nativas con sus nombres platform_*', () => {
    const defs = nativeToolsToDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.name)).toEqual(['platform_iniciar_tarea_web', 'platform_revisar_tarea_web']);
    for (const def of defs) {
      expect(def.name.startsWith(NATIVE_TOOL_PREFIX)).toBe(true);
      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('iniciar_tarea_web declara flujo + params{url,instruccion} requeridos', () => {
    const def = nativeToolsToDefinitions().find((d) => d.name === 'platform_iniciar_tarea_web');
    expect(def?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        flujo: { type: 'string' },
        params: {
          type: 'object',
          properties: { url: { type: 'string' }, instruccion: { type: 'string' } },
          required: ['url', 'instruccion'],
        },
      },
      required: ['flujo', 'params'],
    });
  });

  it('revisar_tarea_web declara job_id requerido', () => {
    const def = nativeToolsToDefinitions().find((d) => d.name === 'platform_revisar_tarea_web');
    expect(def?.inputSchema).toMatchObject({
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    });
  });

  it('devuelve copias frescas (no aliasea el catalogo compartido)', () => {
    const a = nativeToolsToDefinitions();
    const b = nativeToolsToDefinitions();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(NATIVE_TOOLS[0]);
  });

  it('NATIVE_TOOL_NAMES es un Set con los 2 nombres nativos', () => {
    expect(NATIVE_TOOL_NAMES).toBeInstanceOf(Set);
    expect([...NATIVE_TOOL_NAMES].sort()).toEqual(['platform_iniciar_tarea_web', 'platform_revisar_tarea_web']);
  });
});

describe('createNativeExecutor', () => {
  it('platform_iniciar_tarea_web: POST a /tools/iniciar-tarea-web con { tool, input }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'job_id: abc123' })));
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock));

    const input = { flujo: 'extraer_datos_web', params: { url: 'https://x.com', instruccion: 'titulo' } };
    const result = await execute({ id: 't1', name: 'platform_iniciar_tarea_web', input });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://web-worker.ledesma.example.com/tools/iniciar-tarea-web',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tool: 'platform_iniciar_tarea_web', input }),
      }),
    );
    expect(result).toEqual({ content: 'job_id: abc123', isError: false });
  });

  it('platform_revisar_tarea_web: POST a /tools/revisar-tarea-web', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'en proceso' })));
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock));

    await execute({ id: 't2', name: 'platform_revisar_tarea_web', input: { job_id: 'abc123' } });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://web-worker.ledesma.example.com/tools/revisar-tarea-web');
  });

  it('firma con el SECRETO DE PLATAFORMA, no con el del agente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock));

    await execute({ id: 't1', name: 'platform_revisar_tarea_web', input: { job_id: 'j1' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const ts = Number(headers['x-ledesma-timestamp']);
    expect(Number.isInteger(ts)).toBe(true);
    expect(headers['x-ledesma-signature']).toMatch(/^v1=[0-9a-f]{64}$/);

    const signature = headers['x-ledesma-signature']!.replace('v1=', '');
    // Coincide con la firma derivada del secreto de PLATAFORMA y el body exacto...
    expect(signature).toBe(signWebhookPayload(String(init.body), ts, PLATFORM_SECRET));
    // ...y NO con la del secreto del agente (jamas viaja ni se usa).
    expect(signature).not.toBe(signWebhookPayload(String(init.body), ts, AGENT_SECRET));
  });

  it('no filtra el secreto de plataforma en headers ni body (solo la firma derivada)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock));

    await execute({ id: 't1', name: 'platform_iniciar_tarea_web', input: { flujo: 'extraer_datos_web', params: { url: 'https://x', instruccion: 'y' } } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const serialized = JSON.stringify(init.headers) + String(init.body);
    expect(serialized).not.toContain(PLATFORM_SECRET);
    expect(serialized).not.toContain('SENTINEL');
  });

  it('normaliza la barra final del workerUrl (sin doble slash)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' })));
    const execute = createNativeExecutor(`${WORKER_URL}/`, PLATFORM_SECRET, asFetch(fetchMock));

    await execute({ id: 't1', name: 'platform_revisar_tarea_web', input: { job_id: 'j1' } });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://web-worker.ledesma.example.com/tools/revisar-tarea-web');
  });

  it('nombre no nativo: isError true sin tocar la red (defensa, no deberia pasar por el dispatch)', async () => {
    const fetchMock = vi.fn();
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock));

    const result = await execute({ id: 't1', name: 'cotizar', input: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('no es una herramienta nativa');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch lanza: isError true con el detalle, sin lanzar', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock), { warn: () => {} });

    const result = await execute({ id: 't1', name: 'platform_revisar_tarea_web', input: { job_id: 'j1' } });

    expect(result.isError).toBe(true);
    expect(result.content).toBe('Tool platform_revisar_tarea_web native failed: Error: ECONNREFUSED');
  });

  it('status 500: isError true con el status, sin lanzar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse('boom', 500));
    const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock), { warn: () => {} });

    const result = await execute({ id: 't1', name: 'platform_revisar_tarea_web', input: { job_id: 'j1' } });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('500');
  });

  it('ningun modo de fallo filtra el secreto de plataforma en content ni en warn', async () => {
    const haystacks: string[] = [];
    const warn = (m: string) => haystacks.push(m);
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const escenarios: ReturnType<typeof vi.fn>[] = [
      vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ content: 'ok' }))),
      vi.fn().mockResolvedValue(fakeResponse('boom', 500)),
      vi.fn().mockResolvedValue(fakeResponse('', 302)),
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      vi.fn().mockRejectedValue('cable suelto'),
      vi.fn().mockRejectedValue(abortError),
    ];
    for (const fetchMock of escenarios) {
      const execute = createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(fetchMock), { warn });
      const r = await execute({ id: 't1', name: 'platform_revisar_tarea_web', input: { job_id: 'j1' } });
      haystacks.push(String(r.content));
    }
    haystacks.push(String((await createNativeExecutor(WORKER_URL, PLATFORM_SECRET, asFetch(vi.fn()), { warn })({ id: 't', name: 'no_nativa', input: {} })).content));

    expect(haystacks.length).toBeGreaterThanOrEqual(7);
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(PLATFORM_SECRET);
      expect(haystack).not.toContain('SENTINEL');
    }
  });
});

describe('NATIVE_TOOL_ROUTES', () => {
  it('mapea cada tool nativa a su ruta del worker', () => {
    expect(NATIVE_TOOL_ROUTES).toEqual({
      platform_iniciar_tarea_web: '/tools/iniciar-tarea-web',
      platform_revisar_tarea_web: '/tools/revisar-tarea-web',
    });
    // Cada nombre nativo tiene ruta.
    for (const name of NATIVE_TOOL_NAMES) {
      expect(typeof NATIVE_TOOL_ROUTES[name]).toBe('string');
    }
  });
});
