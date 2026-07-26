import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import { parsearPasosDeReceta } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioRecetasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type {
  EscaladorDePaso,
  InstruccionDePaso,
  NavegadorDeterminista,
} from '../src/ejecutor-receta.js';
import { promoverGrabacion } from '../src/grabacion.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * UNA RECETA DE ORIGEN MANUAL NO SALTA NINGUNA PROTECCION. Estos tests toman los pasos que produce
 * `promoverGrabacion` (los mismos que se guardarian en recetas_web) y los ejecutan por el camino
 * determinista REAL del handler de tarea web, para comprobar que:
 *
 *  1. la verificacion determinista de parametros corre igual, y si lo que hay en la pagina no
 *     coincide con lo que el usuario pidio, la tarea SE DETIENE sin ejecutar la accion;
 *  2. la politica del usuario se aplica igual (un dominio excluido detiene la tarea);
 *  3. el valor que se teclea sale del objetivo de ESTA corrida, no del que el usuario grabo.
 *
 * Que el usuario haya grabado los pasos no autoriza a ejecutar con datos que no coinciden con lo
 * pedido: la unica diferencia entre una receta grabada y una aprendida sola es la columna `origen`.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';

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
    payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo, textoUsuario: objetivo },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    startedAt: '2026-07-24T00:00:00.000Z',
    finishedAt: null,
  };
}

function makeSitio(): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: DOMINIO,
    urlLogin: `https://${DOMINIO}/login`,
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
  };
}

function makeRepo(): RepositorioSitiosParaTarea {
  const sitio = makeSitio();
  return {
    obtenerPorId: vi.fn(async () => sitio),
    obtenerContextoDescifrado: vi.fn(async () => CONTEXTO_PLANO),
    guardarContexto: vi.fn(async () => sitio),
    actualizarEstado: vi.fn(async () => sitio),
  };
}

function makeNavegador(campos: CampoDeLaPagina[]): NavegadorParaTarea {
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
    leerTextoVisible: vi.fn(async () => ''),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
    cerrarSesion: vi.fn(async () => {}),
  };
}

function makeDeterminista(): NavegadorDeterminista & {
  ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
} {
  return {
    ejecutarPasoDeterminista: vi.fn(async () => ({
      estado: 'ok' as const,
      estrategias: [],
      detalle: null,
    })),
    leerEstrategiasDeElemento: vi.fn(async () => []),
  };
}

function makeEscalador(): EscaladorDePaso {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: null,
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeMotor(): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(async () => ({
      exito: true,
      completado: true,
      mensaje: 'listo',
      acciones: [],
      tokensIn: null,
      tokensOut: null,
    })),
  } as unknown as MotorDeTareaWeb;
}

function makePoliticas(sitiosExcluidos: string[] = []): RepositorioPoliticasParaWorker {
  return {
    obtenerPorOwner: vi.fn(async () => ({
      ejecutarAccionesIrreversibles: true,
      topeMontoSinConfirmacion: 5000,
      sitiosExcluidos,
    })),
  };
}

/**
 * La RECETA GRABADA de "enviar un correo": exactamente lo que produce la promocion de una grabacion en
 * la que el usuario marco el destinatario como dato que cambia cada vez.
 */
function makeRecetaGrabada(): RecetaWeb {
  const promocion = promoverGrabacion({
    pasos: [
      { idx: 0, accion: 'navegar', estrategias: [], valor: null, teclas: null, ruta: '/redactar' },
      {
        idx: 1,
        accion: 'escribir',
        estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
        valor: 'ana@ejemplo.com',
        teclas: null,
        ruta: null,
      },
      {
        idx: 2,
        accion: 'click',
        estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
        valor: null,
        teclas: null,
        ruta: null,
      },
    ],
    descripcion: 'enviar un correo a ana@ejemplo.com',
    variables: [{ idx: 1, marcador: 'destinatario' }],
  });
  if (!promocion.promovida) throw new Error('el fixture de grabacion no se promovio');
  // Se re-valida contra el contrato compartido, igual que haria el repositorio al leerla de la base.
  const validados = parsearPasosDeReceta(promocion.pasos);
  if (validados === null) throw new Error('los pasos de la grabacion no validan contra el contrato');
  return {
    id: 'rec-grabada-1',
    ownerId: 'user-1',
    dominio: DOMINIO,
    firmaObjetivo: 'x',
    version: 1,
    estado: 'activa',
    origen: 'grabacion',
    pasos: validados,
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 0,
    ejecucionesFallidas: 0,
    ultimaEjecucionEn: null,
    creadaEn: '2026-07-24T00:00:00.000Z',
    actualizadaEn: '2026-07-24T00:00:00.000Z',
  };
}

