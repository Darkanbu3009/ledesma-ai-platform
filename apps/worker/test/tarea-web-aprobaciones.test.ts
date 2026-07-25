import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import { MARCADOR_REQUIERE_APROBACION } from '../src/prompt-tarea-web.js';
import { SalidaDeRedNoDisponibleError } from '../src/sitios.js';
import { PermanentExecutionError } from '../src/errores.js';
import { makeAprobacion, makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * CHECKPOINTS DE APROBACION HUMANA (7.1e) en el handler de tarea web: la pausa (crear el checkpoint,
 * job pausado, sesion VIVA) y la reanudacion (misma sesion, re-verificacion del pin, y la
 * RESTRICCION DURA: solo una aprobacion 'aprobada' ejecuta la accion pendiente).
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const OBJETIVO = 'compra el vuelo a Cancun del 12 de agosto';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo: OBJETIVO },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: 'app.ejemplo.com',
    urlLogin: 'https://app.ejemplo.com/login',
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    proxyCountry: 'AR',
    proxyState: null,
    egressIp: '203.0.113.7',
    fingerprintRef: 'contexto:ctx-1',
    sesionExternaId: null,
    vistaEnVivoUrl: null,
    estado: 'activo',
    tieneContexto: true,
    creadoEn: '2026-07-16T00:00:00.000Z',
    ultimoUsoEn: null,
    expiraEn: null,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<RepositorioSitiosParaTarea> = {}): RepositorioSitiosParaTarea {
  return {
    obtenerPorId: vi.fn(async () => makeSitio()),
    obtenerContextoDescifrado: vi.fn(async () => CONTEXTO_PLANO),
    guardarContexto: vi.fn(async () => makeSitio()),
    actualizarEstado: vi.fn(async () => makeSitio()),
    ...overrides,
  };
}

