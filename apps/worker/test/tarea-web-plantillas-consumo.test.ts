import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { AprobacionWeb } from '@ledesma-platform/backend/aprobaciones';
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
import type { EscaladorDePaso, InstruccionDePaso, NavegadorDeterminista } from '../src/ejecutor-receta.js';
import type { PeticionDeEleccion } from '../src/eleccion-tarea.js';
import {
  marcadoresClave,
  marcadoresDePasosPublicables,
  parsearPasosPublicables,
} from '@ledesma-platform/shared';
import {
  descripcionDeOfrecimiento,
  hashDeOrigenDePlantilla,
  parsearOfrecimiento,
  plantillaAplicable,
} from '../src/plantillas-compartidas.js';
import { firmaDeObjetivo } from '../src/receta-web.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacion, makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * CONSUMO DE PLANTILLAS COMPARTIDAS (V041): un usuario pide lo mismo en el mismo sitio, nunca lo hizo,
 * y ejecuta el procedimiento que descubrio OTRA cuenta en vez de pagar el motor libre. Todo por fakes:
 * cero navegador, cero modelo, cero base.
 *
 * LO QUE ESTOS TESTS FIJAN y no debe poder cambiar en silencio:
 *  - LA PRECEDENCIA: lo propio gana SIEMPRE y la tabla global ni se consulta;
 *  - EL PROMPT DEL ELECTOR es byte a byte el mismo con y sin plantillas disponibles, y su catalogo
 *    sigue siendo solo de tareas propias aunque haya mas de MAX_TAREAS_OFRECIDAS;
 *  - LA APLICABILIDAD falla cerrada: clase sin corroborar, dato sin declarar, paso extra;
 *  - EL CHECKPOINT es obligatorio: sin aprobacion no se ejecuta un solo paso ajeno;
 *  - LA BARRERA DE IDENTIDAD corre en TODOS los pasos y en modo ACTIVO, con el default de produccion
 *    de TAREA_WEB_BARRERA_IDENTIDAD sin tocar;
 *  - LA ESCALADA esta deshabilitada: un paso que no resuelve abandona y NO llama al modelo;
 *  - LA COPIA a receta propia ocurre SOLO con efecto confirmado.
 *
 * NINGUN test enciende TAREA_WEB_OBSERVADOR_PASOS: corren con el default de produccion (apagado).
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const CLAVE_PLANTILLAS = 'clave-de-plantillas-del-worker';
const OWNER = 'user-1';

/** El objetivo del CONSUMIDOR: declara los tres datos, igual que el caso medido en produccion. */
const OBJETIVO =
  'envia un correo a martin@ejemplo.com con asunto "Hola" y cuerpo "llego el paquete"';

/** Las cuatro clases del procedimiento, tal como las produce claseDeElemento sobre sus estrategias. */
const CLASE_DESTINATARIO = 'escribir|rol:textbox|destinatarios en para';
const CLASE_ASUNTO = 'escribir|rol:textbox|asunto';
const CLASE_CUERPO = 'escribir|rol:textbox|cuerpo del mensaje';
const CLASE_ENVIAR = 'click|rol:button|enviar';
const CLASE_ELIMINAR = 'click|rol:button|eliminar definitivamente';
const CLASE_FILTRO = 'click|rol:button|crear filtro';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(objetivo: string = OBJETIVO): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: OWNER,
    credentialId: 'cred-1',
    status: 'running',
    payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    startedAt: '2026-07-31T00:00:00.000Z',
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

/** El redactor con los tres datos ya escritos: es lo que la verificacion determinista compara. */
const CAMPOS_LLENOS: CampoDeLaPagina[] = [
  { contexto: 'destinatarios en para', valor: 'martin@ejemplo.com' },
  { contexto: 'asunto', valor: 'Hola' },
  { contexto: 'cuerpo del mensaje', valor: 'llego el paquete' },
];

/**
 * Navegador fake. `cierraElRedactor` decide el DESENLACE DEL EFECTO: con true, la primera lectura ve
 * el formulario lleno (la de la verificacion) y las siguientes ya no lo encuentran, que es como el
 * sitio dice "enviado"; con false el formulario sigue ahi y el efecto NO se confirma.
 */
function makeNavegador(cierraElRedactor = true): NavegadorParaTarea {
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
      return cierraElRedactor && lecturas > 1 ? [] : CAMPOS_LLENOS;
    }),
    leerTextoVisible: vi.fn(async () => ''),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
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

