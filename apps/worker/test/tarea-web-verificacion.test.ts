import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import { parsearDetencion } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import { MARCADOR_REQUIERE_APROBACION } from '../src/prompt-tarea-web.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * VERIFICACION DETERMINISTA de punta a punta dentro del handler de tarea web (D1/D2/D3/D5): el
 * objetivo del usuario, la foto del DOM y la politica entran; la accion se ejecuta o la tarea
 * TERMINA sin ejecutarla. Cero navegador, cero modelo, cero base: todo por fakes.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - coincidir ejecuta SIN preguntarle nada al usuario (el camino normal);
 *  - no coincidir, no poder leer el dato, o que la politica lo impida, NO ejecuta NUNCA;
 *  - una accion detenida deja el job en 'failed' (nunca pausado esperando aprobacion);
 *  - sin fila de politica se usan los defaults y NO se crea la fila.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(objetivo: string): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    finishedAt: null,
  };
}

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: 'correo.ejemplo.com',
    urlLogin: 'https://correo.ejemplo.com/login',
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    proxyCountry: 'MX',
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

function makeRepo(sitio: SitioConectado): RepositorioSitiosParaTarea {
  return {
    obtenerPorId: vi.fn(async () => sitio),
    obtenerContextoDescifrado: vi.fn(async () => CONTEXTO_PLANO),
    guardarContexto: vi.fn(async () => sitio),
    actualizarEstado: vi.fn(async () => sitio),
  };
}

function makeNavegador(campos: CampoDeLaPagina[], texto = ''): NavegadorParaTarea {
  return {
    abrirSesionParaTarea: vi.fn(async () => ({
      sesionExternaId: 'ses-1',
      egressIp: '203.0.113.7',
      egressCountry: 'MX',
    })),
    inyectarContexto: vi.fn(async () => {}),
    detectarPantallaDeLogin: vi.fn(async () => false),
    extraerContexto: vi.fn(async () => CONTEXTO_PLANO),
    estadoDeSesion: vi.fn(async () => 'viva' as const),
    capturarPantalla: vi.fn(async () => 'cGxhY2Vob2xkZXI='),
    leerCamposDeLaPagina: vi.fn(async () => campos),
    leerTextoVisible: vi.fn(async () => texto),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
    cerrarSesion: vi.fn(async () => {}),
  };
}

/** Motor que reporta la accion pendiente en la primera corrida y la ejecuta en la segunda. */
function makeMotor(): MotorDeTareaWeb {
  let llamada = 0;
  return {
    ejecutar: vi.fn(async () => ({
      exito: llamada > 0,
      completado: true,
      mensaje:
        llamada++ === 0
          ? `${MARCADOR_REQUIERE_APROBACION}: irreversible: la accion quedo lista`
          : 'accion ejecutada',
      acciones: [],
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: makeRepo(makeSitio()),
    navegador: makeNavegador([]),
    motor: makeMotor(),
    aprobaciones: makeAprobacionesRepo(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
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

/** Corre la tarea y devuelve la detencion interpretada, o null si no se detuvo. */
async function detencionDe(deps: TareaWebDeps, job: Job) {
  try {
    await procesarTareaWeb(deps, job);
    return null;
  } catch (error) {
    return parsearDetencion(error instanceof Error ? `${error.name}: ${error.message}` : null);
  }
}

describe('objetivo con destinatario declarado', () => {
  const OBJETIVO = 'envia el resumen mensual a juan@ejemplo.com';

  it('DOM COINCIDENTE: ejecuta sin detenerse y sin preguntar nada (test 2)', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);
    const deps = makeDeps({ navegador });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(2);
    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.marcarJobPausado).not.toHaveBeenCalled();
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'ok' }),
    );
  });

  it('DOM DISTINTO: NO ejecuta y reporta ambos valores (test 3)', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'otro@atacante.com' }]);
    const deps = makeDeps({ navegador });
    const detencion = await detencionDe(deps, makeJob(OBJETIVO));
    expect(detencion).toMatchObject({
      motivo: 'noCoincide',
      pedido: 'juan@ejemplo.com',
      encontrado: 'otro@atacante.com',
    });
    // La accion NUNCA se ejecuto: el motor corrio solo la corrida que reporto.
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
    // El job termina failed (lo cierra execution.ts con el error), NO queda pausado.
    expect(deps.marcarJobPausado).not.toHaveBeenCalled();
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
  });
});

