import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  crearEmisorBienvenida,
  type EmisorBienvenidaDeps,
  type WelcomeLogger,
} from '../src/email/welcome-email.js';
import { construirCorreoBienvenida, PRODUCTO } from '../src/email/welcome-email-content.js';

function makeLogger(): WelcomeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** fetch fake que resuelve OK (201 de Resend) y captura las llamadas. */
function fakeFetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn(
    async () => ({ ok: true, status: 200, text: async () => '{"id":"email-1"}' }) as unknown as Response,
  );
}

/** Deps completas del emisor con todo cableado (config + fetch inyectado). */
function makeDeps(overrides: Partial<EmisorBienvenidaDeps> = {}): EmisorBienvenidaDeps {
  return {
    resendApiKey: 're_test_key',
    fromEmail: 'hola@send.ledesma-ai-labs.com',
    consoleBaseUrl: 'https://app.ledesma-ai-labs.com',
    logger: makeLogger(),
    fetchImpl: fakeFetchOk() as unknown as typeof fetch,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('construirCorreoBienvenida', () => {
  it('arma asunto de bienvenida, saludo personalizado y enlace al panel', () => {
    const correo = construirCorreoBienvenida({ fullName: 'Ada', consoleBaseUrl: 'https://app.ejemplo.com' });

    expect(correo.subject).toBe(`Bienvenido a ${PRODUCTO}`);
    // Texto plano
    expect(correo.text).toContain('Hola Ada,');
    expect(correo.text).toContain('primer agente');
    expect(correo.text).toContain('https://app.ejemplo.com/dashboard');
    // HTML
    expect(correo.html).toContain(`Bienvenido a ${PRODUCTO}`);
    expect(correo.html).toContain('https://app.ejemplo.com/dashboard');
  });

  it('sin fullName usa un saludo generico', () => {
    const correo = construirCorreoBienvenida({ consoleBaseUrl: 'https://app.ejemplo.com' });
    expect(correo.text).toContain('Hola,');
    expect(correo.text).not.toContain('Hola undefined');
  });

  it('normaliza la barra final de la base de la consola', () => {
    const correo = construirCorreoBienvenida({ consoleBaseUrl: 'https://app.ejemplo.com/' });
    expect(correo.text).toContain('https://app.ejemplo.com/dashboard');
    expect(correo.text).not.toContain('.com//dashboard');
  });

  it('sin consoleBaseUrl no incluye enlace pero sigue siendo valido', () => {
    const correo = construirCorreoBienvenida({ fullName: 'Ada' });
    expect(correo.text).not.toContain('/dashboard');
    expect(correo.text).not.toContain('Abre tu panel');
    expect(correo.subject).toBe(`Bienvenido a ${PRODUCTO}`);
  });

  it('escapa HTML en el nombre del usuario (anti-inyeccion)', () => {
    const correo = construirCorreoBienvenida({ fullName: '<b>x</b>', consoleBaseUrl: 'https://app.ejemplo.com' });
    expect(correo.html).not.toContain('<b>x</b>');
    expect(correo.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('crearEmisorBienvenida.enviarBienvenida', () => {
  it('camino feliz: envia via Resend con Bearer, remitente y destinatario correctos', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await emisor.enviarBienvenida({ email: 'nuevo@ejemplo.com', fullName: 'Ada' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(body.from).toBe('hola@send.ledesma-ai-labs.com');
    expect(body.to).toBe('nuevo@ejemplo.com');
    expect(body.subject).toBe(`Bienvenido a ${PRODUCTO}`);
    expect(body.text).toContain('https://app.ledesma-ai-labs.com/dashboard');
  });

  it('sin RESEND_API_KEY: no envia, loguea y no lanza', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeDeps({ resendApiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await expect(emisor.enviarBienvenida({ email: 'nuevo@ejemplo.com', fullName: 'Ada' })).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('falta configuracion de email'),
    );
  });

  it('sin remitente (RESEND_WELCOME_FROM_EMAIL): no envia', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeDeps({ fromEmail: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await emisor.enviarBienvenida({ email: 'nuevo@ejemplo.com', fullName: 'Ada' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sin email del usuario: no envia, loguea y no lanza (y no filtra PII en el log)', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await emisor.enviarBienvenida({ email: null, fullName: 'Ada' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('no tiene email'),
    );
  });

  it('email vacio o solo espacios: se trata como ausente y no envia', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await emisor.enviarBienvenida({ email: '   ', fullName: 'Ada' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Resend cae (fetch rechaza): no lanza y se loguea (best-effort)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await expect(emisor.enviarBienvenida({ email: 'nuevo@ejemplo.com', fullName: 'Ada' })).resolves.toBeUndefined();
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('Resend responde no-2xx: se loguea el status y no lanza', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 422, text: async () => 'invalid from' }) as unknown as Response,
    );
    const deps = makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await emisor.enviarBienvenida({ email: 'nuevo@ejemplo.com', fullName: 'Ada' });

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 422 }),
      expect.stringContaining('Resend respondio con error'),
    );
  });

  it('sin consoleBaseUrl: envia igual, sin enlace en el cuerpo', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeDeps({ consoleBaseUrl: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    const emisor = crearEmisorBienvenida(deps);

    await emisor.enviarBienvenida({ email: 'nuevo@ejemplo.com', fullName: 'Ada' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).not.toContain('/dashboard');
  });
});