/** `noLocalizados` son los INDICES de llamada que devuelven 'no_localizado'. */
function makeDeterminista(
  noLocalizados: number[] = [],
  ariaLabel = 'Enviar (Ctrl-Enter)',
): NavegadorDeterminista & { ejecutarPasoDeterminista: ReturnType<typeof vi.fn> } {
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
    leerEstrategiasDeElemento: vi.fn(async () => []),
    // Lo que la BARRERA DE IDENTIDAD lee del DOM antes de dejar accionar el control irreversible.
    localizarBotonPorAriaLabel: vi.fn(async () => ({ ariaLabel, rol: 'button', candidatos: 1 })),
  };
}

/** Elector fake. Se tipa la ENTRADA para poder leer despues la peticion exacta que se le mando. */
function makeElector(respuesta: string = JSON.stringify({ tarea: null, datos: {} })): {
  consultar: ReturnType<typeof vi.fn<(params: { peticion: PeticionDeEleccion }) => Promise<string>>>;
} {
  return {
    consultar: vi.fn(async (params: { peticion: PeticionDeEleccion }) => {
      void params;
      return respuesta;
    }),
  };
}

function makeEscalador(): EscaladorDePaso & { ejecutarPasoConModelo: ReturnType<typeof vi.fn> } {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: '/html[1]/body[1]/button[1]',
      tokensIn: 10,
      tokensOut: 5,
    })),
  };
}

function makeRecetas(
  activa: RecetaWeb | null = null,
  catalogo: RecetaWeb[] = [],
): RepositorioRecetasParaWorker & {
  buscarActiva: ReturnType<typeof vi.fn>;
  promover: ReturnType<typeof vi.fn>;
} {
  return {
    buscarActiva: vi.fn(async () => activa),
    listarActivas: vi.fn(async () => catalogo),
    promover: vi.fn(async () => null),
    marcarObsoleta: vi.fn(async () => {}),
    reemplazarPasos: vi.fn(async () => {}),
    registrarEjecucion: vi.fn(async () => {}),
  };
}

function makeReceta(overrides: Partial<RecetaWeb> = {}): RecetaWeb {
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
    ...overrides,
  };
}

function pasoEscribir(idx: number, clase: string, nombre: string, valor: unknown): unknown {
  return {
    idx,
    accion: 'escribir',
    dominio: DOMINIO,
    claseDeElemento: clase,
    estrategias: [{ tipo: 'rol', rol: 'textbox', nombre }],
    valor,
    teclas: null,
    esperaMs: null,
  };
}

function pasoClick(idx: number, clase: string, nombre: string): unknown {
  return {
    idx,
    accion: 'click',
    dominio: DOMINIO,
    claseDeElemento: clase,
    estrategias: [{ tipo: 'rol', rol: 'button', nombre }],
    valor: null,
    teclas: null,
    esperaMs: null,
  };
}

function pasoVerificar(idx: number): unknown {
  return {
    idx,
    accion: 'verificar',
    dominio: DOMINIO,
    claseDeElemento: null,
    estrategias: [],
    valor: null,
    teclas: null,
    esperaMs: null,
  };
}

/** Los SIETE pasos del procedimiento real: los tres datos, la verificacion y el envio. */
function pasosDeLaPlantilla(): unknown[] {
  return [
    pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', {
      tipo: 'parametro',
      parametro: 'destinatario',
    }),
    pasoEscribir(1, CLASE_ASUNTO, 'Asunto', { tipo: 'parametro', parametro: 'asunto' }),
    pasoEscribir(2, CLASE_CUERPO, 'Cuerpo del mensaje', { tipo: 'parametro', parametro: 'cuerpo' }),
    pasoVerificar(3),
    pasoClick(4, CLASE_ENVIAR, 'Enviar'),
  ];
}

/** El origen de LA OTRA CUENTA: el que hace que la plantilla sea ajena y por tanto servible. */
const ORIGEN_AJENO = 'origen-de-otra-cuenta';

/** Una fila de `plantillas_compartidas` tal como la devolveria la base. */
interface FilaDePlantilla {
  id: string;
  estado: string;
  pasos: unknown;
  origenes: number;
  origenesHash?: string[];
}

/**
 * `marcadores_clave` DE LA FILA, derivado de sus propios pasos igual que en la publicacion: es lo que
 * la plantilla EXIGE, y lo que la contencion compara contra lo que el consumidor declara.
 */