describe('objetivo sin el dato que la accion exige', () => {
  it('accion de envio sin destinatario declarado: NO ejecuta (test 4)', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'quien@sea.com' }]);
    const deps = makeDeps({ navegador });
    const detencion = await detencionDe(deps, makeJob('envia el correo de bienvenida al cliente nuevo'));
    expect(detencion).toMatchObject({ motivo: 'faltaDato', campo: 'destinatario' });
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe('politica de ejecucion del usuario', () => {
  const OBJETIVO = 'paga $9,900 MXN de la factura de agosto';

  function politicasQueDevuelven(
    politica: Awaited<ReturnType<RepositorioPoliticasParaWorker['obtenerPorOwner']>>,
  ): RepositorioPoliticasParaWorker {
    return { obtenerPorOwner: vi.fn(async () => politica) };
  }

  it('monto sobre el tope configurado: NO ejecuta (test 5)', async () => {
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input total a pagar', valor: '9900' }]),
      politicas: politicasQueDevuelven({
        ejecutarAccionesIrreversibles: true,
        topeMontoSinConfirmacion: 5000,
        sitiosExcluidos: [],
      }),
    });
    const detencion = await detencionDe(deps, makeJob(OBJETIVO));
    expect(detencion?.motivo).toBe('topeExcedido');
    expect(detencion?.monto).toContain('9900');
    expect(detencion?.tope).toContain('5000');
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('dominio en sitios_excluidos: NO ejecuta (test 6)', async () => {
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input total a pagar', valor: '9900' }]),
      politicas: politicasQueDevuelven({
        ejecutarAccionesIrreversibles: true,
        topeMontoSinConfirmacion: 100_000,
        sitiosExcluidos: ['ejemplo.com'],
      }),
    });
    const detencion = await detencionDe(deps, makeJob(OBJETIVO));
    expect(detencion).toMatchObject({ motivo: 'sitioExcluido', dominio: 'ejemplo.com' });
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('acciones irreversibles desactivadas: NO ejecuta', async () => {
    const deps = makeDeps({
      politicas: politicasQueDevuelven({
        ejecutarAccionesIrreversibles: false,
        topeMontoSinConfirmacion: 100_000,
        sitiosExcluidos: [],
      }),
    });
    const detencion = await detencionDe(deps, makeJob('borra el archivo viejo del panel'));
    expect(detencion?.motivo).toBe('accionesDesactivadas');
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('SIN fila de politica: se usan los defaults y NO se crea la fila (test 7)', async () => {
    const obtenerPorOwner = vi.fn(async () => null);
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
      politicas: { obtenerPorOwner },
    });
    // Default: ejecutar acciones irreversibles = true. Sin monto en juego, la accion se ejecuta.
    await expect(
      procesarTareaWeb(deps, makeJob('envia el resumen a juan@ejemplo.com')),
    ).resolves.toBe('completada');
    expect(obtenerPorOwner).toHaveBeenCalledWith('user-1');
    // El repositorio del worker SOLO sabe leer: no existe metodo para crear la fila al pasar por aqui.
    expect(Object.keys(deps.politicas ?? {})).toEqual(['obtenerPorOwner']);
  });

  it('con el tope por defecto (0), una accion con monto NO se ejecuta', async () => {
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input total a pagar', valor: '9900' }]),
      politicas: { obtenerPorOwner: vi.fn(async () => null) },
    });
    const detencion = await detencionDe(deps, makeJob(OBJETIVO));
    expect(detencion?.motivo).toBe('topeExcedido');
  });

  it('si la politica NO se puede leer, la accion se DETIENE (falla cerrada)', async () => {
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
      politicas: {
        obtenerPorOwner: vi.fn(async () => {
          throw new Error('db caida');
        }),
      },
    });
    const detencion = await detencionDe(deps, makeJob('envia el resumen a juan@ejemplo.com'));
    expect(detencion?.motivo).toBe('politicaNoDisponible');
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('sin repositorio cableado (deploy sin V034): defaults, la tarea corre igual', async () => {
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
    });
    await expect(
      procesarTareaWeb(deps, makeJob('envia el resumen a juan@ejemplo.com')),
    ).resolves.toBe('completada');
  });
});

describe('lectura del DOM', () => {
  it('si no se puede leer la pagina, NO se ejecuta a ciegas', async () => {
    const navegador = makeNavegador([]);
    navegador.leerCamposDeLaPagina = vi.fn(async () => {
      throw new Error('sesion caida');
    });
    const deps = makeDeps({ navegador });
    const detencion = await detencionDe(deps, makeJob('envia el resumen a juan@ejemplo.com'));
    expect(detencion?.motivo).toBe('noCoincide');
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('tarea TERMINADA por el usuario: no se verifica ni se ejecuta nada', async () => {
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      procesarTareaWeb(deps, makeJob('envia el resumen a juan@ejemplo.com'), {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/se termino desde la consola/);
    // Ni la lectura de la pagina ni la corrida que ejecuta llegan a ocurrir.
    expect(deps.navegador.leerCamposDeLaPagina).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('una SEGUNDA accion irreversible tras la verificada no encadena otra verificacion', async () => {
    // El motor reporta una accion pendiente en las DOS corridas: la segunda no se verifica ni se
    // ejecuta (seria un bucle sin cota sobre la cuenta real del usuario).
    const motor: MotorDeTareaWeb = {
      ejecutar: vi.fn(async () => ({
        exito: false,
        completado: true,
        mensaje: `${MARCADOR_REQUIERE_APROBACION}: irreversible: otra accion mas`,
        acciones: [],
        tokensIn: null,
        tokensOut: null,
      })),
    };
    const deps = makeDeps({
      motor,
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
    });
    const detencion = await detencionDe(deps, makeJob('envia el resumen a juan@ejemplo.com'));
    expect(detencion?.motivo).toBe('otraAccion');
    expect(motor.ejecutar).toHaveBeenCalledTimes(2);
  });
});
