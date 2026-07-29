import { describe, it, expect, vi } from 'vitest';
import type { EstrategiaLocalizacion, Job } from '@ledesma-platform/shared';
import { parsearPasosDeReceta } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  PasoObservado,
  RepositorioAtlasParaWorker,
  RepositorioRecetasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type {
  EscaladorDePaso,
  InstruccionDePaso,
  NavegadorDeterminista,
} from '../src/ejecutor-receta.js';
import { claveDelAtlas, hashDeOrigen, PREFIJO_MAPA } from '../src/atlas-sitios.js';
import type { RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * ATLAS DE SITIOS (V040) DE PUNTA A PUNTA dentro del handler de tarea web. Todo por fakes: cero
 * navegador, cero modelo, cero base.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - los dos caminos (motor libre y receta) agregan al cerrar bien, y lo que escriben NO lleva
 *    valores del usuario ni nada que apunte a el;
 *  - dos corridas del MISMO origen suman corroboraciones pero NO suman origenes;
 *  - una entrada de un solo origen se le sirve a ese origen y a nadie mas;
 *  - un fallo del agregador jamas cambia el desenlace del job.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const SELECTOR = 'xpath=/html/body/button[1]';
const CLAVE = claveDelAtlas({ vaultSecret: 'a'.repeat(64) });

const ROL_REDACTAR: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Redactar' };
const ID_DINAMICO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'id', valor: ':u3' };
const XPATH: EstrategiaLocalizacion = { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' };

const CLASE_REDACTAR = 'click|rol:button|redactar';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(objetivo: string, ownerId = 'user-1'): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId,
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

function makeNavegador(): NavegadorParaTarea {
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
    leerCamposDeLaPagina: vi.fn(async () => []),
    leerTextoVisible: vi.fn(async () => ''),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
    cerrarSesion: vi.fn(async () => {}),
  };
}

/** Motor fake que completa la tarea y emite UNA observacion por accion (igual que el adaptador real). */
function makeMotor(): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(
      async (params: { observador?: ((p: PasoObservado) => Promise<void>) | undefined }) => {
        const cruda = {
          type: 'act',
          action: 'click Redactar',
          pageUrl: `https://${DOMINIO}/inbox`,
          playwrightArguments: { selector: SELECTOR, method: 'click', arguments: [] },
        };
        await params.observador?.({ selector: SELECTOR, punto: null });
        return {
          exito: true,
          completado: true,
          mensaje: 'listo',
          acciones: [cruda],
          tokensIn: 1000,
          tokensOut: 100,
        };
      },
    ),
  } as unknown as MotorDeTareaWeb;
}

/** Navegador determinista: resuelve todo y declara que gano la estrategia del indice indicado. */
function makeDeterminista(
  observadas: EstrategiaLocalizacion[],
  indiceUsado = 1,
): NavegadorDeterminista {
  return {
    ejecutarPasoDeterminista: vi.fn(async (sesion: string, instruccion: InstruccionDePaso) => {
      void sesion;
      void instruccion;
      return { estado: 'ok' as const, estrategias: [], indiceUsado, detalle: null };
    }),
    leerEstrategiasDeElemento: vi.fn(async () => observadas),
  };
}