function marcadoresDeLaFila(fila: FilaDePlantilla): string {
  return marcadoresClave(marcadoresDePasosPublicables(parsearPasosPublicables(fila.pasos) ?? []));
}

/**
 * Fake del repositorio de plantillas. Emula la query real de `buscarServible`, con sus tres reglas:
 *
 *  1. LA CONTENCION: la fila califica si SU `marcadores_clave` esta entre las claves que el consumidor
 *     manda (su conjunto declarado y todos sus subconjuntos), no solo si son iguales.
 *  2. EL ORIGEN: califica mientras QUEDE AL MENOS UN ORIGEN DISTINTO del consumidor. Que el consumidor
 *     tambien figure entre los origenes NO la excluye. El fake anterior copiaba el predicado viejo
 *     ("yo no estoy dentro"), y por eso la exclusion permanente de una fila con dos origenes reales no
 *     se veia en CI.
 *  3. EL DESEMPATE: gana la mas especifica (mas marcadores), despues la mas corroborada (mas origenes,
 *     mas exitos) y al final el `id`, que es unico. Nunca al azar.
 */
function makePlantillas(filas: FilaDePlantilla[]): RepositorioPlantillasParaWorker & {
  buscarServible: ReturnType<typeof vi.fn>;
  registrarEjecucion: ReturnType<typeof vi.fn>;
} {
  return {
    publicar: vi.fn(async () => ({ publicada: true })),
    buscarServible: vi.fn(
      async (clave: { marcadoresPosibles: readonly string[]; origenHash: string }) => {
        const candidatas = filas.filter((fila) => {
          const origenes = fila.origenesHash ?? [ORIGEN_AJENO];
          if (!origenes.some((hash) => hash !== clave.origenHash)) return false;
          return clave.marcadoresPosibles.includes(marcadoresDeLaFila(fila));
        });
        const cuantos = (fila: FilaDePlantilla): number => {
          const clave = marcadoresDeLaFila(fila);
          return clave === '' ? 0 : clave.split('+').length;
        };
        const elegida = [...candidatas].sort(
          (a, b) =>
            cuantos(b) - cuantos(a) || b.origenes - a.origenes || a.id.localeCompare(b.id),
        )[0];
        if (elegida === undefined) return null;
        return {
          id: elegida.id,
          estado: elegida.estado,
          pasos: elegida.pasos,
          origenes: elegida.origenes,
        };
      },
    ),
    registrarEjecucion: vi.fn(async () => {}),
  };
}

