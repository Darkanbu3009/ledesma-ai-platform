import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '../src/lib/attachments';
import { PLAYGROUND_MAX_ITERATIONS, runAgentStream } from '../src/lib/run-agent';
import type { SseMessage } from '../src/lib/sse';

// La rama de credencial GUARDADA agrega el JWT del usuario via getAccessToken (lee la sesion de
// Supabase). Mockeamos el cliente para que devuelva un token estable y testeable.
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'jwt-de-prueba' } },
      })),
    },
  },
}));

const API_URL = 'https://api.test';

/** Body SSE como el del backend: bloques de texto convertidos a bytes en un stream legible. */
function sseBody(blocks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
}

function stubFetch(blocks: string[]) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(sseBody(blocks), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function runTurno(onMessage: (message: SseMessage) => void): Promise<void> {
  await runAgentStream({
    agentId: 'agente-1',
    credential: { mode: 'paste', apiKey: 'sk-test' },
    messages: [{ role: 'user', content: 'hola' }],
    signal: new AbortController().signal,
    onMessage,
  });
}

describe('runAgentStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('llama POST {apiUrl}/v1/run/{agentId}', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runTurno(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/v1/run/agente-1`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('key al momento: manda x-provider-key, sin Authorization ni x-credential-id', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runTurno(() => {});

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-provider-key']).toBe('sk-test');
    expect(headers).not.toHaveProperty('x-provider-base-url');
    // El camino al momento es el contrato publico: NO lleva identidad de usuario ni id de credencial.
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('x-credential-id');
  });

  it('credencial guardada: manda x-credential-id + Authorization, sin x-provider-key', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runAgentStream({
      agentId: 'agente-1',
      credential: { mode: 'saved', credentialId: 'cred-123' },
      messages: [{ role: 'user', content: 'hola' }],
      signal: new AbortController().signal,
      onMessage: () => {},
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-credential-id']).toBe('cred-123');
    expect(headers.Authorization).toBe('Bearer jwt-de-prueba');
    // La boveda resuelve la key server-side: la key nunca viaja desde el cliente.
    expect(headers).not.toHaveProperty('x-provider-key');
  });

  it('manda exactamente { messages, maxIterations } en el body, sin config del agente', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runTurno(() => {});

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
      maxIterations: PLAYGROUND_MAX_ITERATIONS,
    });
  });

  it('entrega los mensajes SSE a onMessage en orden', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    stubFetch(['data: {"type":"text_delta","text":"hola"}\n\n', 'event: done\ndata: {}\n\n']);

    const received: SseMessage[] = [];
    await runTurno((message) => received.push(message));

    expect(received).toEqual([
      { kind: 'event', event: { type: 'text_delta', text: 'hola' } },
      { kind: 'done' },
    ]);
  });

  it('incluye attachments en el body cuando hay adjuntos', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);
    const attachments: AttachmentRef[] = [
      { kind: 'pdf', url: 'https://signed.test/factura', mimeType: 'application/pdf', name: 'factura.pdf' },
      { kind: 'image', url: 'https://signed.test/logo', mimeType: 'image/png', name: 'logo.png' },
    ];

    await runAgentStream({
      agentId: 'agente-1',
      credential: { mode: 'paste', apiKey: 'sk-test' },
      messages: [{ role: 'user', content: 'hola' }],
      attachments,
      signal: new AbortController().signal,
      onMessage: () => {},
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
      attachments,
      maxIterations: PLAYGROUND_MAX_ITERATIONS,
    });
  });

  it('NO agrega la clave attachments cuando la lista esta vacia (envio solo-texto intacto)', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runAgentStream({
      agentId: 'agente-1',
      credential: { mode: 'paste', apiKey: 'sk-test' },
      messages: [{ role: 'user', content: 'hola' }],
      attachments: [],
      signal: new AbortController().signal,
      onMessage: () => {},
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
      maxIterations: PLAYGROUND_MAX_ITERATIONS,
    });
  });
});
