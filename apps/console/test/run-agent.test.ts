import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '../src/lib/attachments';
import { runAgentStream } from '../src/lib/run-agent';
import type { SseMessage } from '../src/lib/sse';

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
    providerKey: 'sk-test',
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

  it('manda la key BYOK en x-provider-key y NO manda x-provider-base-url', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runTurno(() => {});

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-provider-key']).toBe('sk-test');
    expect(headers).not.toHaveProperty('x-provider-base-url');
  });

  it('manda exactamente { messages } en el body, sin config del agente', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runTurno(() => {});

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
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
      providerKey: 'sk-test',
      messages: [{ role: 'user', content: 'hola' }],
      attachments,
      signal: new AbortController().signal,
      onMessage: () => {},
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
      attachments,
    });
  });

  it('NO agrega la clave attachments cuando la lista esta vacia (envio solo-texto intacto)', async () => {
    vi.stubEnv('VITE_API_URL', API_URL);
    const fetchMock = stubFetch(['event: done\ndata: {}\n\n']);

    await runAgentStream({
      agentId: 'agente-1',
      providerKey: 'sk-test',
      messages: [{ role: 'user', content: 'hola' }],
      attachments: [],
      signal: new AbortController().signal,
      onMessage: () => {},
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
    });
  });
});