/** Atlas fake: cada clase llega con DOS origenes distintos, o sea corroborada para cualquier origen. */
function makeAtlas(clases: string[]): RepositorioAtlasParaWorker {
  return {
    listarPorDominio: vi.fn(async () =>
      clases.map((clase) => ({
        claseDeElemento: clase,
        estrategias: [{ tipo: 'rol', rol: clase.startsWith('click') ? 'button' : 'textbox', nombre: 'x' }],
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

const CLASES_DEL_PROCEDIMIENTO = [CLASE_DESTINATARIO, CLASE_ASUNTO, CLASE_CUERPO, CLASE_ENVIAR];

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
    plantillas: { repo: makePlantillas([]), clave: CLAVE_PLANTILLAS },
    // Sin `observadorPasos`: el DEFAULT DE PRODUCCION (apagado). Ninguno de estos tests lo enciende.
    vaultSecret: 'a'.repeat(64),
    model: 'anthropic/claude-opus-4-5',
    maxPasos: 40,
    historialPasos: 8,
    modoScreenshots: 'cambios',
    runTimeoutMs: 60_000,
    // La confirmacion del efecto relee el DOM: los tests no duermen.
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

/** Los deps con una plantilla servible de `pasos` y las clases `clases` corroboradas en el atlas. */
function conPlantilla(
  pasos: unknown[],
  clases: string[] = CLASES_DEL_PROCEDIMIENTO,
  extra: Partial<TareaWebDeps> = {},
  origenesHash: string[] = [ORIGEN_AJENO],
): TareaWebDeps {
  return conPlantillas(
    [{ id: 'plantilla-1', estado: 'candidata', pasos, origenes: 2, origenesHash }],
    clases,
    extra,
  );
}

/** Igual, con VARIAS filas en la tabla: es lo que hace falta para medir el desempate. */
function conPlantillas(
  filas: FilaDePlantilla[],
  clases: string[] = CLASES_DEL_PROCEDIMIENTO,
  extra: Partial<TareaWebDeps> = {},
): TareaWebDeps {
  return makeDeps({
    atlas: { repo: makeAtlas(clases), clave: 'clave-del-atlas' },
    plantillas: { repo: makePlantillas(filas), clave: CLAVE_PLANTILLAS },
    ...extra,
  });
}

/**
 * Corre la tarea sin que el desenlace del MOTOR LIBRE contamine la asercion. Cuando la plantilla no
 * aplica (o se abandona), la tarea la termina el motor, y el motor de estos fakes no atraviesa la
 * guardia: cierra con "el agente se detuvo por su cuenta". Ese desenlace no es lo que estos tests
 * miden -- lo miden los de tarea-web.test.ts -- asi que se recoge y se ignora.
 */
async function correr(deps: TareaWebDeps, job: Job = makeJob()): Promise<void> {
  await procesarTareaWeb(deps, job).catch(() => undefined);
}

/** Una aprobacion ya DECIDIDA sobre el ofrecimiento del procedimiento compartido. */
function aprobacionDelOfrecimiento(estado: AprobacionWeb['estado'] = 'aprobada'): AprobacionWeb {
  return makeAprobacion({
    accionTipo: 'irreversible',
    descripcion: `plantilla_compartida:enviar:asunto+cuerpo+destinatario:${DOMINIO}`,
    estado,
    decididaPor: OWNER,
    decididaEn: '2026-07-31T00:05:00.000Z',
  });
}

/** Los deps con esa decision ya tomada (es lo que ve el worker al re-reclamar el job). */
function yaDecidido(deps: TareaWebDeps, aprobacion: AprobacionWeb): TareaWebDeps {
  return {
    ...deps,
    aprobaciones: makeAprobacionesRepo({ obtenerVigentePorJob: vi.fn(async () => aprobacion) }),
  };
}

describe('plantillaAplicable: la puerta pura, paso por paso', () => {
  const VALORES = { destinatario: 'martin@ejemplo.com', asunto: 'Hola', cuerpo: 'llego el paquete' };
  const CORROBORADAS = new Set(CLASES_DEL_PROCEDIMIENTO);

  function evaluar(pasos: unknown[], clases: ReadonlySet<string> = CORROBORADAS) {
    return plantillaAplicable({
      pasos,
      dominio: DOMINIO,
      valores: VALORES,
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
  }

  it('el procedimiento completo aplica y sale como pasos de receta ejecutables', () => {
    const veredicto = evaluar(pasosDeLaPlantilla());
    expect(veredicto.aplica).toBe(true);
    if (!veredicto.aplica) return;
    expect(veredicto.pasos).toHaveLength(5);
    expect(veredicto.marcadores).toEqual(['asunto', 'cuerpo', 'destinatario']);
    // Una plantilla no lleva rutas: ningun paso puede sacar la sesion del usuario de su sitio.
    expect(veredicto.pasos.every((paso) => paso.ruta === null)).toBe(true);
  });

  it('FIXTURE HOSTIL: la clase DECLARADA no es la que producen sus estrategias', () => {
    // La fila declara una clase inocente y CORROBORADA, pero apunta a otro control. Sin esta puerta,
    // la comprobacion de corroboracion pasaria y el paso actuaria sobre lo que nadie avalo.
    const pasos = pasosDeLaPlantilla();
    pasos[4] = {
      idx: 4,
      accion: 'click',
      dominio: DOMINIO,
      claseDeElemento: CLASE_ENVIAR,
      estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Eliminar definitivamente' }],
      valor: null,
      teclas: null,
      esperaMs: null,
    };
    expect(evaluar(pasos)).toMatchObject({ aplica: false, motivo: 'clase_no_coincide', idx: 4 });
  });

  it('sin paso `verificar`, un objetivo irreversible no puede usar la plantilla', () => {
    const pasos = pasosDeLaPlantilla().filter((_, i) => i !== 3);
    // Los idx tienen que ser correlativos para que el contrato valide.
    const renumerados = pasos.map((paso, idx) => ({ ...(paso as object), idx }));
    expect(evaluar(renumerados)).toMatchObject({ aplica: false, motivo: 'sin_verificacion' });
  });

  it('un paso en OTRO dominio no aplica (el consumo multisitio no existe todavia)', () => {
    const pasos = pasosDeLaPlantilla();
    pasos[1] = { ...(pasos[1] as object), dominio: 'otro.ejemplo.com' };
    expect(evaluar(pasos)).toMatchObject({ aplica: false, motivo: 'dominio_no_autorizado', idx: 1 });
  });

  it('unos pasos que no validan contra el contrato no aplican', () => {
    expect(evaluar([{ idx: 0, accion: 'navegar', dominio: DOMINIO, estrategias: [], valor: null }])).toMatchObject(
      { aplica: false, motivo: 'contrato_invalido' },
    );
  });
});

describe('el texto del checkpoint es un codigo cerrado de la plataforma', () => {
  it('el codigo se escribe y se vuelve a leer sin perder nada', () => {
    const ofrecimiento = {
      codigoDeIntencion: 'enviar' as const,
      marcadores: ['asunto' as const, 'destinatario' as const],
      dominio: DOMINIO,
    };
    const codigo = descripcionDeOfrecimiento(ofrecimiento);
    expect(codigo).toBe(`plantilla_compartida:enviar:asunto+destinatario:${DOMINIO}`);
    expect(parsearOfrecimiento(codigo)).toEqual(ofrecimiento);
  });

  it('cualquier otra descripcion NO se lee como ofrecimiento (los motivos de siempre no cambian)', () => {
    expect(parsearOfrecimiento('Enviar el formulario de pago por 2,400 MXN')).toBeNull();
    // Un codigo con una intencion o un marcador que no estan en las listas cerradas: falla cerrada.
    expect(parsearOfrecimiento(`plantilla_compartida:filtrar:asunto:${DOMINIO}`)).toBeNull();
    expect(parsearOfrecimiento(`plantilla_compartida:enviar:contrasena:${DOMINIO}`)).toBeNull();
    expect(parsearOfrecimiento('plantilla_compartida:enviar:asunto')).toBeNull();
  });
});

describe('precedencia: lo propio gana SIEMPRE y la tabla global ni se consulta', () => {
  it('una receta propia por firma exacta gana sobre una plantilla, y no se consulta la tabla', async () => {
    const recetas = makeRecetas(makeReceta());
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, { recetas });
    const plantillas = deps.plantillas as unknown as {
      repo: { buscarServible: ReturnType<typeof vi.fn> };
    };

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    expect(recetas.buscarActiva).toHaveBeenCalled();
    // LA ASERCION CENTRAL: con una via propia resuelta, la consulta de plantillas NO SE HACE.
    expect(plantillas.repo.buscarServible).not.toHaveBeenCalled();
    // Y no se ofrecio ningun checkpoint: la receta propia no lo necesita.
    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
  });

  it('una tarea propia elegida por el modelo tambien gana sobre una plantilla', async () => {
    const receta = makeReceta({ firmaObjetivo: 'otra-firma-que-no-coincide' });
    const recetas = makeRecetas(null, [receta]);
    const elector = makeElector(
      JSON.stringify({ tarea: 'receta-1', datos: { destinatario: 'martin@ejemplo.com' } }),
    );
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, { recetas, elector });
    const plantillas = deps.plantillas as unknown as {
      repo: { buscarServible: ReturnType<typeof vi.fn> };
    };

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    expect(elector.consultar).toHaveBeenCalledTimes(1);
    expect(plantillas.repo.buscarServible).not.toHaveBeenCalled();
  });
});

describe('el prompt del elector no cambia por la existencia de plantillas', () => {
  /** Corre la tarea y devuelve la peticion EXACTA que se le mando al elector. */
  async function peticionDelElector(deps: (extra: Partial<TareaWebDeps>) => TareaWebDeps): Promise<string> {
    const recetas = makeRecetas(null, [makeReceta({ firmaObjetivo: 'otra-firma' })]);
    const elector = makeElector();
    await procesarTareaWeb(deps({ recetas, elector }), makeJob()).catch(() => undefined);
    return JSON.stringify(elector.consultar.mock.calls[0]?.[0].peticion);
  }

  it('la peticion es BYTE A BYTE identica con y sin plantillas disponibles', async () => {
    const sinPlantillas = await peticionDelElector((extra) => makeDeps(extra));
    const conUna = await peticionDelElector((extra) =>
      conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, extra),
    );
    expect(conUna).toBe(sinPlantillas);
  });

  it('con 25 tareas propias, el catalogo son las 20 primeras PROPIAS y ninguna plantilla', async () => {
    const catalogo = Array.from({ length: 25 }, (_, i) =>
      makeReceta({ id: `receta-${i}`, firmaObjetivo: `firma-${i}` }),
    );
    const recetas = makeRecetas(null, catalogo);
    const elector = makeElector();
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, { recetas, elector });

    await procesarTareaWeb(deps, makeJob()).catch(() => undefined);

    const usuario = elector.consultar.mock.calls[0]?.[0].peticion.usuario ?? '';
    const ofrecidas = JSON.parse(usuario.split('\n')[1] as string) as Array<{ id: string }>;
    expect(ofrecidas).toHaveLength(20);
    expect(ofrecidas.map((t) => t.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `receta-${i}`),
    );
  });
});

describe('aplicabilidad: falla cerrada y la tarea sigue por el motor libre', () => {
  it('una plantilla con un paso cuya clase NO esta corroborada no aplica', async () => {
    // El atlas de ESTE consumidor no corrobora el boton de envio.
    const deps = conPlantilla(pasosDeLaPlantilla(), [CLASE_DESTINATARIO, CLASE_ASUNTO, CLASE_CUERPO]);

    await correr(deps);

    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('FIXTURE HOSTIL: un paso EXTRA cuya clase no esta corroborada tumba la plantilla entera', async () => {
    // El paso intercalado crea un filtro de correo: irreversible EN EFECTO, invisible para los verbos
    // de accion bloqueada y ajeno al checkpoint que el usuario aprobaria. La UNICA barrera es la clase.
    const pasos = [
      pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', {
        tipo: 'parametro',
        parametro: 'destinatario',
      }),
      pasoClick(1, CLASE_FILTRO, 'Crear filtro'),
      pasoEscribir(2, CLASE_ASUNTO, 'Asunto', { tipo: 'parametro', parametro: 'asunto' }),
      pasoEscribir(3, CLASE_CUERPO, 'Cuerpo del mensaje', { tipo: 'parametro', parametro: 'cuerpo' }),
      pasoVerificar(4),
      pasoClick(5, CLASE_ENVIAR, 'Enviar'),
    ];
    const deps = conPlantilla(pasos);

    await correr(deps);

    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    const determinista = deps.determinista as unknown as {
      ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    };
    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
  });

  it('un dato que el objetivo del consumidor no declara (ranura) hace que no aplique', async () => {
    // La plantilla llena el asunto con una RANURA; el objetivo de este consumidor no declara asunto.
    const pasos = [
      pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', {
        tipo: 'parametro',
        parametro: 'destinatario',
      }),
      pasoEscribir(1, CLASE_ASUNTO, 'Asunto', { tipo: 'ranura', clase: CLASE_ASUNTO }),
      pasoVerificar(2),
      pasoClick(3, CLASE_ENVIAR, 'Enviar'),
    ];
    const deps = conPlantilla(pasos);

    await correr(deps, makeJob('envia un correo a martin@ejemplo.com'));

    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

});

describe('contencion: la plantilla aplica si sus marcadores caben en los que el objetivo declara', () => {
  /** Un procedimiento que solo exige destinatario y cuerpo (sin asunto). */
  function pasosSinAsunto(): unknown[] {
    return [
      pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', {
        tipo: 'parametro',
        parametro: 'destinatario',
      }),
      pasoEscribir(1, CLASE_CUERPO, 'Cuerpo del mensaje', { tipo: 'parametro', parametro: 'cuerpo' }),
      pasoVerificar(2),
      pasoClick(3, CLASE_ENVIAR, 'Enviar'),
    ];
  }

  it('el objetivo declara EXACTAMENTE lo que la plantilla pide: se sirve', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla());

    // El objetivo de siempre declara destinatario, asunto y cuerpo, que es lo que la plantilla exige.
    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('pausada');
    expect(deps.aprobaciones.crear).toHaveBeenCalled();
  });

  it('el objetivo declara DE MAS: se sirve igual (un dato de mas no puede esconderla)', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla());
    // El mismo pedido, mas un monto. Con la igualdad exacta la clave pasaba a ser
    // asunto+cuerpo+destinatario+monto y la plantilla no se encontraba nunca.
    const conMonto = makeJob(`${OBJETIVO} por 2,400 MXN`);

    const resultado = await procesarTareaWeb(deps, conMonto);

    expect(resultado).toBe('pausada');
    const plantillas = deps.plantillas as unknown as {
      repo: { buscarServible: ReturnType<typeof vi.fn> };
    };
    const clave = plantillas.repo.buscarServible.mock.calls[0]?.[0] as {
      marcadoresPosibles: string[];
    };
    // Los 16 subconjuntos de los cuatro datos declarados, con el de la plantilla entre ellos.
    expect(clave.marcadoresPosibles).toHaveLength(16);
    expect(clave.marcadoresPosibles).toContain('asunto+cuerpo+destinatario');
  });

  it('el objetivo declara DE MENOS: NO se sirve (la plantilla pide un dato que no hay)', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla());
    // Sin asunto ni cuerpo: la plantilla exige los tres y este objetivo trae uno.
    const soloDestinatario = makeJob('envia un correo a martin@ejemplo.com');

    await correr(deps, soloDestinatario);

    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('con dos candidatas gana LA MAS ESPECIFICA, y siempre la misma', async () => {
    // Las dos caben en lo que el objetivo declara (destinatario, asunto y cuerpo). La de tres
    // marcadores es la que mas cerca esta de lo pedido y la que deja menos campos sin llenar.
    const filas: FilaDePlantilla[] = [
      { id: 'plantilla-generica', estado: 'candidata', pasos: pasosSinAsunto(), origenes: 9 },
      { id: 'plantilla-especifica', estado: 'candidata', pasos: pasosDeLaPlantilla(), origenes: 2 },
    ];
    const deps = conPlantillas(filas);
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    const resultado = await procesarTareaWeb(
      yaDecidido(deps, aprobacionDelOfrecimiento()),
      makeJob(),
    );

    expect(resultado).toBe('completada');
    // Gana la de TRES marcadores aunque la otra tenga MAS origenes: la especificidad va primero.
    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-especifica', true);
  });

  it('el orden de las filas en la tabla no cambia cual gana', async () => {
    const conservadas: FilaDePlantilla[] = [
      { id: 'plantilla-especifica', estado: 'candidata', pasos: pasosDeLaPlantilla(), origenes: 2 },
      { id: 'plantilla-generica', estado: 'candidata', pasos: pasosSinAsunto(), origenes: 9 },
    ];
    const deps = conPlantillas(conservadas);
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    await procesarTareaWeb(yaDecidido(deps, aprobacionDelOfrecimiento()), makeJob());

    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-especifica', true);
  });
});