function makeEscalador(): EscaladorDePaso {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: '/html[1]/body[1]/button[1]',
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeRecetas(activa: RecetaWeb | null = null): RepositorioRecetasParaWorker {
  return {
    buscarActiva: vi.fn(async () => activa),
    listarActivas: vi.fn(async () => (activa === null ? [] : [activa])),
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

/** Fila del atlas en memoria, con la misma forma que la tabla (V040). Sin owner: no hay columna. */
interface FilaDeAtlas {
  dominio: string;
  claseDeElemento: string;
  estrategias: unknown;
  corroboraciones: number;
  origenesHash: string[];
}

/**
 * Atlas fake en memoria que REPRODUCE la semantica del upsert real: `corroboraciones` sube en cada
 * observacion y `origenes_hash` solo crece con hashes nuevos (en la tabla lo decide el `@>` de jsonb
 * dentro del mismo statement; ver aprendizaje-sitios-repository.test.ts, que fija esa query).
 */
function makeAtlas(filas: FilaDeAtlas[] = []) {
  const observaciones: Array<Record<string, unknown>> = [];
  const repo: RepositorioAtlasParaWorker = {
    listarPorDominio: vi.fn(async (dominio: string) =>
      filas.filter((fila) => fila.dominio === dominio),
    ),
    registrarObservacion: vi.fn(async (observacion) => {
      observaciones.push({ ...observacion });
      const existente = filas.find(
        (fila) =>
          fila.dominio === observacion.dominio &&
          fila.claseDeElemento === observacion.claseDeElemento,
      );
      if (existente === undefined) {
        filas.push({
          dominio: observacion.dominio,
          claseDeElemento: observacion.claseDeElemento,
          estrategias: observacion.estrategias,
          corroboraciones: 1,
          origenesHash: [observacion.origenHash],
        });
        return;
      }
      existente.estrategias = observacion.estrategias;
      existente.corroboraciones += 1;
      if (!existente.origenesHash.includes(observacion.origenHash)) {
        existente.origenesHash.push(observacion.origenHash);
      }
    }),
  };
  return { repo, filas, observaciones };
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
    determinista: makeDeterminista([ROL_REDACTAR]),
    escalador: makeEscalador(),
    // El agregador del camino libre necesita las estrategias que el observador lee del DOM.
    observadorPasos: true,
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
    logger: makeLogger(),
    ...overrides,
  } as unknown as TareaWebDeps;
}

function makeReceta(pasos: unknown[]): RecetaWeb {
  const validados = parsearPasosDeReceta(pasos);
  if (validados === null) throw new Error('los pasos del fixture no validan contra el contrato');
  return {
    id: 'rec-1',
    ownerId: 'user-1',
    dominio: DOMINIO,
    firmaObjetivo: 'x',
    descripcion: null,
    version: 1,
    estado: 'activa',
    origen: 'automatica',
    pasos: validados,
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 3,
    ejecucionesFallidas: 0,
    ajustesAutomaticos: 0,
    ultimaEjecucionEn: null,
    creadaEn: '2026-07-20T00:00:00.000Z',
    actualizadaEn: '2026-07-20T00:00:00.000Z',
  };
}

// -------------------------------------------------------------------------------------------------
// AGREGADOR: anonimato de lo que se escribe
// -------------------------------------------------------------------------------------------------

describe('agregador del atlas (camino del motor libre)', () => {
  it('una corrida exitosa deja la estructura observada, y la fila NO lleva valores ni owner_id', async () => {
    const atlas = makeAtlas();
    const deps = makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE } });

    await procesarTareaWeb(deps, makeJob('abre el correo de martin@ejemplo.com'));

    expect(atlas.filas).toHaveLength(1);
    const fila = atlas.filas[0];
    expect(fila?.dominio).toBe(DOMINIO);
    expect(fila?.claseDeElemento).toBe(CLASE_REDACTAR);
    expect(fila?.corroboraciones).toBe(1);

    // Lo que se escribio son CUATRO campos y ninguno es de tenencia.
    expect(Object.keys(atlas.observaciones[0] ?? {}).sort()).toEqual([
      'claseDeElemento',
      'dominio',
      'estrategias',
      'origenHash',
    ]);
    const serializado = JSON.stringify(atlas.observaciones);
    expect(serializado).not.toContain('user-1');
    expect(serializado).not.toContain('job-1');
    expect(serializado).not.toContain('rec-1');
    expect(serializado).not.toContain('martin@ejemplo.com');
    expect(serializado).not.toContain('ses-1');
  });

  it('el hash de origen es el HMAC del owner, jamas el owner', async () => {
    const atlas = makeAtlas();
    const deps = makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE } });

    await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(atlas.observaciones[0]?.origenHash).toBe(hashDeOrigen('user-1', CLAVE));
  });

  it('una estrategia que lleva dentro un valor tecleado de la corrida NO se guarda', async () => {
    const atlas = makeAtlas();
    const deps = makeDeps({
      atlas: { repo: atlas.repo, clave: CLAVE },
      // El unico localizador semantico del elemento es el texto del destinatario que el objetivo
      // declara: la entrada entera se descarta antes de escribir nada.
      determinista: makeDeterminista([
        { tipo: 'rol', rol: 'option', nombre: 'martin@ejemplo.com martin@ejemplo.com' },
        ID_DINAMICO,
        XPATH,
      ]),
    });

    await procesarTareaWeb(deps, makeJob('abre el correo de martin@ejemplo.com'));

    expect(atlas.repo.registrarObservacion).not.toHaveBeenCalled();
    expect(atlas.filas).toEqual([]);
  });

  it('una tarea que FALLA no aporta nada al aprendizaje comun', async () => {
    const atlas = makeAtlas();
    const motor = {
      ejecutar: vi.fn(async () => ({
        exito: false,
        completado: true,
        mensaje: 'no pude',
        acciones: [],
        tokensIn: null,
        tokensOut: null,
      })),
    } as unknown as MotorDeTareaWeb;
    const deps = makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE }, motor });

    await expect(procesarTareaWeb(deps, makeJob('abre el ultimo correo'))).rejects.toThrow();
    expect(atlas.repo.registrarObservacion).not.toHaveBeenCalled();
  });

  it('un fallo del agregador NO cambia el desenlace del job', async () => {
    const atlas = makeAtlas();
    atlas.repo.registrarObservacion = vi.fn(async () => {
      throw new Error('la base no respondio');
    });
    const deps = makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE } });

    await expect(procesarTareaWeb(deps, makeJob('abre el ultimo correo'))).resolves.toBe('completada');
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ estado: 'ok' }));
  });

  it('sin atlas cableado la tarea corre igual y no se consulta nada', async () => {
    const deps = makeDeps();
    await expect(procesarTareaWeb(deps, makeJob('abre el ultimo correo'))).resolves.toBe('completada');
  });
});

