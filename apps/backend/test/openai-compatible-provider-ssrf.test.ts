import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderStreamEvent, ProviderStreamInput } from '@ledesma-platform/shared';
import type { LookupFn } from '../src/tools/ip-guard.js';

// Mock del SDK de OpenAI: espia el CONSTRUCTOR y el create(). La propiedad critica de este test es que
// ante un baseUrl prohibido NINGUNO de los dos se invoca -> no se abre ninguna conexion saliente.
const { constructorSpy, createMock } = vi.hoisted(() => ({
  constructorSpy: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    public chat = { completions: { create: createMock } };
    constructor(opts: unknown) {
      constructorSpy(opts);
    }
  },
}));

import { OpenAICompatibleProvider } from '../src/providers/openai-compatible/index.js';
import { createProvider } from '../src/providers/factory.js';

function chunkStream(chunks: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

async function collect(stream: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function makeInput(baseUrl: string): ProviderStreamInput {
  return {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'llama-3.1-70b', maxTokens: 256 },
    },
    credentials: { apiKey: 'sk-byok', baseUrl },
  };
}

// DNS inyectable para forzar el resultado de la resolucion sin tocar la red.
const publicLookup: LookupFn = async () => [{ address: '34.107.221.82', family: 4 }];
const loopbackLookup: LookupFn = async () => [{ address: '127.0.0.1', family: 4 }];
const rebindLookup: LookupFn = async () => [
  { address: '34.107.221.82', family: 4 },
  { address: '10.0.0.5', family: 4 },
];
const unresolvableLookup: LookupFn = async () => {
  throw new Error('ENOTFOUND');
};

beforeEach(() => {
  constructorSpy.mockClear();
  createMock.mockClear();
});

describe('OpenAICompatibleProvider guarda anti-SSRF de baseUrl', () => {
  // IP literal privada/loopback/metadata: ip-guard la juzga SIN DNS. No debe abrirse conexion alguna.
  it.each([
    ['metadata de nube', 'https://169.254.169.254/v1'],
    ['loopback', 'https://127.0.0.1:8080/v1'],
    ['privada 10/8', 'https://10.0.0.5/v1'],
    ['privada 192.168/16', 'https://192.168.1.1/v1'],
    ['loopback IPv6', 'https://[::1]/v1'],
  ])('rechaza baseUrl a IP interna (%s) y no instancia el cliente', async (_label, baseUrl) => {
    const lookupSpy = vi.fn();
    const provider = new OpenAICompatibleProvider(lookupSpy as unknown as LookupFn);

    await expect(collect(provider.stream(makeInput(baseUrl)))).rejects.toThrow(
      'openai-compatible provider baseUrl is not allowed',
    );

    // Ni se resolvio DNS (IP literal) ni se abrio conexion: cero constructor, cero create.
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(constructorSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rechaza baseUrl a localhost (resuelve a loopback via DNS) sin abrir conexion', async () => {
    const provider = new OpenAICompatibleProvider(loopbackLookup);

    await expect(collect(provider.stream(makeInput('https://localhost/v1')))).rejects.toThrow(
      'openai-compatible provider baseUrl is not allowed',
    );

    expect(constructorSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rechaza un host publico cuyo DNS resuelve (ademas) a una IP privada (rebinding basico)', async () => {
    const provider = new OpenAICompatibleProvider(rebindLookup);

    await expect(
      collect(provider.stream(makeInput('https://rebind.example.com/v1'))),
    ).rejects.toThrow('openai-compatible provider baseUrl is not allowed');

    expect(constructorSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('fail-closed: un host que no resuelve se rechaza (no se abre conexion)', async () => {
    const provider = new OpenAICompatibleProvider(unresolvableLookup);

    await expect(
      collect(provider.stream(makeInput('https://no-existe.example.com/v1'))),
    ).rejects.toThrow('openai-compatible provider baseUrl is not allowed');

    expect(constructorSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  // ESQUEMA: la apiKey viaja como Authorization Bearer -> jamas debe egresar en claro por http.
  it.each([
    ['http a host publico', 'http://api.compatible.example.com/v1'],
    ['http a loopback', 'http://127.0.0.1:11434/v1'],
    ['esquema no http(s)', 'ftp://api.compatible.example.com/v1'],
  ])('rechaza baseUrl con esquema no-https (%s) antes de resolver DNS', async (_label, baseUrl) => {
    const lookupSpy = vi.fn();
    const provider = new OpenAICompatibleProvider(lookupSpy as unknown as LookupFn);

    await expect(collect(provider.stream(makeInput(baseUrl)))).rejects.toThrow(
      'openai-compatible provider baseUrl must use https',
    );

    // El esquema se valida ANTES del DNS: ni lookup ni conexion.
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(constructorSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rechaza un baseUrl no parseable como URL', async () => {
    const provider = new OpenAICompatibleProvider(publicLookup);

    await expect(collect(provider.stream(makeInput('no-es-una-url')))).rejects.toThrow(
      'openai-compatible provider baseUrl is not a valid URL',
    );
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it('ACEPTA un baseUrl publico valido (https, host publico): la llamada procede', async () => {
    createMock.mockResolvedValue(
      chunkStream([{ choices: [{ index: 0, delta: { content: 'hey' }, finish_reason: 'stop' }] }]),
    );
    const provider = new OpenAICompatibleProvider(publicLookup);

    const events = await collect(provider.stream(makeInput('https://api.compatible.example.com/v1')));

    // El cliente se instancio con la baseURL validada y el stream se tradujo normalmente.
    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: 'sk-byok',
      baseURL: 'https://api.compatible.example.com/v1',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'text_delta', text: 'hey' });
  });

  // Cobertura de los TRES caminos con un solo control: POST /v1/agent/run, POST /v1/run/:agentId y el
  // worker bajan todos por runAgent -> runModel -> createProvider('openai-compatible') -> stream(). El
  // provider que el FACTORY construye (el de produccion, sin DNS inyectado) tambien aplica la guarda:
  // un baseUrl a metadata se rechaza sin abrir conexion, con IP literal no hace falta DNS real.
  it('el provider construido por el factory (usado por los 3 caminos) tambien bloquea metadata', async () => {
    const provider = createProvider('openai-compatible');

    await expect(
      collect(provider.stream(makeInput('https://169.254.169.254/latest/meta-data'))),
    ).rejects.toThrow('openai-compatible provider baseUrl is not allowed');

    expect(constructorSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});
