import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioAtlasParaWorker,
  RepositorioPlantillasParaWorker,
  RepositorioRecetasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type {
  EscaladorDePaso,
  InstruccionDePaso,
  NavegadorDeterminista,
} from '../src/ejecutor-receta.js';
import { hashDeOrigenDePlantilla } from '../src/plantillas-compartidas.js';
import { firmaDeObjetivo } from '../src/receta-web.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * SONDA DE RECONOCIMIENTO PREVIA (pre-flight) cableada en la tarea web. Todo por fakes: cero
 * navegador, cero modelo, cero base. Lo que estos tests fijan:
 *
 *  - FIXTURE A: las clases observables del procedimiento EXISTEN en la pagina: el pre-flight pasa y
 *    la ejecucion es la de siempre (cero falsos positivos);
 *  - FIXTURE B: la pagina cambio el rol o el nombre accesible de un control declarado: la sonda
 *    detecta el desajuste, NO se ejecuta un solo paso del procedimiento, el desajuste queda
 *    registrado con el hash del consumidor y la tarea cae al motor libre con la pagina limpia;
 *  - FIXTURE C: la pagina esta hidratando y el control aparece en la SEGUNDA lectura: NO se declara
 *    desajuste;
 *  - la REGRESION del caso real de produccion (un cliente de correo que cambio el rol y el nombre
 *    accesible del control de destinatario y renombro su redactor) es UNA INSTANCIA MAS del fixture
 *    B, sin una sola regla especifica de ningun sitio;
 *  - el mismo pre-flight cubre el camino de RECETA PROPIA, no solo el de plantilla ajena;
 *  - un fake sin el puerto de sonda corre exactamente como hoy (compuerta ADITIVA).
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const CLAVE_PLANTILLAS = 'clave-de-plantillas-del-worker';
const OWNER = 'user-1';
const HASH_CONSUMIDOR = hashDeOrigenDePlantilla(OWNER, CLAVE_PLANTILLAS);

const OBJETIVO =
  'envia un correo a martin@ejemplo.com con asunto "Hola" y cuerpo "llego el paquete"';

const CLASE_DESTINATARIO = 'escribir|rol:textbox|destinatarios en para';
const CLASE_ASUNTO = 'escribir|rol:textbox|asunto';
const CLASE_CUERPO = 'escribir|rol:textbox|cuerpo del mensaje';
const CLASE_ENVIAR = 'click|rol:button|enviar';
const CLASES_DEL_PROCEDIMIENTO = [CLASE_DESTINATARIO, CLASE_ASUNTO, CLASE_CUERPO, CLASE_ENVIAR];

/**
 * LO QUE LA SONDA LEE de una pagina cuyo primer control observable (el destinatario) sigue siendo
 * el declarado: candidatos del eje rol=textbox, con el nombre real completo.
 */
const LECTURA_QUE_COINCIDE: string[][] = [['Buscar', 'Destinatarios en Para', 'Asunto']];

/**
 * LA PAGINA QUE CAMBIO (fixture B, y la forma exacta del caso real de produccion): el control de
 * destinatario ya no expone ese nombre accesible en su rol (el sitio lo cambio de rol y de nombre,
 * y renombro su redactor). Ningun candidato del eje lleva el nombre declarado como prefijo.
 */
const LECTURA_QUE_NO_COINCIDE: string[][] = [['Buscar', 'Para los destinatarios', 'Titulo']];

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: OWNER,
    credentialId: 'cred-1',
    status: 'running',
    payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo: OBJETIVO, textoUsuario: OBJETIVO },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    startedAt: '2026-08-20T00:00:00.000Z',
    finishedAt: null,
  };
}

function makeSitio(): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: OWNER,
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

const CAMPOS_LLENOS: CampoDeLaPagina[] = [
  { contexto: 'destinatarios en para', valor: 'martin@ejemplo.com' },
  { contexto: 'asunto', valor: 'Hola' },
  { contexto: 'cuerpo del mensaje', valor: 'llego el paquete' },
];