function makeNavegador(overrides: Partial<NavegadorParaTarea> = {}): NavegadorParaTarea {
  return {
    abrirSesionParaTarea: vi.fn(async () => ({
      sesionExternaId: 'ses-1',
      egressIp: '203.0.113.7',
      egressCountry: 'AR',
    })),
    inyectarContexto: vi.fn(async () => {}),
    detectarPantallaDeLogin: vi.fn(async () => false),
    extraerContexto: vi.fn(async () => CONTEXTO_PLANO),
    estadoDeSesion: vi.fn(async () => 'viva' as const),
    capturarPantalla: vi.fn(async () => 'cGxhY2Vob2xkZXI='),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'AR' })),
    cerrarSesion: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeMotor(resultado: { exito: boolean; mensaje: string }): MotorDeTareaWeb {
  // El motor real (Stagehand) ademas devuelve la traza (acciones/tokens); los tests que no la
  // ejercitan usan una traza vacia.
  return {
    ejecutar: vi.fn(async () => ({
      ...resultado,
      completado: resultado.exito,
      acciones: [],
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: makeRepo(),
    navegador: makeNavegador(),
    motor: makeMotor({ exito: true, mensaje: 'vuelo comprado' }),
    aprobaciones: makeAprobacionesRepo(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    subidorScreenshots: { subir: vi.fn(async () => 'user-1/apr-1.png') },
    notificadorAprobaciones: {
      notificarPendiente: vi.fn(async () => {}),
      notificarExpirada: vi.fn(async () => {}),
    },
    vaultSecret: '0123456789abcdef0123456789abcdef',
    model: 'anthropic/claude-sonnet-4-6',
    maxPasos: 120,
    runTimeoutMs: 600_000,
    resolveCredential: vi.fn(async () => ({
      id: 'cred-1',
      providerId: 'anthropic' as const,
      apiKey: 'sk-ant-secreta',
      baseUrl: null,
    })),
    guardarResultado: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  };
}

const MENSAJE_CHECKPOINT = `${MARCADOR_REQUIERE_APROBACION}: financiera: Enviar el formulario de pago por 2,400 MXN a Aeromexico`;

describe('pausa en checkpoint (accion financiera detectada)', () => {
  it('crea la aprobacion pendiente, sube el screenshot, notifica, pausa el job y NO ejecuta la accion', async () => {
    const motor = makeMotor({ exito: false, mensaje: MENSAJE_CHECKPOINT });
    const deps = makeDeps({ motor });
    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('pausada');
    expect(deps.aprobaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user-1',
        jobId: 'job-1',
        connectionId: CONNECTION_ID,
        sesionExternaId: 'ses-1',
        accionTipo: 'financiera',
        descripcion: 'Enviar el formulario de pago por 2,400 MXN a Aeromexico',
      }),
    );
    expect(deps.subidorScreenshots?.subir).toHaveBeenCalledWith('user-1', 'apr-1', 'cGxhY2Vob2xkZXI=');
    expect(deps.aprobaciones.guardarScreenshotPath).toHaveBeenCalledWith('apr-1', 'user-1/apr-1.png');
    expect(deps.notificadorAprobaciones?.notificarPendiente).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-1', dominio: 'app.ejemplo.com' }),
    );
    expect(deps.marcarJobPausado).toHaveBeenCalledWith('job-1');
    // El motor corrio UNA sola vez (la deteccion); la accion NO se ejecuto.
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('LA SESION NO SE CIERRA mientras la aprobacion queda pendiente', async () => {
    const motor = makeMotor({ exito: false, mensaje: MENSAJE_CHECKPOINT });
    const navegador = makeNavegador();
    const deps = makeDeps({ motor, navegador });
    await procesarTareaWeb(deps, makeJob());
    expect(navegador.cerrarSesion).not.toHaveBeenCalled();
  });

  it('la aprobacion expira en el TTL configurado (expira_en corto)', async () => {
    const motor = makeMotor({ exito: false, mensaje: MENSAJE_CHECKPOINT });
    const deps = makeDeps({ motor, aprobacionTtlMs: 5 * 60 * 1000 });
    const antes = Date.now();
    await procesarTareaWeb(deps, makeJob());
    const input = (deps.aprobaciones.crear as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      expiraEn: Date;
    };
    const delta = new Date(input.expiraEn).getTime() - antes;
    expect(delta).toBeGreaterThan(4 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(5 * 60 * 1000 + 5_000);
  });

  it('sin screenshot ni subidor, el checkpoint se crea igual (best-effort)', async () => {
    const motor = makeMotor({ exito: false, mensaje: MENSAJE_CHECKPOINT });
    const navegador = makeNavegador({
      capturarPantalla: vi.fn(async () => {
        throw new Error('sin captura');
      }),
    });
    const deps = makeDeps({ motor, navegador, subidorScreenshots: undefined });
    const resultado = await procesarTareaWeb(deps, makeJob());
    expect(resultado).toBe('pausada');
    expect(deps.aprobaciones.crear).toHaveBeenCalledTimes(1);
  });

  it('si el checkpoint NO se puede persistir: fallback 7.1d (bloquear, cerrar sesion, completar)', async () => {
    const motor = makeMotor({ exito: false, mensaje: MENSAJE_CHECKPOINT });
    const navegador = makeNavegador();
    const deps = makeDeps({
      motor,
      navegador,
      aprobaciones: makeAprobacionesRepo({
        crear: vi.fn(async () => {
          throw new Error('db caida');
        }),
      }),
    });
    const resultado = await procesarTareaWeb(deps, makeJob());
    expect(resultado).toBe('completada');
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'requiere_aprobacion' }),
    );
    // Sin checkpoint no hay quien apruebe: la sesion NO se deja viva.
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
    expect(deps.marcarJobPausado).not.toHaveBeenCalled();
  });
});

describe('reanudacion tras la decision humana', () => {
  it('APROBADA: reanuda LA MISMA sesion, re-verifica el pais de salida y ejecuta la accion', async () => {
    const aprobacion = makeAprobacion({ estado: 'aprobada', sesionExternaId: 'ses-pausada' });
    const navegador = makeNavegador();
    const motor = makeMotor({ exito: true, mensaje: 'pago enviado y tarea completada' });
    const deps = makeDeps({
      motor,
      navegador,
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    // NO abre sesion nueva: retoma la que quedo viva al pausar.
    expect(navegador.abrirSesionParaTarea).not.toHaveBeenCalled();
    expect(navegador.observarSalida).toHaveBeenCalledWith('ses-pausada');
    const params = (motor.ejecutar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      sesionExternaId: string;
      objetivo: string;
      systemPrompt: string;
    };
    expect(params.sesionExternaId).toBe('ses-pausada');
    expect(params.objetivo).toContain('APROBO');
    expect(params.systemPrompt).toContain('REANUDACION CON APROBACION HUMANA');
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ estado: 'ok' }));
    // Al terminar, la sesion SI se cierra.
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-pausada');
  });

  it('APROBADA con IP distinta pero MISMO pais al reanudar: NO aborta (rotacion normal)', async () => {
    const aprobacion = makeAprobacion({ estado: 'aprobada' });
    const navegador = makeNavegador({
      observarSalida: vi.fn(async () => ({ egressIp: '198.51.100.9', egressCountry: 'AR' })),
    });
    const deps = makeDeps({
      navegador,
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('APROBADA con PAIS distinto al reanudar: aborta SIN ejecutar y marca el sitio en error', async () => {
    const aprobacion = makeAprobacion({ estado: 'aprobada' });
    const repo = makeRepo();
    const navegador = makeNavegador({
      observarSalida: vi.fn(async () => ({ egressIp: '198.51.100.9', egressCountry: 'BR' })),
    });
    const deps = makeDeps({
      repo,
      navegador,
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    await expect(procesarTareaWeb(deps, makeJob())).rejects.toThrow(SalidaDeRedNoDisponibleError);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
    expect(repo.actualizarEstado).toHaveBeenCalledWith(CONNECTION_ID, 'user-1', 'error');
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
  });

  it('RECHAZADA sin instruccion: aborta limpio, cierra la sesion y reporta "rechazada por el usuario"', async () => {
    const aprobacion = makeAprobacion({ estado: 'rechazada', instruccionRechazo: null });
    const navegador = makeNavegador();
    const deps = makeDeps({
      navegador,
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    const resultado = await procesarTareaWeb(deps, makeJob());
    expect(resultado).toBe('completada');
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'rechazada', detalle: 'rechazada por el usuario' }),
    );
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
  });

  it('RECHAZADA con instruccion: continua con el ajuste SIN ejecutar la accion original', async () => {
    const aprobacion = makeAprobacion({
      estado: 'rechazada',
      instruccionRechazo: 'mejor reserva el vuelo de las 9 am, no pagues todavia',
    });
    const motor = makeMotor({ exito: true, mensaje: 'reserve el de las 9 am sin pagar' });
    const deps = makeDeps({
      motor,
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    const resultado = await procesarTareaWeb(deps, makeJob());
    expect(resultado).toBe('completada');
    const params = (motor.ejecutar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      objetivo: string;
      systemPrompt: string;
    };
    expect(params.objetivo).toContain('mejor reserva el vuelo de las 9 am');
    expect(params.objetivo).toContain('NO ejecutes la accion rechazada');
    // El prompt del rechazo NUNCA lleva la autorizacion de ejecucion.
    expect(params.systemPrompt).not.toContain('REANUDACION CON APROBACION HUMANA');
  });

  it('la sesion murio mientras esperaba: fallo permanente SIN ejecutar nada', async () => {
    const aprobacion = makeAprobacion({ estado: 'aprobada' });
    const navegador = makeNavegador({ estadoDeSesion: vi.fn(async () => 'muerta' as const) });
    const deps = makeDeps({
      navegador,
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    await expect(procesarTareaWeb(deps, makeJob())).rejects.toThrow(PermanentExecutionError);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
  });

  it('aprobacion aun PENDIENTE al reanudar (estado imposible): fallo permanente sin ejecutar', async () => {
    const aprobacion = makeAprobacion({ estado: 'pendiente' });
    const deps = makeDeps({
      aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
    });
    await expect(procesarTareaWeb(deps, makeJob())).rejects.toThrow(/pendiente/);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
  });

  it('la tarea reanudada topa con OTRA accion irreversible: NUEVO checkpoint en la misma sesion', async () => {
    const aprobacion = makeAprobacion({ estado: 'aprobada', sesionExternaId: 'ses-pausada' });
    const motor = makeMotor({
      exito: false,
      mensaje: `${MARCADOR_REQUIERE_APROBACION}: irreversible: confirmar la cancelacion del vuelo anterior`,
    });
    const navegador = makeNavegador();
    const aprobaciones = makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) });
    const deps = makeDeps({ motor, navegador, aprobaciones });
    const resultado = await procesarTareaWeb(deps, makeJob());
    expect(resultado).toBe('pausada');
    expect(aprobaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({ sesionExternaId: 'ses-pausada', accionTipo: 'irreversible' }),
    );
    expect(navegador.cerrarSesion).not.toHaveBeenCalled();
  });
});
