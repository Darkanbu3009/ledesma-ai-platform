import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import { parsearDetencion } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  GuardiaDeAccion,
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import { AccionBloqueadaError } from '../src/errores.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * VERIFICACION DETERMINISTA de punta a punta dentro del handler de tarea web (D1/D2/D3/D5): el
 * objetivo del usuario, la foto del DOM y la politica entran; la accion se ejecuta o la tarea
 * TERMINA sin ejecutarla. Cero navegador, cero modelo, cero base: todo por fakes.
 *
 * Estos tests corren contra la GUARDIA: el motor fake propone sus acciones igual que el real (le
 * pregunta al worker ANTES de cada una) y solo llegan al navegador las que la guardia deja pasar. Ya
 * no hay una segunda corrida del motor: la accion se ejecuta dentro de la misma.
 *
 * Lo que fijan y no debe poder cambiar en silencio:
 *  - coincidir EJECUTA la accion, sin preguntarle nada al usuario (el camino normal);
 *  - no coincidir, no poder leer el dato, o que la politica lo impida, NO ejecuta NUNCA;
 *  - una accion detenida deja el job en 'failed' (nunca pausado esperando aprobacion);
 *  - sin fila de politica se usan los defaults y NO se crea la fila;
 *  - un agente que termina con DONE sin ejecutar la accion tiene su propio fallo, distinto del resto.
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

/** Acciones que el motor fake propone por defecto: preparar la pagina y despues la accion final. */
const ACCIONES_HASTA_ENVIAR = ['escribe el destinatario', 'haz clic en el boton Enviar'];

/**
 * Motor FAKE que se comporta como el real: le pregunta a la GUARDIA por cada accion ANTES de
 * ejecutarla y, si la bloquea, lanza AccionBloqueadaError (lo mismo que hace el adaptador de
 * Stagehand cuando la tool `act` se corta). `ejecutadas` deja ver que llego de verdad al navegador.
 */
function makeMotor(
  acciones: string[] = ACCIONES_HASTA_ENVIAR,
  mensajeFinal = 'accion ejecutada',
): MotorDeTareaWeb & { ejecutadas: string[] } {
  const ejecutadas: string[] = [];
  return {
    ejecutadas,
    ejecutar: vi.fn(async (params: { guardia?: GuardiaDeAccion | undefined }) => {
      for (const accion of acciones) {
        const veredicto = await params.guardia?.revisar(accion);
        if (veredicto?.tipo === 'bloquear') {
          throw new AccionBloqueadaError(veredicto.mensaje);
        }
        ejecutadas.push(accion);
      }
      return {
        exito: true,
        completado: true,
        mensaje: mensajeFinal,
        acciones: ejecutadas.map((accion) => ({ type: 'act', action: accion, success: true })),
        tokensIn: null,
        tokensOut: null,
      };
    }),
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

  it('DOM COINCIDENTE: la accion final LLEGA al navegador, sin preguntar nada (test 2)', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);
    const motor = makeMotor();
    const deps = makeDeps({ navegador, motor });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    // UNA sola corrida del motor: el agente completa el objetivo entero, clic de Enviar incluido.
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.marcarJobPausado).not.toHaveBeenCalled();
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'ok' }),
    );
  });

  it('la verificacion corre JUSTO ANTES de la accion, no antes de preparar la pagina', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);
    const motor = makeMotor();
    const deps = makeDeps({ navegador, motor });
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    // El DOM se lee UNA vez: solo la accion final ("Enviar") dispara la comparacion; escribir el
    // destinatario es un paso intermedio y pasa sin leer nada.
    expect(navegador.leerCamposDeLaPagina).toHaveBeenCalledTimes(1);
  });

  it('DOM DISTINTO: la accion NO llega al navegador y se reportan ambos valores (test 3)', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'otro@atacante.com' }]);
    const motor = makeMotor();
    const deps = makeDeps({ navegador, motor });
    const detencion = await detencionDe(deps, makeJob(OBJETIVO));
    expect(detencion).toMatchObject({
      motivo: 'noCoincide',
      pedido: 'juan@ejemplo.com',
      encontrado: 'otro@atacante.com',
    });
    // Los pasos previos si corrieron; la accion final NO.
    expect(motor.ejecutadas).toEqual(['escribe el destinatario']);
    // El job termina failed (lo cierra execution.ts con el error), NO queda pausado.
    expect(deps.marcarJobPausado).not.toHaveBeenCalled();
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
  });

  it('bloqueada la accion, el agente NO puede intentar una ruta alternativa: la corrida se corta', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'otro@atacante.com' }]);
    // El motor fake intenta DOS rutas hacia la misma accion. La primera lo corta en seco.
    const motor = makeMotor([
      'haz clic en el boton Enviar',
      'pulsa el atajo para enviar el mensaje',
    ]);
    const deps = makeDeps({ navegador, motor });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).rejects.toThrow(/DETENIDA_VERIFICACION/);
    expect(motor.ejecutadas).toEqual([]);
    // Y la pagina solo se leyo una vez: no hubo una segunda comparacion que pudiera salir distinta.
    expect(navegador.leerCamposDeLaPagina).toHaveBeenCalledTimes(1);
  });
});