function makeNavegador(): NavegadorParaTarea {
  let lecturas = 0;
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
    leerCamposDeLaPagina: vi.fn(async () => {
      lecturas += 1;
      return lecturas > 1 ? [] : CAMPOS_LLENOS;
    }),
    leerTextoVisible: vi.fn(async () => ''),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
    localizarBotonPorAriaLabel: vi.fn(async () => ({
      ariaLabel: 'Enviar',
      rol: 'button',
      candidatos: 1,
    })),
    cerrarSesion: vi.fn(async () => {}),
  } as unknown as NavegadorParaTarea;
}

function makeMotor(): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(async () => ({
      exito: true,
      completado: true,
      mensaje: 'listo',
      acciones: [],
      tokensIn: 1000,
      tokensOut: 100,
    })),
  } as unknown as MotorDeTareaWeb;
}

/** Navegador determinista con la sonda cableada: una lectura por llamada, la ultima se repite. */
function makeDeterminista(lecturasDeSonda?: Array<string[][] | null>): NavegadorDeterminista & {
  ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
  leerCandidatosDeSonda?: ReturnType<typeof vi.fn>;
} {
  let sondas = 0;
  const base = {
    ejecutarPasoDeterminista: vi.fn(async (sesion: string, instruccion: InstruccionDePaso) => {
      void sesion;
      void instruccion;
      return { estado: 'ok' as const, estrategias: [], detalle: null };
    }),
    leerEstrategiasDeElemento: vi.fn(async () => []),
    localizarBotonPorAriaLabel: vi.fn(async () => ({
      ariaLabel: 'Enviar (Ctrl-Enter)',
      rol: 'button',
      candidatos: 1,
    })),
  };
  if (lecturasDeSonda === undefined) return base;
  return {
    ...base,
    leerCandidatosDeSonda: vi.fn(async () => {
      const lectura = lecturasDeSonda[Math.min(sondas, lecturasDeSonda.length - 1)] ?? null;
      sondas += 1;
      return lectura;
    }),
  };
}

function makeEscalador(): EscaladorDePaso {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: '/html[1]/body[1]/button[1]',
      tokensIn: 10,
      tokensOut: 5,
    })),
  };
}

function makeRecetas(activa: RecetaWeb | null = null): RepositorioRecetasParaWorker & {
  promover: ReturnType<typeof vi.fn>;
  registrarEjecucion: ReturnType<typeof vi.fn>;
} {
  return {
    buscarActiva: vi.fn(async () => activa),
    listarActivas: vi.fn(async () => []),
    promover: vi.fn(async () => null),
    marcarObsoleta: vi.fn(async () => {}),
    reemplazarPasos: vi.fn(async () => {}),
    registrarEjecucion: vi.fn(async () => {}),
  };
}

