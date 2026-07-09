import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  crearEmisorAlertaUpgrade,
  construirCorreoAlertaUpgrade,
  type AlertaUpgradeParams,
} from '../src/email/upgrade-alert-email.js';
import { RESEND_ENDPOINT } from '../src/email/resend-client.js';

// Emisor de la ALERTA DE UPGRADE al operador: unit tests SIN red (fetch mockeado, jamas un correo real).
// Cubre el contrato best-effort: envia con la config completa; sin UPGRADE_ALERTS_EMAIL no envia y avisa
// UNA sola vez; sin config de Resend no envia; y NUNCA lanza aunque Resend falle o explote la red.

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const PARAMS: AlertaUpgradeParams = {
  ownerId: 'owner-1',
  ownerEmail: 'lead@test.com',
  requestedTier: 'autonomous',
  featureContext: 'scheduled_tasks',
  createdAt: '2026-07-01T00:00:00.000Z',
};

const DEPS = {
  resendApiKey: 're_test_key',
  fromEmail: 'hola@send.test.com',
  alertsEmail: 'operador@test.com',
  logger,
};

function okFetch() {
  return vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('construirCorreoAlertaUpgrade (contenido, puro)', () => {
  it('asunto con el email del solicitante; cuerpo con email, owner_id, tier, feature y fecha', () => {
    const correo = construirCorreoAlertaUpgrade(PARAMS);
    expect(correo.subject).toBe('Nueva solicitud de upgrade: lead@test.com');
    for (const esperado of [
      'lead@test.com',
      'owner-1',
      'autonomous',
      'scheduled_tasks',
      '2026-07-01T00:00:00.000Z',
    ]) {
      expect(correo.text).toContain(esperado);
      expect(correo.html).toContain(esperado);
    }
  });

  it('sin email en el token: el asunto identifica por owner_id y el cuerpo lo dice', () => {
    const correo = construirCorreoAlertaUpgrade({ ...PARAMS, ownerEmail: null });
    expect(correo.subject).toBe('Nueva solicitud de upgrade: owner-1');
    expect(correo.text).toContain('sin email en el token');
  });

  it('sin featureContext: el cuerpo indica CTA generico', () => {
    const correo = construirCorreoAlertaUpgrade({ ...PARAMS, featureContext: null });
    expect(correo.text).toContain('CTA generico');
  });

  it('escapa HTML en los datos del solicitante (el email es dato de usuario)', () => {
    const correo = construirCorreoAlertaUpgrade({ ...PARAMS, ownerEmail: '<b>x</b>@test.com' });
    expect(correo.html).not.toContain('<b>x</b>');
    expect(correo.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('crearEmisorAlertaUpgrade: envio', () => {
  it('con config completa hace POST a Resend con from/to/subject correctos', async () => {
    const fetchImpl = okFetch();
    const emisor = crearEmisorAlertaUpgrade({ ...DEPS, fetchImpl });
    await emisor.enviarAlertaUpgrade(PARAMS);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('hola@send.test.com');
    expect(body.to).toBe('operador@test.com'); // el operador de UPGRADE_ALERTS_EMAIL, no el usuario
    expect(body.subject).toBe('Nueva solicitud de upgrade: lead@test.com');
    expect(body.text).toContain('owner-1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('crearEmisorAlertaUpgrade: sin UPGRADE_ALERTS_EMAIL', () => {
  it('no envia nada y avisa UNA sola vez aunque haya varias solicitudes', async () => {
    const fetchImpl = okFetch();
    const emisor = crearEmisorAlertaUpgrade({ ...DEPS, alertsEmail: undefined, fetchImpl });

    await emisor.enviarAlertaUpgrade(PARAMS);
    await emisor.enviarAlertaUpgrade(PARAMS);
    await emisor.enviarAlertaUpgrade({ ...PARAMS, ownerId: 'owner-2' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1); // el aviso es una sola vez
    expect(logger.warn).toHaveBeenCalledWith({}, expect.stringContaining('UPGRADE_ALERTS_EMAIL'));
  });
});

describe('crearEmisorAlertaUpgrade: sin config de Resend', () => {
  it('sin RESEND_API_KEY no envia (loguea y sigue)', async () => {
    const fetchImpl = okFetch();
    const emisor = crearEmisorAlertaUpgrade({ ...DEPS, resendApiKey: undefined, fetchImpl });
    await emisor.enviarAlertaUpgrade(PARAMS);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({}, expect.stringContaining('falta configuracion de email'));
  });

  it('sin remitente no envia (loguea y sigue)', async () => {
    const fetchImpl = okFetch();
    const emisor = crearEmisorAlertaUpgrade({ ...DEPS, fromEmail: undefined, fetchImpl });
    await emisor.enviarAlertaUpgrade(PARAMS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('crearEmisorAlertaUpgrade: NUNCA lanza (best-effort)', () => {
  it('Resend responde no-2xx: loguea el error y no lanza', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const emisor = crearEmisorAlertaUpgrade({ ...DEPS, fetchImpl });
    await expect(emisor.enviarAlertaUpgrade(PARAMS)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
      expect.stringContaining('Resend respondio con error'),
    );
  });

  it('fetch explota (red caida): loguea y no lanza', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const emisor = crearEmisorAlertaUpgrade({ ...DEPS, fetchImpl });
    await expect(emisor.enviarAlertaUpgrade(PARAMS)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'ECONNREFUSED' }),
      expect.stringContaining('best-effort'),
    );
  });
});