// -------------------------------------------------------------------------------------------------
// CORROBORACION: contar origenes distintos, no corridas
// -------------------------------------------------------------------------------------------------

describe('corroboracion', () => {
  it('el MISMO origen dos veces suma corroboraciones pero NO suma origenes', async () => {
    const atlas = makeAtlas();
    const deps = () => makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE } });

    await procesarTareaWeb(deps(), makeJob('abre el ultimo correo', 'user-1'));
    await procesarTareaWeb(deps(), makeJob('abre el ultimo correo', 'user-1'));

    expect(atlas.filas).toHaveLength(1);
    expect(atlas.filas[0]?.corroboraciones).toBe(2);
    expect(atlas.filas[0]?.origenesHash).toEqual([hashDeOrigen('user-1', CLAVE)]);
  });

  it('dos origenes DISTINTOS si suman, y a partir de ahi la entrada se sirve a un tercero', async () => {
    const atlas = makeAtlas();
    const deps = () => makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE } });

    await procesarTareaWeb(deps(), makeJob('abre el ultimo correo', 'user-1'));
    await procesarTareaWeb(deps(), makeJob('abre el ultimo correo', 'user-2'));

    expect(atlas.filas[0]?.origenesHash).toHaveLength(2);

    // Un TERCER origen ya recibe el mapa del sitio.
    const motor = makeMotor();
    await procesarTareaWeb(
      makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE }, motor }),
      makeJob('abre el ultimo correo', 'user-3'),
    );
    const params = (motor.ejecutar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      mapaDelSitio?: readonly string[];
    };
    expect(params.mapaDelSitio?.[0]).toContain(PREFIJO_MAPA);
    expect(params.mapaDelSitio?.[0]).toContain(CLASE_REDACTAR);
  });
});

// -------------------------------------------------------------------------------------------------
// INYECTOR DE PERCEPCION: el umbral decide quien recibe el mapa
// -------------------------------------------------------------------------------------------------

