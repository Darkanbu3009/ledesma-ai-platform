import { describe, it, expect, vi } from 'vitest';
import {
  AprobacionNoAprobadaError,
  barrerAprobacionesVencidas,
  clasificarTipoAccion,
  construirCorreoAprobacionExpirada,
  construirCorreoAprobacionPendiente,
  construirReanudacionAprobada,
  construirReanudacionRechazada,
  crearNotificadorAprobaciones,
  extraerDescripcion,
} from '../src/aprobaciones.js';
import type { BarridoAprobacionesDeps } from '../src/aprobaciones.js';
import { MARCADOR_REQUIERE_APROBACION } from '../src/prompt-tarea-web.js';
import { makeAprobacion, makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('extraerDescripcion / clasificarTipoAccion', () => {
  it('extrae la primera linea util despues del marcador y la etiqueta de tipo', () => {
    const detalle = `${MARCADOR_REQUIERE_APROBACION}: financiera: Enviar el pago de 2,400 MXN a Aeromexico\ny mas contexto`;
    expect(extraerDescripcion(detalle)).toBe('Enviar el pago de 2,400 MXN a Aeromexico');
    expect(clasificarTipoAccion(detalle)).toBe('financiera');
  });

  it('etiqueta irreversible explicita gana sobre la heuristica', () => {
    const detalle = `${MARCADOR_REQUIERE_APROBACION}: irreversible: borrar la factura 22`;
    expect(clasificarTipoAccion(detalle)).toBe('irreversible');
  });

  it('sin etiqueta, la heuristica detecta dinero; sin pistas, cae a irreversible', () => {
    expect(clasificarTipoAccion(`${MARCADOR_REQUIERE_APROBACION}: pagar la suscripcion anual`)).toBe('financiera');
    expect(clasificarTipoAccion(`${MARCADOR_REQUIERE_APROBACION}: publicar el post del blog`)).toBe('irreversible');
  });

  it('mensaje sin linea util cae a la descripcion de respaldo y una linea larga se trunca', () => {
    expect(extraerDescripcion(`${MARCADOR_REQUIERE_APROBACION}:`)).toContain('sin descripcion');
    const larga = `${MARCADOR_REQUIERE_APROBACION}: ${'x'.repeat(500)}`;
    expect(extraerDescripcion(larga).length).toBeLessThanOrEqual(303);
  });
});

describe('RESTRICCION DURA: la ejecucion exige una aprobacion aprobada', () => {
  it('construirReanudacionAprobada LANZA con todo estado distinto de aprobada', () => {
    for (const estado of ['pendiente', 'rechazada', 'expirada'] as const) {
      expect(() => construirReanudacionAprobada(makeAprobacion({ estado }), 'objetivo')).toThrow(
        AprobacionNoAprobadaError,
      );
    }
  });

  it('con aprobacion aprobada produce el prompt que autoriza SOLO esa accion', () => {
    const aprobacion = makeAprobacion({ estado: 'aprobada' });
    const { objetivo, systemPrompt } = construirReanudacionAprobada(aprobacion, 'compra el vuelo');
    expect(objetivo).toContain('APROBO');
    expect(objetivo).toContain(aprobacion.descripcion);
    expect(systemPrompt).toContain('REANUDACION CON APROBACION HUMANA');
    // Cualquier OTRA accion sigue exigiendo checkpoint: el marcador sigue vigente en el prompt.
    expect(systemPrompt).toContain(MARCADOR_REQUIERE_APROBACION);
  });

  it('el prompt del rechazo con instruccion NO autoriza la accion original', () => {
    const aprobacion = makeAprobacion({ estado: 'rechazada', instruccionRechazo: 'busca uno mas barato' });
    const { objetivo, systemPrompt } = construirReanudacionRechazada(
      aprobacion,
      'compra el vuelo',
      'busca uno mas barato',
    );
    expect(objetivo).toContain('RECHAZO');
    expect(objetivo).toContain('busca uno mas barato');
    expect(objetivo).toContain('NO ejecutes la accion rechazada');
    expect(systemPrompt).not.toContain('REANUDACION CON APROBACION HUMANA');
  });
});

describe('correos de aprobacion', () => {
  it('el correo pendiente lleva la descripcion, el dominio y el enlace; jamas contenido de pagina', () => {
    const correo = construirCorreoAprobacionPendiente({
      descripcion: 'Enviar el pago de 2,400 MXN',
      dominio: 'app.ejemplo.com',
      expiraEnIso: '2026-07-20T00:15:00.000Z',
      consoleBaseUrl: 'https://console.ejemplo.com/',
    });
    expect(correo.subject).toContain('aprobacion');
    expect(correo.text).toContain('Enviar el pago de 2,400 MXN');
    expect(correo.text).toContain('app.ejemplo.com');
    expect(correo.text).toContain('https://console.ejemplo.com/actividad');
    expect(correo.text).toContain('2026-07-20 00:15 UTC');
  });

  it('el correo de expiracion deja claro que la accion NO se ejecuto', () => {
    const correo = construirCorreoAprobacionExpirada({ descripcion: 'Enviar el pago' });
    expect(correo.text).toContain('SIN ejecutarla');
  });

  it('el html escapa la descripcion (dato del agente/pagina)', () => {
    const correo = construirCorreoAprobacionPendiente({
      descripcion: '<script>alert(1)</script>',
      dominio: 'a.com',
      expiraEnIso: '2026-07-20T00:15:00.000Z',
    });
    expect(correo.html).not.toContain('<script>');
    expect(correo.html).toContain('&lt;script&gt;');
  });
});

describe('crearNotificadorAprobaciones', () => {
  it('envia via Resend al owner y nunca lanza sin config', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const notificador = crearNotificadorAprobaciones({
      resendApiKey: 'key',
      fromEmail: 'alertas@ejemplo.com',
      getOwnerEmail: vi.fn(async () => 'owner@ejemplo.com'),
      logger: makeLogger(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await notificador.notificarPendiente({
      ownerId: 'user-1',
      jobId: 'job-1',
      dominio: 'app.ejemplo.com',
      descripcion: 'pagar',
      expiraEnIso: '2026-07-20T00:15:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const sinConfig = crearNotificadorAprobaciones({
      getOwnerEmail: vi.fn(async () => 'owner@ejemplo.com'),
      logger: makeLogger(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      sinConfig.notificarExpirada({ ownerId: 'user-1', jobId: 'job-1', descripcion: 'pagar' }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('barrerAprobacionesVencidas', () => {
  function makeBarrido(overrides: Partial<BarridoAprobacionesDeps> = {}): BarridoAprobacionesDeps {
    return {
      aprobaciones: makeAprobacionesRepo({
        listarPendientesVencidas: vi.fn(async () => [makeAprobacion()]),
      }),
      cerrarSesion: vi.fn(async () => {}),
      marcarJobFallido: vi.fn(async () => {}),
      notificador: {
        notificarPendiente: vi.fn(async () => {}),
        notificarExpirada: vi.fn(async () => {}),
      },
      logger: makeLogger(),
      ...overrides,
    };
  }

  it('expira, registra la intervencion Art.22 (sin decisor), cierra la sesion, falla el job y notifica', async () => {
    const deps = makeBarrido();
    await barrerAprobacionesVencidas(deps, new Date('2026-07-20T00:20:00.000Z'));
    expect(deps.aprobaciones.expirar).toHaveBeenCalledWith('apr-1');
    expect(deps.aprobaciones.registrarIntervencion).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'expirada', decididaPor: null, aprobacionId: 'apr-1' }),
    );
    expect(deps.cerrarSesion).toHaveBeenCalledWith('ses-1');
    expect(deps.marcarJobFallido).toHaveBeenCalledWith('job-1', expect.stringContaining('sin ejecutar'));
    expect(deps.notificador?.notificarExpirada).toHaveBeenCalledTimes(1);
  });

  it('si una decision humana gano la carrera (CAS falso), no toca nada', async () => {
    const deps = makeBarrido({
      aprobaciones: makeAprobacionesRepo({
        listarPendientesVencidas: vi.fn(async () => [makeAprobacion()]),
        expirar: vi.fn(async () => false),
      }),
    });
    await barrerAprobacionesVencidas(deps, new Date());
    expect(deps.aprobaciones.registrarIntervencion).not.toHaveBeenCalled();
    expect(deps.cerrarSesion).not.toHaveBeenCalled();
    expect(deps.marcarJobFallido).not.toHaveBeenCalled();
  });

  it('un fallo al listar se traga (best-effort) y no lanza', async () => {
    const deps = makeBarrido({
      aprobaciones: makeAprobacionesRepo({
        listarPendientesVencidas: vi.fn(async () => {
          throw new Error('db caida');
        }),
      }),
    });
    await expect(barrerAprobacionesVencidas(deps, new Date())).resolves.toBeUndefined();
  });
});