function makeReceta(): RecetaWeb {
  return {
    id: 'receta-1',
    ownerId: OWNER,
    dominio: DOMINIO,
    firmaObjetivo: firmaDeObjetivo(OBJETIVO, [DOMINIO]),
    descripcion: 'enviar un correo',
    version: 1,
    estado: 'activa',
    origen: 'grabacion',
    pasos: [
      {
        idx: 0,
        accion: 'escribir',
        estrategias: [{ tipo: 'rol', rol: 'textbox', nombre: 'Destinatarios en Para' }],
        valor: { tipo: 'parametro', parametro: 'destinatario' },
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
      { idx: 1, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
      {
        idx: 2,
        accion: 'click',
        estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
    ],
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 1,
    ejecucionesFallidas: 0,
    ajustesAutomaticos: 0,
    ultimaEjecucionEn: null,
    creadaEn: '2026-07-20T00:00:00.000Z',
    actualizadaEn: '2026-07-20T00:00:00.000Z',
  };
}

function pasoEscribir(idx: number, clase: string, nombre: string, marcador: string): unknown {
  return {
    idx,
    accion: 'escribir',
    dominio: DOMINIO,
    claseDeElemento: clase,
    estrategias: [{ tipo: 'rol', rol: 'textbox', nombre }],
    valor: { tipo: 'parametro', parametro: marcador },
    teclas: null,
    esperaMs: null,
  };
}

/** Los CINCO pasos del procedimiento compartido de envio: tres datos, verificacion y click final. */
function pasosDeLaPlantilla(): unknown[] {
  return [
    pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', 'destinatario'),
    pasoEscribir(1, CLASE_ASUNTO, 'Asunto', 'asunto'),
    pasoEscribir(2, CLASE_CUERPO, 'Cuerpo del mensaje', 'cuerpo'),
    {
      idx: 3,
      accion: 'verificar',
      dominio: DOMINIO,
      claseDeElemento: null,
      estrategias: [],
      valor: null,
      teclas: null,
      esperaMs: null,
    },
    {
      idx: 4,
      accion: 'click',
      dominio: DOMINIO,
      claseDeElemento: CLASE_ENVIAR,
      estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
      valor: null,
      teclas: null,
      esperaMs: null,
    },
  ];
}

function makePlantillas(pasos: unknown[] | null): RepositorioPlantillasParaWorker & {
  buscarServible: ReturnType<typeof vi.fn>;
  registrarEjecucion: ReturnType<typeof vi.fn>;
  registrarDesajuste: ReturnType<typeof vi.fn>;
} {
  return {
    publicar: vi.fn(async () => ({ publicada: true })),
    buscarServible: vi.fn(async () =>
      pasos === null ? null : { id: 'plantilla-1', estado: 'candidata', pasos, origenes: 2 },
    ),
    registrarEjecucion: vi.fn(async () => {}),
    registrarDesajuste: vi.fn(async () => ({
      estado: 'candidata',
      estadoPrevio: 'candidata',
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresClave: 'asunto+cuerpo+destinatario',
    })),
  };
}

function makeAtlas(clases: string[]): RepositorioAtlasParaWorker {
  return {
    listarPorDominio: vi.fn(async () =>
      clases.map((clase) => ({
        claseDeElemento: clase,
        estrategias: [
          { tipo: 'rol', rol: clase.startsWith('click') ? 'button' : 'textbox', nombre: 'x' },
        ],
        corroboraciones: 3,
        origenesHash: ['origen-a', 'origen-b'],
      })),
    ),
    registrarObservacion: vi.fn(async () => {}),
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
    atlas: { repo: makeAtlas(CLASES_DEL_PROCEDIMIENTO), clave: 'clave-del-atlas' },
    plantillas: { repo: makePlantillas(null), clave: CLAVE_PLANTILLAS },
    vaultSecret: 'a'.repeat(64),
    model: 'anthropic/claude-opus-4-5',
    maxPasos: 40,
    historialPasos: 8,
    modoScreenshots: 'cambios',
    runTimeoutMs: 60_000,
    esperar: vi.fn(async () => {}),
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

/** Deps con una plantilla servible y la sonda alimentada con esas lecturas, una por llamada. */
function conPlantillaYSonda(lecturas: Array<string[][] | null> | undefined): TareaWebDeps {
  return makeDeps({
    determinista: makeDeterminista(lecturas),
    plantillas: { repo: makePlantillas(pasosDeLaPlantilla()), clave: CLAVE_PLANTILLAS },
  });
}

/** El desenlace del motor fake no es lo que se mide aqui: se recoge y se ignora. */
async function correr(deps: TareaWebDeps): Promise<void> {
  await procesarTareaWeb(deps, makeJob()).catch(() => undefined);
}

function determinista(deps: TareaWebDeps): {
  ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
  leerCandidatosDeSonda?: ReturnType<typeof vi.fn>;
} {
  return deps.determinista as unknown as {
    ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    leerCandidatosDeSonda?: ReturnType<typeof vi.fn>;
  };
}

function plantillas(deps: TareaWebDeps): {
  registrarEjecucion: ReturnType<typeof vi.fn>;
  registrarDesajuste: ReturnType<typeof vi.fn>;
} {
  return (deps.plantillas as unknown as { repo: never }).repo as unknown as {
    registrarEjecucion: ReturnType<typeof vi.fn>;
    registrarDesajuste: ReturnType<typeof vi.fn>;
  };
}

describe('fixture A: las clases observables existen y el pre-flight pasa (cero falsos positivos)', () => {
  it('la plantilla se ejecuta como siempre, con UNA sola lectura de sonda', async () => {
    const deps = conPlantillaYSonda([LECTURA_QUE_COINCIDE]);

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    // Cuatro primitivas: tres escrituras y el click final. La sonda no ejecuto ninguna de mas.
    expect(determinista(deps).ejecutarPasoDeterminista).toHaveBeenCalledTimes(4);
    expect(determinista(deps).leerCandidatosDeSonda).toHaveBeenCalledTimes(1);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
    expect(plantillas(deps).registrarDesajuste).not.toHaveBeenCalled();
  });

  it('un despliegue SIN el puerto de sonda corre exactamente como hoy (compuerta aditiva)', async () => {
    const deps = conPlantillaYSonda(undefined);

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    expect(determinista(deps).ejecutarPasoDeterminista).toHaveBeenCalledTimes(4);
  });
});

describe('fixture B: la pagina cambio el rol o el nombre del control declarado', () => {
  it('NO se ejecuta un solo paso del procedimiento y la tarea cae al motor libre con la pagina limpia', async () => {
    const deps = conPlantillaYSonda([LECTURA_QUE_NO_COINCIDE, LECTURA_QUE_NO_COINCIDE]);

    await correr(deps);

    // La pagina queda LIMPIA porque nada la toco: cero primitivas deterministas antes del motor.
    expect(determinista(deps).ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('el desajuste se registra con el hash del consumidor y NO cuenta como ejecucion', async () => {
    const deps = conPlantillaYSonda([LECTURA_QUE_NO_COINCIDE, LECTURA_QUE_NO_COINCIDE]);

    await correr(deps);

    expect(plantillas(deps).registrarDesajuste).toHaveBeenCalledWith('plantilla-1', HASH_CONSUMIDOR);
    expect(plantillas(deps).registrarEjecucion).not.toHaveBeenCalled();
  });

  it('REGRESION (caso real de produccion): el control de destinatario cambio de rol y de nombre', async () => {
    // El cliente de correo del incidente: su control de destinatario dejo de ser el textbox con ese
    // nombre accesible y su redactor se renombro. Es UNA INSTANCIA del fixture B: la pagina ya no
    // tiene la clase observable del primer paso, y no hay una sola regla del sitio en el codigo.
    const paginaRedisenada: string[][] = [['Buscar en el correo', 'Agregar contactos']];
    const deps = conPlantillaYSonda([paginaRedisenada, paginaRedisenada]);

    await correr(deps);

    expect(determinista(deps).ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(plantillas(deps).registrarDesajuste).toHaveBeenCalledTimes(1);
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe('fixture C: la pagina esta hidratando y el control aparece en la segunda lectura', () => {
  it('NO se declara desajuste y la plantilla se ejecuta', async () => {
    const deps = conPlantillaYSonda([[[]], LECTURA_QUE_COINCIDE]);

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    expect(determinista(deps).leerCandidatosDeSonda).toHaveBeenCalledTimes(2);
    expect(determinista(deps).ejecutarPasoDeterminista).toHaveBeenCalledTimes(4);
    expect(plantillas(deps).registrarDesajuste).not.toHaveBeenCalled();
  });

  it('una lectura ROTA deja la sonda no evaluable: se ejecuta como hoy, jamas se declara desajuste', async () => {
    const deps = conPlantillaYSonda([null]);

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    expect(plantillas(deps).registrarDesajuste).not.toHaveBeenCalled();
  });
});

describe('el mismo pre-flight cubre la RECETA PROPIA', () => {
  it('con desajuste, la receta NO ejecuta un solo paso y la tarea sigue con el motor', async () => {
    const deps = makeDeps({
      recetas: makeRecetas(makeReceta()),
      determinista: makeDeterminista([LECTURA_QUE_NO_COINCIDE, LECTURA_QUE_NO_COINCIDE]),
    });

    await correr(deps);

    expect(determinista(deps).ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('con la interfaz vigente, la receta corre como siempre', async () => {
    const deps = makeDeps({
      recetas: makeRecetas(makeReceta()),
      determinista: makeDeterminista([LECTURA_QUE_COINCIDE]),
    });

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    // Dos primitivas: la escritura y el click final (el `verificar` no toca el navegador).
    expect(determinista(deps).ejecutarPasoDeterminista).toHaveBeenCalledTimes(2);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
  });
});
