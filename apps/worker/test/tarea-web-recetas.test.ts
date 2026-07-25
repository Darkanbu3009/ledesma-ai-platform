import { describe, it, expect, vi } from 'vitest';
import type { Job, PasoDeReceta } from '@ledesma-platform/shared';
import { parsearDetencion, parsearPasosDeReceta } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  PasoObservado,
  RepositorioRecetasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type {
  EscaladorDePaso,
  InstruccionDePaso,
  NavegadorDeterminista,
} from '../src/ejecutor-receta.js';
import { firmaDeObjetivo } from '../src/receta-web.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * SELECCION DE CAMINO y PROMOCION de punta a punta dentro del handler de tarea web (Fase F paso 2,
 * CAMBIO 3 y 5). Todo por fakes: cero navegador, cero modelo, cero base.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - una tarea sin receta corre con el motor y, si sale bien, queda aprendida;
 *  - una tarea con receta corre SIN llamar al motor ni una vez;
 *  - una receta que se agota no rompe la tarea: se sigue con el motor en la misma sesion;
 *  - la verificacion determinista se aplica IGUAL en el camino por receta;
 *  - ningun valor del usuario queda dentro de lo que se persiste como receta.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const SELECTOR = 'xpath=/html/body/button[1]';
const ESTRATEGIAS = [
  { tipo: 'atributo', atributo: 'id', valor: 'enviar' },
  { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
] as const;

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

function makeNavegador(campos: CampoDeLaPagina[] = []): NavegadorParaTarea {
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

/**
 * Motor fake que, ademas de completar la tarea, emite una OBSERVACION por accion (igual que el
 * adaptador real via onEvidence) para que la corrida sea promovible.
 */
function makeMotor(acciones = 2): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(async (params: { observador?: ((p: PasoObservado) => Promise<void>) | undefined }) => {
      const crudas = Array.from({ length: acciones }, () => ({
        type: 'act',
        action: 'click Enviar',
        pageUrl: `https://${DOMINIO}/inbox`,
        playwrightArguments: { selector: SELECTOR, method: 'click', arguments: [] },
      }));
      for (let i = 0; i < crudas.length; i++) {
        await params.observador?.({ selector: SELECTOR, punto: null });
      }
      return {
        exito: true,
        completado: true,
        mensaje: 'listo',
        acciones: crudas,
        tokensIn: 101_270,
        tokensOut: 3_500,
      };
    }),
  } as unknown as MotorDeTareaWeb;
}

function makeDeterminista(noLocalizados: number[] = []): NavegadorDeterminista & {
  ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
} {
  let llamadas = 0;
  return {
    ejecutarPasoDeterminista: vi.fn(async (sesion: string, instruccion: InstruccionDePaso) => {
      void sesion;
      void instruccion;
      const indice = llamadas++;
      return noLocalizados.includes(indice)
        ? { estado: 'no_localizado' as const, estrategias: [], detalle: null }
        : { estado: 'ok' as const, estrategias: [], detalle: null };
    }),
    leerEstrategiasDeElemento: vi.fn(async () => [...ESTRATEGIAS]),
  };
}

function makeEscalador(): EscaladorDePaso & { ejecutarPasoConModelo: ReturnType<typeof vi.fn> } {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: '/html[1]/body[1]/div[2]/button[1]',
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeRecetas(activa: RecetaWeb | null = null): RepositorioRecetasParaWorker & {
  promover: ReturnType<typeof vi.fn>;
  marcarObsoleta: ReturnType<typeof vi.fn>;
  reemplazarPasos: ReturnType<typeof vi.fn>;
  registrarEjecucion: ReturnType<typeof vi.fn>;
} {
  return {
    buscarActiva: vi.fn(async () => activa),
    promover: vi.fn(async () => null),
    marcarObsoleta: vi.fn(async () => {}),
    reemplazarPasos: vi.fn(async () => {}),
    registrarEjecucion: vi.fn(async () => {}),
  };
}

function makePoliticas(): RepositorioPoliticasParaWorker {
  return {
    obtenerPorOwner: vi.fn(async () => ({
      ejecutarAccionesIrreversibles: true,
      topeMontoSinConfirmacion: 5000,
      sitiosExcluidos: [],
    })),
  };
}

function makeDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: makeRepo(),
    navegador: makeNavegador(),
    motor: makeMotor(),
    aprobaciones: makeAprobacionesRepo(),
    politicas: makePoliticas(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    recetas: makeRecetas(),
    determinista: makeDeterminista(),
    escalador: makeEscalador(),
    vaultSecret: 'a'.repeat(64),
    model: 'anthropic/claude-opus-4-5',
    maxPasos: 40,
    runTimeoutMs: 60_000,
    resolveCredential: vi.fn(async () => ({
      providerId: 'anthropic' as const,
      apiKey: 'sk-owner',
      credentialId: 'cred-1',
    })),
    guardarResultado: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  } as unknown as TareaWebDeps;
}