function makeRecetas(activa: RecetaWeb): RepositorioRecetasParaWorker {
  return {
    buscarActiva: vi.fn(async () => activa),
    promover: vi.fn(async () => null),
    marcarObsoleta: vi.fn(async () => {}),
    reemplazarPasos: vi.fn(async () => {}),
    registrarEjecucion: vi.fn(async () => {}),
  };
}

function makeDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: makeRepo(),
    navegador: makeNavegador([]),
    motor: makeMotor(),
    aprobaciones: makeAprobacionesRepo(),
    politicas: makePoliticas(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    recetas: makeRecetas(makeRecetaGrabada()),
    determinista: makeDeterminista(),
    escalador: makeEscalador(),
    vaultSecret: 'a'.repeat(64),
    model: 'anthropic/claude-opus-4-5',
    maxPasos: 40,
    historialPasos: 8,
    modoScreenshots: 'cambios',
    runTimeoutMs: 60_000,
    resolveCredential: vi.fn(async () => ({
      providerId: 'anthropic' as const,
      apiKey: 'sk-owner',
      credentialId: 'cred-1',
    })),
    guardarResultado: vi.fn(async () => {}),
    esperar: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  } as unknown as TareaWebDeps;
}

const OBJETIVO = 'envia un correo a martin@otro.com';

describe('una receta de origen manual se ejecuta APLICANDO la verificacion de parametros', () => {
  it('si la pagina NO muestra el destinatario pedido, la tarea se DETIENE sin ejecutar la accion', async () => {
    // La pagina quedo con OTRO destinatario (el que se grabo aquel dia), no con el de esta corrida.
    const navegador = makeNavegador([{ contexto: 'input text to Para', valor: 'ana@ejemplo.com' }]);
    const determinista = makeDeterminista();
    const deps = makeDeps({ navegador, determinista });

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).rejects.toThrow();

    // La verificacion corrio (leyo los campos de la pagina) y el clic final NUNCA se ejecuto: los
    // pasos deterministas que llegaron al navegador son los previos al punto de verificacion.
    expect(navegador.leerCamposDeLaPagina).toHaveBeenCalled();
    const acciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (c) => (c[1] as InstruccionDePaso).accion,
    );
    expect(acciones).toEqual(['navegar', 'escribir']);
  });

  it('si la pagina SI coincide con lo pedido, la tarea se completa con lo aprendido', async () => {
    const navegador = makeNavegador([{ contexto: 'input text to Para', valor: 'martin@otro.com' }]);
    const determinista = makeDeterminista();
    const deps = makeDeps({ navegador, determinista });

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');

    const acciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (c) => (c[1] as InstruccionDePaso).accion,
    );
    expect(acciones).toEqual(['navegar', 'escribir', 'click']);
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ via: 'receta' }));
  });

  it('el valor tecleado sale del objetivo de ESTA corrida, no del que se grabo', async () => {
    const navegador = makeNavegador([{ contexto: 'input text to Para', valor: 'martin@otro.com' }]);
    const determinista = makeDeterminista();
    await procesarTareaWeb(makeDeps({ navegador, determinista }), makeJob(OBJETIVO));

    const escritura = determinista.ejecutarPasoDeterminista.mock.calls
      .map((c) => c[1] as InstruccionDePaso)
      .find((i) => i.accion === 'escribir');
    expect(escritura?.texto).toBe('martin@otro.com');
    // El dato de la grabacion no existe en ninguna instruccion: la receta guardo el marcador.
    const todo = JSON.stringify(determinista.ejecutarPasoDeterminista.mock.calls);
    expect(todo).not.toContain('ana@ejemplo.com');
  });

  it('la politica del usuario se aplica igual: un dominio excluido detiene la tarea', async () => {
    const navegador = makeNavegador([{ contexto: 'input text to Para', valor: 'martin@otro.com' }]);
    const determinista = makeDeterminista();
    const deps = makeDeps({
      navegador,
      determinista,
      politicas: makePoliticas([DOMINIO]),
    });

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).rejects.toThrow();
    const acciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (c) => (c[1] as InstruccionDePaso).accion,
    );
    expect(acciones).not.toContain('click');
  });

  it('una receta grabada a la que le QUITARAN el punto de verificacion no se usa', async () => {
    const receta = makeRecetaGrabada();
    const sinVerificar = {
      ...receta,
      pasos: receta.pasos.filter((p) => p.accion !== 'verificar').map((p, idx) => ({ ...p, idx })),
    };
    const determinista = makeDeterminista();
    const motor = makeMotor();
    const deps = makeDeps({
      navegador: makeNavegador([{ contexto: 'input text to Para', valor: 'martin@otro.com' }]),
      determinista,
      motor,
      recetas: makeRecetas(sinVerificar),
    });

    // No se ejecuta ni un paso por receta: la tarea cae al camino normal, que si verifica.
    await procesarTareaWeb(deps, makeJob(OBJETIVO)).catch(() => undefined);
    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(motor.ejecutar).toHaveBeenCalled();
  });
});