describe('el origen propio: solo excluye la plantilla que NADIE MAS descubrio', () => {
  const HASH_PROPIO = hashDeOrigenDePlantilla(OWNER, CLAVE_PLANTILLAS);

  it('SOLO YO entre los origenes: no se sirve (ya la tengo por mis propias recetas)', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, {}, [HASH_PROPIO]);
    const plantillas = deps.plantillas as unknown as {
      repo: { buscarServible: ReturnType<typeof vi.fn> };
    };

    await correr(deps);

    // Se consulto (la via propia no encontro nada) y la query la excluyo por su propio hash.
    expect(plantillas.repo.buscarServible).toHaveBeenCalledWith(
      expect.objectContaining({ origenHash: HASH_PROPIO }),
    );
    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
  });

  it('SOLO OTROS entre los origenes: se sirve', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, {}, [ORIGEN_AJENO]);

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('pausada');
    expect(deps.aprobaciones.crear).toHaveBeenCalled();
  });

  it('YO Y OTROS entre los origenes: se sirve (el caso que quedaba excluido para siempre)', async () => {
    // Es la fila medida en produccion: dos origenes distintos, las dos cuentas dentro. Con el
    // predicado viejo NINGUNA de las dos podia consumirla nunca, pese a que cada una tenia el aval
    // de la otra, y el lazo no se recuperaba solo (fallaba, publicaba, deduplicaba y volvia a fallar).
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, {}, [
      HASH_PROPIO,
      ORIGEN_AJENO,
    ]);

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('pausada');
    expect(deps.aprobaciones.crear).toHaveBeenCalled();
  });
});