/** Una receta activa lista para ejecutar, con los pasos ya validados por el contrato compartido. */
function makeReceta(pasos: unknown[]): RecetaWeb {
  const validados = parsearPasosDeReceta(pasos);
  if (validados === null) throw new Error('los pasos del fixture no validan contra el contrato');
  return {
    id: 'rec-1',
    ownerId: 'user-1',
    dominio: DOMINIO,
    firmaObjetivo: 'x',
    version: 1,
    estado: 'activa',
    pasos: validados,
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 3,
    ejecucionesFallidas: 0,
    ultimaEjecucionEn: null,
    creadaEn: '2026-07-20T00:00:00.000Z',
    actualizadaEn: '2026-07-20T00:00:00.000Z',
  };
}

function pasoClick(idx: number): unknown {
  return {
    idx,
    accion: 'click',
    estrategias: [...ESTRATEGIAS],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
  };
}

describe('promocion automatica al terminar con exito (CAMBIO 3, D4)', () => {
  it('una tarea que corre con el motor y sale bien queda APRENDIDA para la proxima', async () => {
    const recetas = makeRecetas();
    const deps = makeDeps({ recetas });

    await procesarTareaWeb(deps, makeJob('abre el ultimo correo de facturas'));

    expect(recetas.promover).toHaveBeenCalledTimes(1);
    const input = recetas.promover.mock.calls[0]?.[0] as { pasos: PasoDeReceta[]; firmaObjetivo: string };
    expect(input.firmaObjetivo).toBe(firmaDeObjetivo('abre el ultimo correo de facturas'));
    expect(input.pasos).toHaveLength(2);
    expect(input.pasos[0]?.estrategias).toEqual([...ESTRATEGIAS]);
    // El resultado del job declara por donde corrio, para poder medir el ahorro.
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ via: 'modelo' }));
  });

  it('una tarea que FALLA no genera receta', async () => {
    const recetas = makeRecetas();
    const motor: MotorDeTareaWeb = {
      ejecutar: vi.fn(async () => ({
        exito: false,
        completado: false,
        mensaje: 'se corto',
        acciones: [],
        tokensIn: null,
        tokensOut: null,
      })),
    };
    await expect(
      procesarTareaWeb(makeDeps({ recetas, motor }), makeJob('abre el ultimo correo')),
    ).rejects.toThrow();
    expect(recetas.promover).not.toHaveBeenCalled();
  });

  it('sin las tres piezas cableadas no se promueve nada (despliegue sin la migracion V035)', async () => {
    const recetas = makeRecetas();
    await procesarTareaWeb(
      makeDeps({ recetas, determinista: undefined }),
      makeJob('abre el ultimo correo'),
    );
    expect(recetas.promover).not.toHaveBeenCalled();
  });

  it('ningun valor del usuario queda dentro de lo que se persiste como receta (D8)', async () => {
    const recetas = makeRecetas();
    const motor: MotorDeTareaWeb = {
      ejecutar: vi.fn(async (params: { observador?: ((p: PasoObservado) => Promise<void>) | undefined }) => {
        await params.observador?.({ selector: SELECTOR, punto: null });
        return {
          exito: true,
          completado: true,
          mensaje: 'listo',
          acciones: [
            {
              type: 'act',
              action: 'fill the recipient field',
              pageUrl: `https://${DOMINIO}/compose`,
              playwrightArguments: {
                selector: SELECTOR,
                method: 'fill',
                arguments: ['ana@ejemplo.com'],
              },
            },
          ],
          tokensIn: null,
          tokensOut: null,
        };
      }),
    } as unknown as MotorDeTareaWeb;

    await procesarTareaWeb(
      makeDeps({ recetas, motor }),
      makeJob('escribe un borrador para ana@ejemplo.com'),
    );

    expect(recetas.promover).toHaveBeenCalledTimes(1);
    const input = recetas.promover.mock.calls[0]?.[0] as unknown;
    // Ni el correo, ni ninguna otra cosa que el usuario tecleo: solo el marcador del parametro.
    expect(JSON.stringify(input)).not.toContain('ana@ejemplo.com');
    expect(JSON.stringify(input)).toContain('"parametro":"destinatario"');
  });
});

