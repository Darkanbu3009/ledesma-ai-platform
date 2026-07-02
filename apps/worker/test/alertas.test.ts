import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { Logger } from '../src/logger.js';
import {
  crearNotificadorFallos,
  construirCorreoFallo,
  truncarError,
  tipoDeJobLegible,
  MAX_ERROR_CHARS,
  ALERT_COOLDOWN_MS,
  type NotificadorFallosDeps,
} from '../src/alertas.js';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Un mensaje del usuario que NUNCA debe aparecer en el correo (verifica que no se filtra el payload). */
const MENSAJE_SECRETO = 'DATO-SENSIBLE-DEL-USUARIO-42';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload: { messages: [{ role: 'user', content: MENSAJE_SECRETO }] },
    scheduledFor: null,
    attempts: 3,
    lastError: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    startedAt: '2026-06-30T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

/** fetch fake que resuelve OK y captura las llamadas. */
function fakeFetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"id":"email-1"}' }) as unknown as Response);
}

/** Deps completas del notificador con todo cableado (fetch/now/getters inyectados). */
function makeNotifDeps(overrides: Partial<NotificadorFallosDeps> = {}): NotificadorFallosDeps {
  return {
    resendApiKey: 're_test_key',
    fromEmail: 'alertas@send.ledesma-ai-labs.com',
    consoleBaseUrl: 'https://app.ledesma-ai-labs.com',
    getOwnerEmail: vi.fn(async () => 'dueno@ejemplo.com'),
    getAgentName: vi.fn(async () => 'Mi Agente'),
    logger: makeLogger(),
    fetchImpl: fakeFetchOk() as unknown as typeof fetch,
    now: () => 1_000_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('truncarError', () => {
  it('deja intacto un texto corto', () => {
    expect(truncarError('boom')).toBe('boom');
  });

  it('trunca a MAX_ERROR_CHARS y agrega elipsis', () => {
    const largo = 'x'.repeat(MAX_ERROR_CHARS + 50);
    const out = truncarError(largo);
    expect(out.length).toBe(MAX_ERROR_CHARS + 3); // 300 chars + '...'
    expect(out.endsWith('...')).toBe(true);
  });

  it('tolera null/undefined -> string vacio', () => {
    expect(truncarError(null)).toBe('');
    expect(truncarError(undefined)).toBe('');
  });
});

describe('tipoDeJobLegible', () => {
  it('receta cuando el payload es kind:recipe', () => {
    const job = makeJob({ payload: { kind: 'recipe', recipeId: 'r1', steps: [{ message: 'x' }] } });
    expect(tipoDeJobLegible(job)).toBe('receta');
  });

  it('mensaje cuando el payload es simple', () => {
    expect(tipoDeJobLegible(makeJob())).toBe('mensaje');
  });
});

describe('construirCorreoFallo', () => {
  it('arma asunto/cuerpo con agente, tipo, fecha, error truncado y enlace a /actividad', () => {
    const correo = construirCorreoFallo({
      agentName: 'Mi Agente',
      tipo: 'mensaje',
      reason: 'Error: proveedor 500',
      fechaISO: '2026-07-02T14:33:00.000Z',
      consoleBaseUrl: 'https://app.ejemplo.com',
    });

    expect(correo.subject).toBe('Fallo la ejecucion de tu agente Mi Agente');
    // Texto plano
    expect(correo.text).toContain('Mi Agente');
    expect(correo.text).toContain('Tipo: mensaje');
    expect(correo.text).toContain('2026-07-02 14:33 UTC');
    expect(correo.text).toContain('Error: proveedor 500');
    expect(correo.text).toContain('https://app.ejemplo.com/actividad');
    // HTML
    expect(correo.html).toContain('Fallo la ejecucion de tu agente Mi Agente');
    expect(correo.html).toContain('https://app.ejemplo.com/actividad');
  });

  it('normaliza la barra final de la base de la consola', () => {
    const correo = construirCorreoFallo({
      agentName: 'A',
      tipo: 'receta',
      reason: 'x',
      fechaISO: '2026-07-02T00:00:00.000Z',
      consoleBaseUrl: 'https://app.ejemplo.com/',
    });
    expect(correo.text).toContain('https://app.ejemplo.com/actividad');
    expect(correo.text).not.toContain('.com//actividad');
  });

  it('sin consoleBaseUrl no incluye enlace pero sigue siendo valido', () => {
    const correo = construirCorreoFallo({
      agentName: 'A',
      tipo: 'mensaje',
      reason: 'x',
      fechaISO: '2026-07-02T00:00:00.000Z',
    });
    expect(correo.text).not.toContain('/actividad');
    expect(correo.text).not.toContain('Ver la actividad');
    expect(correo.subject).toBe('Fallo la ejecucion de tu agente A');
  });

  it('escapa HTML en el nombre del agente y en el error (anti-inyeccion)', () => {
    const correo = construirCorreoFallo({
      agentName: '<b>x</b>',
      tipo: 'mensaje',
      reason: 'Error: <script>alert(1)</script>',
      fechaISO: '2026-07-02T00:00:00.000Z',
    });
    expect(correo.html).not.toContain('<script>');
    expect(correo.html).toContain('&lt;script&gt;');
    expect(correo.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('trunca el error a 300 chars en el cuerpo', () => {
    const largo = 'z'.repeat(400);
    const correo = construirCorreoFallo({
      agentName: 'A',
      tipo: 'mensaje',
      reason: largo,
      fechaISO: '2026-07-02T00:00:00.000Z',
    });
    expect(correo.text).toContain(`${'z'.repeat(300)}...`);
    expect(correo.text).not.toContain('z'.repeat(301));
  });
});

describe('crearNotificadorFallos.notificarFallo', () => {
  it('camino feliz: envia via Resend con Bearer, remitente y destinatario, sin filtrar el payload', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob(), 'Error: proveedor 500');

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
    expect(body.from).toBe('alertas@send.ledesma-ai-labs.com');
    expect(body.to).toBe('dueno@ejemplo.com');
    expect(body.subject).toBe('Fallo la ejecucion de tu agente Mi Agente');
    expect(body.text).toContain('Error: proveedor 500');
    // El payload (mensaje del usuario) NUNCA debe viajar en el correo.
    expect(init.body as string).not.toContain(MENSAJE_SECRETO);
  });

  it('sin RESEND_API_KEY: no envia, loguea y no lanza', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({ resendApiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await expect(notif.notificarFallo(makeJob(), 'boom')).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falta configuracion de email'),
      expect.anything(),
    );
  });

  it('sin remitente (RESEND_FROM_EMAIL): no envia', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({ fromEmail: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob(), 'boom');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sin email del owner: no envia, loguea y no lanza', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({
      getOwnerEmail: vi.fn(async () => null),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob(), 'boom');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no se encontro el email del owner'),
      expect.anything(),
    );
  });

  it('cooldown: el segundo fallo del mismo owner dentro de la ventana no envia', async () => {
    let clock = 1_000_000;
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({ now: () => clock, fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob(), 'boom-1');
    clock += ALERT_COOLDOWN_MS - 1; // aun dentro de la ventana
    await notif.notificarFallo(makeJob(), 'boom-2');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('cooldown'),
      expect.anything(),
    );
  });

  it('cooldown: pasada la ventana, el mismo owner vuelve a recibir correo', async () => {
    let clock = 1_000_000;
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({ now: () => clock, fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob(), 'boom-1');
    clock += ALERT_COOLDOWN_MS + 1; // supera la ventana
    await notif.notificarFallo(makeJob(), 'boom-2');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('cooldown es POR owner: dos owners distintos reciben aunque sea en la misma ventana', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob({ ownerId: 'user-A' }), 'boom');
    await notif.notificarFallo(makeJob({ ownerId: 'user-B' }), 'boom');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('Resend cae (fetch rechaza): el job sigue su curso, se loguea y no lanza', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const deps = makeNotifDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await expect(notif.notificarFallo(makeJob(), 'boom')).resolves.toBeUndefined();
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('Resend responde no-2xx: se loguea el status y no lanza', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 422, text: async () => 'invalid from' }) as unknown as Response,
    );
    const deps = makeNotifDeps({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob(), 'boom');

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Resend respondio con error'),
      expect.objectContaining({ status: 422 }),
    );
  });

  it('nombre de agente ausente: el asunto cae al agentId', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({
      getAgentName: vi.fn(async () => null),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const notif = crearNotificadorFallos(deps);

    await notif.notificarFallo(makeJob({ agentId: 'agent-xyz' }), 'boom');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { subject: string };
    expect(body.subject).toBe('Fallo la ejecucion de tu agente agent-xyz');
  });

  it('best-effort: aunque getOwnerEmail lance, notificarFallo no propaga', async () => {
    const fetchImpl = fakeFetchOk();
    const deps = makeNotifDeps({
      getOwnerEmail: vi.fn(async () => {
        throw new Error('permiso denegado auth.users');
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const notif = crearNotificadorFallos(deps);

    await expect(notif.notificarFallo(makeJob(), 'boom')).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalled();
  });
});
