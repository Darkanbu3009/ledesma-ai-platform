import { describe, expect, it, vi } from 'vitest';
import { streamAgent } from '../src/client.js';
import type { SseMessage } from '../src/sse.js';
import type { ChatMessage } from '../src/turns.js';

const ENDPOINT = 'https://cliente.test/v1/run/agente-1';
const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hola' }];

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

function makeFetch(blocks: string[]) {
  return vi.fn<typeof fetch>(async () => new Response(sseBody(blocks), { status: 200 }));
}

async function runTurno(
  fetchImpl: typeof fetch,
  opts: {
    providerKey?: string;
    sessionToken?: string;
    onMessage?: (message: SseMessage) => void;
  } = {},
): Promise<void> {
  await streamAgent(
    {
      endpoint: ENDPOINT,
      providerKey: opts.providerKey,
      sessionToken: opts.sessionToken,
      messages: MESSAGES,
      signal: new AbortController().signal,
      onMessage: opts.onMessage ?? (() => {}),
    },
    fetchImpl,
  );
}

describe('streamAgent', () => {
  it('hace POST exactamente al endpoint dado', async () => {
    const fetchMock = makeFetch(['event: done\ndata: {}\n\n']);

    await runTurno(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ENDPOINT);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('NO manda x-provider-key cuando providerKey no viene', async () => {
    const fetchMock = makeFetch(['event: done\ndata: {}\n\n']);

    await runTurno(fetchMock);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers).not.toHaveProperty('x-provider-key');
  });

  it('manda x-provider-key cuando providerKey viene', async () => {
    const fetchMock = makeFetch(['event: done\ndata: {}\n\n']);

    await runTurno(fetchMock, { providerKey: 'sk-test' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-provider-key']).toBe('sk-test');
  });

  it('manda x-session-token cuando sessionToken viene', async () => {
    const fetchMock = makeFetch(['event: done\ndata: {}\n\n']);

    await runTurno(fetchMock, { sessionToken: 'tok-1' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-session-token']).toBe('tok-1');
    expect(headers).not.toHaveProperty('x-provider-key');
  });

  it('con sessionToken y providerKey juntos manda SOLO x-session-token', async () => {
    const fetchMock = makeFetch(['event: done\ndata: {}\n\n']);

    await runTurno(fetchMock, { sessionToken: 'tok-1', providerKey: 'sk-test' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-session-token']).toBe('tok-1');
    expect(headers).not.toHaveProperty('x-provider-key');
  });

  it('manda exactamente { messages } en el body', async () => {
    const fetchMock = makeFetch(['event: done\ndata: {}\n\n']);

    await runTurno(fetchMock);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ messages: MESSAGES });
  });

  it('entrega los mensajes de dos bloques SSE a onMessage en orden', async () => {
    const fetchMock = makeFetch([
      'data: {"type":"text_delta","text":"hola"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);

    const received: SseMessage[] = [];
    await runTurno(fetchMock, { onMessage: (message) => received.push(message) });

    expect(received).toEqual([
      { kind: 'event', event: { type: 'text_delta', text: 'hola' } },
      { kind: 'done' },
    ]);
  });

  it('convierte una respuesta !ok en un error con el code del body', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 'AUTHENTICATION', message: 'Bad key' } }), {
          status: 401,
        }),
    );

    const received: SseMessage[] = [];
    await runTurno(fetchMock, { onMessage: (message) => received.push(message) });

    expect(received).toEqual([{ kind: 'error', code: 'AUTHENTICATION', message: 'Bad key' }]);
  });
});