describe('inyector de percepcion (umbral aplicado de punta a punta)', () => {
  it('una entrada de UN solo origen se le sirve a ESE origen', async () => {
    const atlas = makeAtlas([
      {
        dominio: DOMINIO,
        claseDeElemento: CLASE_REDACTAR,
        estrategias: [ROL_REDACTAR],
        corroboraciones: 1,
        origenesHash: [hashDeOrigen('user-1', CLAVE)],
      },
    ]);
    const motor = makeMotor();
    await procesarTareaWeb(
      makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE }, motor }),
      makeJob('abre el ultimo correo', 'user-1'),
    );
    const params = (motor.ejecutar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      mapaDelSitio?: readonly string[];
    };
    expect(params.mapaDelSitio?.[0]).toContain(CLASE_REDACTAR);
  });

  it('esa misma entrada NO se le sirve a otro origen: el motor corre sin mapa', async () => {
    const atlas = makeAtlas([
      {
        dominio: DOMINIO,
        claseDeElemento: CLASE_REDACTAR,
        estrategias: [ROL_REDACTAR],
        corroboraciones: 1,
        origenesHash: [hashDeOrigen('user-1', CLAVE)],
      },
    ]);
    const motor = makeMotor();
    await procesarTareaWeb(
      makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE }, motor }),
      makeJob('abre el ultimo correo', 'user-2'),
    );
    const params = (motor.ejecutar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      mapaDelSitio?: readonly string[];
    };
    expect(params.mapaDelSitio).toBeUndefined();
  });

  it('una lectura del atlas que falla deja la tarea sin mapa y sin consecuencias', async () => {
    const atlas = makeAtlas();
    atlas.repo.listarPorDominio = vi.fn(async () => {
      throw new Error('la base no respondio');
    });
    const motor = makeMotor();
    await expect(
      procesarTareaWeb(
        makeDeps({ atlas: { repo: atlas.repo, clave: CLAVE }, motor }),
        makeJob('abre el ultimo correo'),
      ),
    ).resolves.toBe('completada');
    const params = (motor.ejecutar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      mapaDelSitio?: readonly string[];
    };
    expect(params.mapaDelSitio).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// AGREGADOR: camino por receta
// -------------------------------------------------------------------------------------------------

describe('agregador del atlas (camino por receta)', () => {
  it('la estrategia GANADORA de cada paso es la que queda en el atlas', async () => {
    const atlas = makeAtlas();
    const receta = makeReceta([
      {
        idx: 0,
        accion: 'click',
        estrategias: [ID_DINAMICO, ROL_REDACTAR],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
    ]);
    const motor = makeMotor();
    const deps = makeDeps({
      atlas: { repo: atlas.repo, clave: CLAVE },
      recetas: makeRecetas(receta),
      // El indice 1 es el rol: es el fallback que gano, igual que en el caso Gmail de V038.
      determinista: makeDeterminista([ROL_REDACTAR], 1),
      motor,
    });

    await expect(procesarTareaWeb(deps, makeJob('abre el ultimo correo'))).resolves.toBe('completada');

    // La tarea corrio sin el motor y aun asi dejo su aporte al aprendizaje comun.
    expect(motor.ejecutar).not.toHaveBeenCalled();
    expect(atlas.filas).toEqual([
      {
        dominio: DOMINIO,
        claseDeElemento: CLASE_REDACTAR,
        estrategias: [ROL_REDACTAR],
        corroboraciones: 1,
        origenesHash: [hashDeOrigen('user-1', CLAVE)],
      },
    ]);
  });

  it('si gano una estrategia que el atlas no admite (un id por sesion) no se escribe nada', async () => {
    const atlas = makeAtlas();
    const receta = makeReceta([
      {
        idx: 0,
        accion: 'click',
        estrategias: [ID_DINAMICO, XPATH],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
    ]);
    const deps = makeDeps({
      atlas: { repo: atlas.repo, clave: CLAVE },
      recetas: makeRecetas(receta),
      determinista: makeDeterminista([], 0),
    });

    await procesarTareaWeb(deps, makeJob('abre el ultimo correo'));

    expect(atlas.repo.registrarObservacion).not.toHaveBeenCalled();
  });
});