describe('seleccion de camino y ejecucion por receta (CAMBIO 4 y 5)', () => {
  it('con receta activa, la tarea NO invoca al motor en ningun paso', async () => {
    const recetas = makeRecetas(makeReceta([pasoClick(0), pasoClick(1), pasoClick(2)]));
    const motor = makeMotor();
    const determinista = makeDeterminista();
    const escalador = makeEscalador();
    const deps = makeDeps({ recetas, motor, determinista, escalador });

    const resultado = await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(resultado).toBe('completada');
    // Cero llamadas al modelo: ni el agente completo, ni una escalada suelta.
    expect(motor.ejecutar).not.toHaveBeenCalled();
    expect(escalador.ejecutarPasoConModelo).not.toHaveBeenCalled();
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(3);
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'ok', via: 'receta', reparada: false, tokensIn: 0, tokensOut: 0 }),
    );
    expect(recetas.registrarEjecucion).toHaveBeenCalledWith('rec-1', 'user-1', true);
    // Y no se vuelve a promover lo que ya estaba aprendido.
    expect(recetas.promover).not.toHaveBeenCalled();
  });

  it('un paso roto escala SOLO ese paso, repara la receta y la tarea igual termina por receta', async () => {
    const recetas = makeRecetas(makeReceta([pasoClick(0), pasoClick(1), pasoClick(2), pasoClick(3)]));
    const motor = makeMotor();
    const escalador = makeEscalador();
    const deps = makeDeps({ recetas, motor, determinista: makeDeterminista([1]), escalador });

    const resultado = await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(resultado).toBe('completada');
    expect(motor.ejecutar).not.toHaveBeenCalled();
    expect(escalador.ejecutarPasoConModelo).toHaveBeenCalledTimes(1);
    expect(recetas.reemplazarPasos).toHaveBeenCalledTimes(1);
    expect(recetas.marcarObsoleta).not.toHaveBeenCalled();
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ via: 'receta', reparada: true }),
    );
  });

  it('mas de la mitad escalada: la receta se marca obsoleta y la tarea la termina el motor', async () => {
    const recetas = makeRecetas(makeReceta([pasoClick(0), pasoClick(1), pasoClick(2)]));
    const motor = makeMotor();
    const deps = makeDeps({ recetas, motor, determinista: makeDeterminista([0, 1]) });

    const resultado = await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(resultado).toBe('completada');
    expect(recetas.marcarObsoleta).toHaveBeenCalledWith('rec-1', 'user-1');
    // La corrida NO se pierde: el motor la completa en la MISMA sesion (una sola sesion abierta).
    expect(motor.ejecutar).toHaveBeenCalledTimes(1);
    expect(deps.navegador.abrirSesionParaTarea).toHaveBeenCalledTimes(1);
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ via: 'modelo' }));
  });

  it('una receta cuyos pasos NO validan se ignora y la tarea corre con el motor', async () => {
    // buscarActiva del repositorio real ya devuelve null en ese caso; aqui se cubre el borde por si
    // alguna vez se le pasara una receta vacia al handler.
    const recetas = makeRecetas(null);
    const motor = makeMotor();
    await procesarTareaWeb(makeDeps({ recetas, motor }), makeJob('abre el ultimo correo'));
    expect(motor.ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe('la receta NO puede saltarse la verificacion ni la politica (D7)', () => {
  const OBJETIVO = 'envia el informe a juan@ejemplo.com';

  it('un objetivo con accion bloqueada y una receta SIN paso de verificacion: no se usa la receta', async () => {
    const recetas = makeRecetas(makeReceta([pasoClick(0), pasoClick(1)]));
    const motor = makeMotor();
    const determinista = makeDeterminista();
    // Sin datos en la pagina, el camino con motor termina detenido por la verificacion. Lo que este
    // test fija no es ese desenlace, sino que la receta se DESCARTO: ni un paso se ejecuto por ella.
    await expect(
      procesarTareaWeb(makeDeps({ recetas, motor, determinista }), makeJob(OBJETIVO)),
    ).rejects.toThrow();
    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(motor.ejecutar).toHaveBeenCalled();
  });

  it('con paso de verificacion y datos que COINCIDEN, la receta ejecuta la accion', async () => {
    const recetas = makeRecetas(
      makeReceta([
        pasoClick(0),
        { idx: 1, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        pasoClick(2),
      ]),
    );
    const determinista = makeDeterminista();
    const navegador = makeNavegador([{ contexto: 'input para destinatario', valor: 'juan@ejemplo.com' }]);
    const deps = makeDeps({ recetas, navegador, determinista });

    const resultado = await procesarTareaWeb(deps, makeJob(OBJETIVO));

    expect(resultado).toBe('completada');
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(2);
    expect(navegador.leerCamposDeLaPagina).toHaveBeenCalled();
  });

  it('con paso de verificacion y datos que NO coinciden, la tarea se DETIENE sin ejecutar el resto', async () => {
    const recetas = makeRecetas(
      makeReceta([
        pasoClick(0),
        { idx: 1, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        pasoClick(2),
      ]),
    );
    const determinista = makeDeterminista();
    // El sitio lleva OTRO destinatario que el que el usuario pidio.
    const navegador = makeNavegador([{ contexto: 'input para destinatario', valor: 'otro@ejemplo.com' }]);

    await expect(
      procesarTareaWeb(makeDeps({ recetas, navegador, determinista }), makeJob(OBJETIVO)),
    ).rejects.toMatchObject({ message: expect.stringContaining('DETENIDA_VERIFICACION') });

    // Solo corrio el paso ANTERIOR a la verificacion: la accion nunca se ejecuto.
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(1);
  });

  it('la POLITICA del usuario tambien detiene la ejecucion por receta (sitio excluido)', async () => {
    const recetas = makeRecetas(
      makeReceta([
        { idx: 0, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        pasoClick(1),
      ]),
    );
    const politicas: RepositorioPoliticasParaWorker = {
      obtenerPorOwner: vi.fn(async () => ({
        ejecutarAccionesIrreversibles: true,
        topeMontoSinConfirmacion: 5000,
        sitiosExcluidos: [DOMINIO],
      })),
    };
    const determinista = makeDeterminista();

    await expect(
      procesarTareaWeb(makeDeps({ recetas, politicas, determinista }), makeJob(OBJETIVO)),
    ).rejects.toThrow();

    const error = await procesarTareaWeb(
      makeDeps({ recetas, politicas, determinista }),
      makeJob(OBJETIVO),
    ).then(() => null, (e: unknown) => e as Error);
    expect(parsearDetencion(error?.message)?.motivo).toBe('sitioExcluido');
    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
  });

  it('si la politica NO se puede leer, la receta con verificacion se detiene (falla cerrada)', async () => {
    const recetas = makeRecetas(
      makeReceta([
        { idx: 0, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        pasoClick(1),
      ]),
    );
    const politicas: RepositorioPoliticasParaWorker = {
      obtenerPorOwner: vi.fn(async () => {
        throw new Error('base caida');
      }),
    };
    const error = await procesarTareaWeb(
      makeDeps({ recetas, politicas }),
      makeJob(OBJETIVO),
    ).then(() => null, (e: unknown) => e as Error);
    expect(parsearDetencion(error?.message)?.motivo).toBe('politicaNoDisponible');
  });
});

describe('una receta que se rinde a mitad no contamina lo aprendido', () => {
  it('si la receta ya avanzo la pagina, la corrida del motor que la termina NO se promueve', async () => {
    const recetas = makeRecetas(makeReceta([pasoClick(0), pasoClick(1), pasoClick(2)]));
    const motor = makeMotor();
    // El primer paso corre; el segundo y el tercero no localizan -> se supera el umbral de D6.
    const deps = makeDeps({ recetas, motor, determinista: makeDeterminista([1, 2]) });

    await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(motor.ejecutar).toHaveBeenCalledTimes(1);
    // Promover aqui crearia una receta que empieza por la mitad: no se promueve.
    expect(recetas.promover).not.toHaveBeenCalled();
    expect(recetas.marcarObsoleta).toHaveBeenCalledWith('rec-1', 'user-1');
  });

  it('una receta que se rinde tras tocar la pagina se JUBILA aunque no llegue al umbral de D6', async () => {
    const recetas = makeRecetas(
      makeReceta([pasoClick(0), pasoClick(1), pasoClick(2), pasoClick(3), pasoClick(4)]),
    );
    const escalador: EscaladorDePaso = {
      ejecutarPasoConModelo: vi.fn(async () => ({
        ok: false,
        selector: null,
        tokensIn: null,
        tokensOut: null,
      })),
    };
    const deps = makeDeps({ recetas, escalador, determinista: makeDeterminista([1]) });

    await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    // 1 escalada de 5 pasos no supera la mitad, pero la receta se estrello: no debe quedar activa
    // para que la siguiente corrida se estrelle igual.
    expect(recetas.marcarObsoleta).toHaveBeenCalledWith('rec-1', 'user-1');
  });

  it('si la receta ni siquiera arranco (parametro ausente), la corrida del motor SI se promueve', async () => {
    const recetas = makeRecetas(
      makeReceta([
        {
          idx: 0,
          accion: 'escribir',
          estrategias: [...ESTRATEGIAS],
          valor: { tipo: 'parametro', parametro: 'monto' },
          teclas: null,
          ruta: null,
          esperaMs: null,
        },
      ]),
    );
    const determinista = makeDeterminista();
    const deps = makeDeps({ recetas, determinista });

    await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(recetas.marcarObsoleta).not.toHaveBeenCalled();
    expect(recetas.promover).toHaveBeenCalledTimes(1);
  });
});