describe('objetivo sin el dato que la accion exige', () => {
  it('accion de envio sin destinatario declarado: NO ejecuta (test 4)', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'quien@sea.com' }]);
    const motor = makeMotor();
    const deps = makeDeps({ navegador, motor });
    const detencion = await detencionDe(deps, makeJob('envia el correo de bienvenida al cliente nuevo'));
    expect(detencion).toMatchObject({ motivo: 'faltaDato', campo: 'destinatario' });
    expect(motor.ejecutadas).toEqual(['escribe el destinatario']);
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
    const motor = makeMotor(['haz clic en pagar ahora']);
    const deps = makeDeps({
      motor,
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
    expect(motor.ejecutadas).toEqual([]);
  });

  it('dominio en sitios_excluidos: NO ejecuta (test 6)', async () => {
    const motor = makeMotor(['haz clic en pagar ahora']);
    const deps = makeDeps({
      motor,
      navegador: makeNavegador([{ contexto: 'input total a pagar', valor: '9900' }]),
      politicas: politicasQueDevuelven({
        ejecutarAccionesIrreversibles: true,
        topeMontoSinConfirmacion: 100_000,
        sitiosExcluidos: ['ejemplo.com'],
      }),
    });
    const detencion = await detencionDe(deps, makeJob(OBJETIVO));
    expect(detencion).toMatchObject({ motivo: 'sitioExcluido', dominio: 'ejemplo.com' });
    expect(motor.ejecutadas).toEqual([]);
  });

  it('acciones irreversibles desactivadas: NO ejecuta', async () => {
    const motor = makeMotor(['borra el archivo']);
    const deps = makeDeps({
      motor,
      politicas: politicasQueDevuelven({
        ejecutarAccionesIrreversibles: false,
        topeMontoSinConfirmacion: 100_000,
        sitiosExcluidos: [],
      }),
    });
    const detencion = await detencionDe(deps, makeJob('borra el archivo viejo del panel'));
    expect(detencion?.motivo).toBe('accionesDesactivadas');
    expect(motor.ejecutadas).toEqual([]);
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
    const motor = makeMotor();
    const deps = makeDeps({
      motor,
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
      politicas: {
        obtenerPorOwner: vi.fn(async () => {
          throw new Error('db caida');
        }),
      },
    });
    const detencion = await detencionDe(deps, makeJob('envia el resumen a juan@ejemplo.com'));
    expect(detencion?.motivo).toBe('politicaNoDisponible');
    expect(motor.ejecutadas).toEqual(['escribe el destinatario']);
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
    const motor = makeMotor();
    const deps = makeDeps({ navegador, motor });
    const detencion = await detencionDe(deps, makeJob('envia el resumen a juan@ejemplo.com'));
    expect(detencion?.motivo).toBe('noCoincide');
    expect(motor.ejecutadas).toEqual(['escribe el destinatario']);
  });

  it('tarea TERMINADA por el usuario: no se verifica ni se ejecuta nada', async () => {
    const motor = makeMotor();
    const deps = makeDeps({
      motor,
      navegador: makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      procesarTareaWeb(deps, makeJob('envia el resumen a juan@ejemplo.com'), {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/se termino desde la consola/);
    // Ni se lee la pagina ni llega ninguna accion al navegador.
    expect(deps.navegador.leerCamposDeLaPagina).not.toHaveBeenCalled();
    expect(motor.ejecutadas).toEqual([]);
  });

  it('una SEGUNDA accion irreversible en la misma corrida no encadena otra verificacion', async () => {
    // La primera se verifica y se ejecuta; la segunda se bloquea sin volver a comparar (seria un
    // bucle sin cota sobre la cuenta real del usuario, y es lo que impide enviar dos veces).
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);
    const motor = makeMotor(['haz clic en Enviar', 'haz clic en Enviar otra vez']);
    const deps = makeDeps({ motor, navegador });
    const detencion = await detencionDe(deps, makeJob('envia el resumen a juan@ejemplo.com'));
    expect(detencion?.motivo).toBe('otraAccion');
    expect(motor.ejecutadas).toEqual(['haz clic en Enviar']);
    expect(navegador.leerCamposDeLaPagina).toHaveBeenCalledTimes(1);
  });
});

describe('DONE prematuro: el agente se detuvo por su cuenta (CAMBIO 3)', () => {
  const OBJETIVO = 'envia el resumen mensual a juan@ejemplo.com';

  it('objetivo con accion bloqueada y ninguna accion verificada: fallo con mensaje PROPIO', async () => {
    // El agente prepara la pagina entera y cierra con DONE sin intentar la accion final: es
    // exactamente el job de produccion que dejo un borrador. Ni se ejecuto, ni la detuvo el sistema.
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);
    const motor = makeMotor(
      ['escribe el destinatario', 'escribe el asunto'],
      'Deje el correo listo en un borrador, no lo envie',
    );
    const deps = makeDeps({ motor, navegador });
    let error: unknown;
    try {
      await procesarTareaWeb(deps, makeJob(OBJETIVO));
    } catch (e) {
      error = e;
    }
    const mensaje = String(error);
    expect(mensaje).toContain('nunca llego a la verificacion previa');
    expect(mensaje).toContain('"enviar"');
    // Distinto del fallo generico del motor y distinto de una detencion del sistema.
    expect(mensaje).not.toContain('termino con DONE sin cumplir el objetivo');
    expect(mensaje).not.toContain('DETENIDA_VERIFICACION');
    // El mensaje final del agente viaja como diagnostico: es la pista de que se paro solo.
    expect(mensaje).toContain('no lo envie');
    expect(deps.guardarResultado).not.toHaveBeenCalled();
  });

  it('sin verbo bloqueado en el objetivo, terminar sin acciones NO es este fallo', async () => {
    const motor = makeMotor(['lee el panel'], 'el panel muestra 3 agentes');
    const deps = makeDeps({ motor });
    await expect(procesarTareaWeb(deps, makeJob('dime que dice mi panel'))).resolves.toBe(
      'completada',
    );
  });

  it('si el agente ejecuto la accion verificada, NO se reporta como DONE prematuro', async () => {
    const navegador = makeNavegador([{ contexto: 'input email para', valor: 'juan@ejemplo.com' }]);
    const motor = makeMotor();
    const deps = makeDeps({ motor, navegador });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
  });
});