describe('checkpoint obligatorio: sin aprobacion no se ejecuta un solo paso ajeno', () => {
  it('la plantilla que aplica se OFRECE y el job queda pausado, sin tocar la pagina', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla());

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('pausada');
    expect(deps.marcarJobPausado).toHaveBeenCalledWith('job-1');
    // EL TEXTO ES UN CODIGO DE LA PLATAFORMA: intencion, datos y dominio. Nada de la tabla.
    expect(deps.aprobaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        descripcion: `plantilla_compartida:enviar:asunto+cuerpo+destinatario:${DOMINIO}`,
        accionTipo: 'irreversible',
      }),
    );
    const determinista = deps.determinista as unknown as {
      ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    };
    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
  });

  it('si el checkpoint no se puede persistir, no se ofrece nada y la tarea la hace el motor', async () => {
    const deps = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, {
      aprobaciones: makeAprobacionesRepo({
        crear: vi.fn(async () => {
          throw new Error('base caida');
        }),
      }),
    });

    await correr(deps);

    expect(deps.marcarJobPausado).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('rechazado el ofrecimiento, la plantilla ni se busca y la tarea la hace el motor', async () => {
    const base = conPlantilla(pasosDeLaPlantilla());
    const deps = yaDecidido(base, aprobacionDelOfrecimiento('rechazada'));
    const plantillas = deps.plantillas as unknown as {
      repo: { buscarServible: ReturnType<typeof vi.fn> };
    };

    await correr(deps);

    expect(plantillas.repo.buscarServible).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe('ejecucion de la plantilla aprobada', () => {
  it('con efecto confirmado: completa la tarea, copia la receta propia y suma el exito', async () => {
    const recetas = makeRecetas();
    const base = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, { recetas });
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    // Cuatro primitivas: tres escrituras y el click final. El `verificar` no toca el navegador.
    const determinista = deps.determinista as unknown as {
      ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    };
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(4);
    // El motor libre NO corrio: la tarea entera salio del procedimiento compartido.
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
    // LA COPIA, con su origen propio.
    expect(recetas.promover).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER, dominio: DOMINIO, origen: 'plantilla_compartida' }),
    );
    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-1', true);
  });

  it('SIN efecto confirmado: NO se copia, se cuenta como fallo y la tarea no se reintenta', async () => {
    const recetas = makeRecetas();
    // El redactor sigue en la pagina despues del click: el efecto no se puede confirmar.
    const base = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, {
      recetas,
      navegador: makeNavegador(false),
    });
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    await expect(procesarTareaWeb(deps, makeJob())).rejects.toMatchObject({
      name: 'ACCION_SIN_EFECTO_CONFIRMADO',
    });

    expect(recetas.promover).not.toHaveBeenCalled();
    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-1', false);
  });

  it('un paso que no resuelve ABANDONA la plantilla y NO escala al modelo', async () => {
    const escalador = makeEscalador();
    // El primer paso no localiza su elemento NI con sus estrategias (intento 0) NI con la pista del
    // atlas (intento 1). Lo unico que quedaria seria escalar al modelo, y por aqui no se escala.
    const base = conPlantilla(pasosDeLaPlantilla(), CLASES_DEL_PROCEDIMIENTO, {
      escalador,
      determinista: makeDeterminista([0, 1]),
      navegador: makeNavegador(false),
    });
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    await correr(deps);

    // LA ASERCION CENTRAL: la escalada al modelo no ocurre por este camino.
    expect(escalador.ejecutarPasoConModelo).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-1', false);
  });

  it('FIXTURE HOSTIL: el paso final apunta a otro control y la barrera lo bloquea antes de accionar', async () => {
    // La clase esta CORROBORADA (el atlas la conoce) y el DOM lleva ese mismo nombre: lo que no
    // corresponde es el VERBO. Es exactamente lo que la barrera de identidad existe para atrapar.
    const pasos = [
      pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', {
        tipo: 'parametro',
        parametro: 'destinatario',
      }),
      pasoEscribir(1, CLASE_ASUNTO, 'Asunto', { tipo: 'parametro', parametro: 'asunto' }),
      pasoEscribir(2, CLASE_CUERPO, 'Cuerpo del mensaje', { tipo: 'parametro', parametro: 'cuerpo' }),
      pasoVerificar(3),
      pasoClick(4, CLASE_ELIMINAR, 'Eliminar definitivamente'),
    ];
    const determinista = makeDeterminista([], 'Eliminar definitivamente');
    const base = conPlantilla(
      pasos,
      [CLASE_DESTINATARIO, CLASE_ASUNTO, CLASE_CUERPO, CLASE_ELIMINAR],
      { determinista, navegador: makeNavegador(false) },
    );
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());

    await correr(deps);

    // Las tres escrituras corrieron; el click NUNCA llego al navegador. La cuarta primitiva es la
    // renavegacion al inicio, que es como se le entrega la pagina limpia al motor.
    const acciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (llamada) => (llamada[1] as InstruccionDePaso).accion,
    );
    expect(acciones.filter((accion) => accion === 'escribir')).toHaveLength(3);
    expect(acciones).not.toContain('click');
    // La barrera corre en modo ACTIVO por este camino aunque el default global sea 'observacion':
    // los deps no traen `barreraIdentidad`, y aun asi bloqueo.
    expect(deps.barreraIdentidad).toBeUndefined();
    // La tarea la termina el motor libre, que era la linea base.
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });
});
