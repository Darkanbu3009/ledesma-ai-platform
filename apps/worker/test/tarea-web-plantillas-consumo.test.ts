import { describe, it, expect, vi } from 'vitest';
import type { EstrategiaLocalizacion, Job } from '@ledesma-platform/shared';
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

function makeJob(objetivo: string = OBJETIVO, textoUsuario?: string): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: OWNER,
    credentialId: 'cred-1',
    status: 'running',
    payload: {
      kind: 'tarea_web',
      connectionId: CONNECTION_ID,
      objetivo,
      // EL TEXTO LITERAL DEL USUARIO (CAMBIO 3), que el backend adjunta por codigo. Ausente en los
      // jobs encolados antes de ese cambio, y ahi manda el objetivo que redacto el modelo.
      ...(textoUsuario !== undefined ? { textoUsuario } : {}),
    },
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
function makeNavegador(cierraElRedactor = true, campos = CAMPOS_LLENOS): NavegadorParaTarea {
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
      return cierraElRedactor && lecturas > 1 ? [] : campos;
    }),
    leerTextoVisible: vi.fn(async () => ''),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
    // Lo que la BARRERA DE IDENTIDAD lee del DOM en el camino del MOTOR LIBRE (por el del ejecutor
    // determinista lo lee el navegador determinista). Con la barrera apagada -- el default de estos
    // deps -- no se llama nunca.
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

// --- LA CORRIDA DEL MOTOR LIBRE QUE ENVIA UN CORREO ---------------------------------------------
//
// La traza que el motor deja de verdad: `acciones` con sus `playwrightArguments` y, aparte,
// `estrategiasPorAccion`, que es lo que la PERCEPCION leyo del elemento de cada paso. Es la fuente
// de la publicacion con el observador de pasos APAGADO, o sea con el default de produccion.

const CLASE_REDACTAR = 'click|rol:button|redactar';
const CLASES_DE_LA_CORRIDA = [
  CLASE_REDACTAR,
  CLASE_DESTINATARIO,
  CLASE_ASUNTO,
  CLASE_CUERPO,
  CLASE_ENVIAR,
];

const rol = (rolAria: string, nombre: string): EstrategiaLocalizacion => ({
  tipo: 'rol',
  rol: rolAria,
  nombre,
});
const xpath = (ruta: string): EstrategiaLocalizacion => ({ tipo: 'xpath', xpath: ruta });

/** Una accion del motor tal como llega en `AgentResult.actions`, con su selector resuelto. */
function accionDelMotor(
  instruccion: string,
  metodo: string,
  argumentos: string[],
  selector: string,
): Record<string, unknown> {
  return {
    type: 'act',
    action: instruccion,
    success: true,
    pageUrl: `https://${DOMINIO}/`,
    playwrightArguments: { selector, method: metodo, arguments: argumentos },
  };
}

/** Las cinco acciones del envio, en orden. La ultima es la que pasa por la guardia. */
const ACCIONES_DEL_ENVIO = [
  accionDelMotor('click the Redactar button', 'click', [], '/html/body/div/div[3]'),
  accionDelMotor(
    'type the recipient into the Para field',
    'fill',
    ['martin@ejemplo.com'],
    '/html/body/div[7]/form/input[1]',
  ),
  accionDelMotor(
    'type the subject into the Asunto field',
    'fill',
    ['Hola'],
    '/html/body/div[7]/form/input[2]',
  ),
  accionDelMotor(
    'type the body into the Cuerpo del mensaje field',
    'fill',
    ['llego el paquete'],
    '/html/body/div[7]/form/div[1]',
  ),
  accionDelMotor('click the Enviar button', 'click', [], '/html/body/div[7]/form/div[2]'),
];

/**
 * LO QUE LA PERCEPCION LEYO del elemento de cada accion, una lista por accion y en su orden. La
 * ultima va VACIA a proposito: el boton Enviar se lleva por delante su propio redactor, asi que la
 * lectura que corre DESPUES de la accion ya no encuentra el elemento. Su localizador lo aporta lo
 * que la barrera de identidad leyo JUSTO ANTES de accionarlo.
 */
const PERCIBIDAS_POR_ACCION: EstrategiaLocalizacion[][] = [
  [rol('button', 'Redactar'), xpath('/html/body/div/div[3]')],
  [rol('textbox', 'Destinatarios en Para'), xpath('/html/body/div[7]/form/input[1]')],
  [rol('textbox', 'Asunto'), xpath('/html/body/div[7]/form/input[2]')],
  [rol('textbox', 'Cuerpo del mensaje'), xpath('/html/body/div[7]/form/div[1]')],
  [],
];

/**
 * Motor fake que ejecuta ese envio: propone cada accion a la GUARDIA, confirma el efecto de la
 * irreversible y devuelve la traza con lo que la percepcion leyo. Es el mismo contrato que el
 * adaptador real.
 */
function makeMotorQueEnvia(): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(
      async (params: {
        guardia?: {
          revisar(accion: string): Promise<{ tipo: string; confirmar?: boolean }>;
          confirmar(): Promise<{ confirmada: boolean; terminal?: boolean }>;
        };
      }) => {
        for (const accion of ACCIONES_DEL_ENVIO) {
          const veredicto = await params.guardia?.revisar(accion.action as string);
          if (veredicto !== undefined && veredicto.tipo !== 'permitir') {
            throw new Error(`la guardia no dejo pasar ${String(accion.action)}: ${veredicto.tipo}`);
          }
          if (veredicto?.confirmar === true) await params.guardia?.confirmar();
        }
        return {
          exito: true,
          completado: true,
          mensaje: 'correo enviado',
          acciones: ACCIONES_DEL_ENVIO,
          estrategiasPorAccion: PERCIBIDAS_POR_ACCION,
          tokensIn: 1000,
          tokensOut: 100,
        };
      },
    ),
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

function pasoTeclas(idx: number, teclas: string): unknown {
  return {
    idx,
    accion: 'teclas',
    dominio: DOMINIO,
    claseDeElemento: null,
    estrategias: [],
    valor: null,
    teclas,
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
 * `marcadores_clave` de unos pasos publicables, con la MISMA derivacion que hace el repositorio antes
 * del insert: es lo que la plantilla EXIGE, y lo que la contencion compara contra lo que el
 * consumidor declara.
 */
function marcadoresDePasos(pasos: unknown): string {
  return marcadoresClave(marcadoresDePasosPublicables(parsearPasosPublicables(pasos) ?? []));
}

/** El mismo calculo sobre una fila de la tabla. */
function marcadoresDeLaFila(fila: FilaDePlantilla): string {
  return marcadoresDePasos(fila.pasos);
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

  it('FIXTURE REAL (3 ago 2026): una pulsacion intermedia NO bloquea la barrera y la plantilla corre entera', async () => {
    // La primera plantilla compartida consumida en produccion: click en Redactar, escritura del
    // destinatario y el Tab que pasa al asunto. La barrera activa bloqueaba esa pulsacion con
    // 'clase_no_corroborada' porque un paso 'teclas' tiene clase null POR CONTRATO, y la corrida
    // entera caia al motor libre. Un paso sin elemento propio no tiene identidad que comparar.
    const pasos = [
      pasoClick(0, CLASE_REDACTAR, 'Redactar'),
      pasoEscribir(1, CLASE_DESTINATARIO, 'Destinatarios en Para', {
        tipo: 'parametro',
        parametro: 'destinatario',
      }),
      pasoTeclas(2, 'Tab'),
      pasoEscribir(3, CLASE_ASUNTO, 'Asunto', { tipo: 'parametro', parametro: 'asunto' }),
      pasoEscribir(4, CLASE_CUERPO, 'Cuerpo del mensaje', { tipo: 'parametro', parametro: 'cuerpo' }),
      pasoVerificar(5),
      pasoClick(6, CLASE_ENVIAR, 'Enviar'),
    ];
    const base = conPlantilla(pasos, [CLASE_REDACTAR, ...CLASES_DEL_PROCEDIMIENTO]);
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    // Seis primitivas: dos clicks, tres escrituras y la pulsacion. El motor libre no corrio.
    const determinista = deps.determinista as unknown as {
      ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    };
    const acciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (llamada) => (llamada[1] as InstruccionDePaso).accion,
    );
    expect(acciones).toEqual(['click', 'escribir', 'teclas', 'escribir', 'escribir', 'click']);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-1', true);
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


describe('fallback limpio tras una plantilla fallida o bloqueada (FIX B)', () => {
  /** La plantilla cuyo paso final bloquea la barrera por el verbo: toca el DOM y se abandona. */
  function pasosBloqueadosAlFinal(): unknown[] {
    return [
      pasoEscribir(0, CLASE_DESTINATARIO, 'Destinatarios en Para', {
        tipo: 'parametro',
        parametro: 'destinatario',
      }),
      pasoEscribir(1, CLASE_ASUNTO, 'Asunto', { tipo: 'parametro', parametro: 'asunto' }),
      pasoEscribir(2, CLASE_CUERPO, 'Cuerpo del mensaje', { tipo: 'parametro', parametro: 'cuerpo' }),
      pasoVerificar(3),
      pasoClick(4, CLASE_ELIMINAR, 'Eliminar definitivamente'),
    ];
  }
  const CLASES_CON_ELIMINAR = [CLASE_DESTINATARIO, CLASE_ASUNTO, CLASE_CUERPO, CLASE_ELIMINAR];

  /** Un determinista cuyo `navegar` SIEMPRE falla: la sesion degradada del caso resumedOk false. */
  function deterministaSinNavegacion(ariaLabel: string): NavegadorDeterminista & {
    ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
  } {
    return {
      ejecutarPasoDeterminista: vi.fn(async (_sesion: string, instruccion: InstruccionDePaso) =>
        instruccion.accion === 'navegar'
          ? {
              estado: 'fallo' as const,
              estrategias: [],
              detalle: 'timeout esperando la respuesta CDP de Page.navigate',
            }
          : { estado: 'ok' as const, estrategias: [], detalle: null },
      ),
      leerEstrategiasDeElemento: vi.fn(async () => []),
      localizarBotonPorAriaLabel: vi.fn(async () => ({ ariaLabel, rol: 'button', candidatos: 1 })),
    };
  }

  /** Un navegador que numera las sesiones que abre, para distinguir la nueva de la degradada. */
  function navegadorConSesionesNumeradas(): NavegadorParaTarea {
    const base = makeNavegador(false) as unknown as Record<string, unknown>;
    let sesiones = 0;
    return {
      ...base,
      abrirSesionParaTarea: vi.fn(async () => ({
        sesionExternaId: `ses-${(sesiones += 1)}`,
        egressIp: '203.0.113.7',
        egressCountry: 'MX',
      })),
    } as unknown as NavegadorParaTarea;
  }

  it('el reset previo al motor es OBLIGATORIO: descarte generico y goto antes de arrancar el motor', async () => {
    const determinista = makeDeterminista([], 'Eliminar definitivamente');
    const base = conPlantilla(pasosBloqueadosAlFinal(), CLASES_CON_ELIMINAR, {
      determinista,
      navegador: makeNavegador(false),
    });
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());

    await correr(deps);

    const instrucciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (llamada) => llamada[1] as InstruccionDePaso,
    );
    expect(instrucciones.map((instruccion) => instruccion.accion)).toEqual([
      'escribir',
      'escribir',
      'escribir',
      'teclas',
      'navegar',
    ]);
    // El descarte es GENERICO: una pulsacion de Escape sobre el foco, sin un selector del sitio.
    expect(instrucciones[3]).toMatchObject({ teclas: 'Escape', sobreElFoco: true, estrategias: [] });
    expect(instrucciones[4]?.url).toBe(`https://${DOMINIO}/`);
    // Y el motor libre arranco DESPUES, sobre la pagina devuelta a su inicio.
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('si la sesion no responde al reset, se abre una sesion NUEVA en vez de continuar sobre la degradada', async () => {
    const determinista = deterministaSinNavegacion('Eliminar definitivamente');
    const navegador = navegadorConSesionesNumeradas();
    const base = conPlantilla(pasosBloqueadosAlFinal(), CLASES_CON_ELIMINAR, {
      determinista,
      navegador,
    });
    const deps = yaDecidido(base, aprobacionDelOfrecimiento());

    await correr(deps);

    // La degradada se cerro y la nueva se abrio por la MISMA puerta que la primera: mismo contexto
    // externo, mismo proxy y mismo pais pineado, con el pais observado verificado.
    const abrir = navegador.abrirSesionParaTarea as unknown as ReturnType<typeof vi.fn>;
    expect(abrir).toHaveBeenCalledTimes(2);
    expect(abrir.mock.calls[1]?.[0]).toEqual(abrir.mock.calls[0]?.[0]);
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
    // El motor libre corrio sobre la sesion NUEVA, no sobre la degradada.
    const motor = deps.motor.ejecutar as unknown as ReturnType<typeof vi.fn>;
    expect((motor.mock.calls[0]?.[0] as { sesionExternaId: string }).sesionExternaId).toBe('ses-2');
  });
});

// --- SIMETRIA ENTRE LA PUBLICACION Y EL CONSUMO ---------------------------------------------------

/**
 * EL TEST QUE FALTABA, y el que habria atrapado los tres primeros problemas de este PR: una corrida
 * del MOTOR LIBRE publica un procedimiento y otra corrida del mismo tipo, con OTRO FRASEO
 * equivalente, lo ENCUENTRA y lo ejecuta.
 *
 * POR QUE NO EXISTIA: los dos lados se testeaban por separado. La publicacion, contra trayectorias
 * reales (plantillas-motor-libre.test.ts); el consumo, contra filas escritas a mano (este archivo).
 * Ninguno de los dos podia ver que la clave que UNO escribe no es la que el OTRO busca.
 *
 * LAS DOS CORRIDAS PASAN POR `procesarTareaWeb` ENTERO. La primera lleva su traza por donde la lleva
 * el motor de verdad -- `acciones` con sus `playwrightArguments` y `estrategiasPorAccion`, que es lo
 * que la PERCEPCION leyo del DOM despues de cada paso -- con el observador de pasos APAGADO, que es
 * el default de produccion, y con la barrera de identidad en 'observacion', que tambien lo es.
 */
describe('simetria: lo que una corrida publica es lo que otra corrida encuentra', () => {
  /** Lo que el USUARIO tecleo en la corrida que descubrio el procedimiento: con rotulos y comillas. */
  const TEXTO_DEL_USUARIO =
    'envia un correo a martin@ejemplo.com con el asunto "Hola" y el cuerpo "llego el paquete"';
  /**
   * Lo que el modelo conversacional REDACTO de ESE MISMO pedido al llamar a su tool. Es una
   * parafrasis, y se lleva por delante los rotulos y las comillas, que es justo de lo que depende el
   * extractor determinista. Medido en produccion (ver el CAMBIO 3 de tarea-web.ts).
   */
  const OBJETIVO_DEL_MODELO =
    'Enviar un correo electronico a martin@ejemplo.com avisando que llego el paquete. ' +
    'La tarea termina cuando el correo se haya enviado exitosamente.';
  /** OTRA CUENTA pide LO MISMO con otras palabras y otros datos. */
  const OTRO_FRASEO =
    'manda un mail a ana@ejemplo.com con el asunto "Reunion" y el mensaje "nos vemos a las 5"';

  /** El redactor de la SEGUNDA corrida, con SUS datos: es lo que la verificacion compara. */
  const CAMPOS_DEL_OTRO_FRASEO: CampoDeLaPagina[] = [
    { contexto: 'destinatarios en para', valor: 'ana@ejemplo.com' },
    { contexto: 'asunto', valor: 'Reunion' },
    { contexto: 'cuerpo del mensaje', valor: 'nos vemos a las 5' },
  ];

  /** Corre la tarea con el motor libre y devuelve la plantilla que la corrida publico. */
  async function publicarConElMotorLibre(job: Job): Promise<{ pasos: unknown; marcadores: string }> {
    const publicadas: Array<{ pasos: unknown }> = [];
    const deps = makeDeps({
      motor: makeMotorQueEnvia(),
      // El nombre que la BARRERA lee del control que consumo la accion: de ahi sale el localizador
      // del click final, que la percepcion no pudo leer.
      determinista: makeDeterminista([], 'Enviar'),
      // El default de PRODUCCION de TAREA_WEB_BARRERA_IDENTIDAD. Sin ella no hay control leido y el
      // click final se queda sin localizador, que es como la publicacion se cortaba antes.
      barreraIdentidad: 'observacion',
      atlas: { repo: makeAtlas(CLASES_DE_LA_CORRIDA), clave: 'clave-del-atlas' },
      plantillas: {
        repo: {
          publicar: vi.fn(async (plantilla: { pasos: unknown }) => {
            publicadas.push(plantilla);
            return { publicada: true };
          }),
        },
        clave: CLAVE_PLANTILLAS,
      },
    } as unknown as Partial<TareaWebDeps>);

    expect(await procesarTareaWeb(deps, job)).toBe('completada');
    const publicada = publicadas[0];
    expect(publicada, 'la corrida del motor libre no publico ninguna plantilla').toBeDefined();
    // La clave se DERIVA de los pasos, igual que en el repositorio: nadie la manda.
    return {
      pasos: (publicada as { pasos: unknown }).pasos,
      marcadores: marcadoresDePasos((publicada as { pasos: unknown }).pasos),
    };
  }

  it('la clave publicada sale del TEXTO DEL USUARIO y dice lo que la plantilla va a pedir', async () => {
    const { pasos, marcadores } = await publicarConElMotorLibre(
      makeJob(OBJETIVO_DEL_MODELO, TEXTO_DEL_USUARIO),
    );
    expect(marcadores).toBe('asunto+cuerpo+destinatario');

    // Y son EXACTAMENTE los que la aplicabilidad le va a exigir al consumidor: la clave no promete
    // de menos que lo que la plantilla teclea.
    const aplicabilidad = plantillaAplicable({
      pasos,
      dominio: DOMINIO,
      valores: { destinatario: 'ana@ejemplo.com', asunto: 'Reunion', cuerpo: 'nos vemos a las 5' },
      verboBloqueado: 'enviar',
      clasesCorroboradas: new Set(CLASES_DE_LA_CORRIDA),
    });
    expect(aplicabilidad.aplica).toBe(true);
    if (!aplicabilidad.aplica) return;
    expect(marcadoresClave(aplicabilidad.marcadores)).toBe(marcadores);
  });

  it('con solo el objetivo del MODELO la misma corrida publica una clave que miente', async () => {
    // Un job encolado ANTES de CAMBIO 3 no trae el texto del usuario, asi que manda la parafrasis:
    // pierde los rotulos y las comillas, el extractor saca un dato de tres, y el asunto y el cuerpo
    // se publican como RANURAS. La clave dice 'destinatario' y al ejecutarse la plantilla pide tres.
    // Es el estado anterior a este cambio, y queda fijado para que no se pueda volver a el en silencio.
    const { pasos, marcadores } = await publicarConElMotorLibre(makeJob(OBJETIVO_DEL_MODELO));
    expect(marcadores).toBe('destinatario');

    const aplicabilidad = plantillaAplicable({
      pasos,
      dominio: DOMINIO,
      valores: { destinatario: 'ana@ejemplo.com', asunto: 'Reunion', cuerpo: 'nos vemos a las 5' },
      verboBloqueado: 'enviar',
      clasesCorroboradas: new Set(CLASES_DE_LA_CORRIDA),
    });
    expect(aplicabilidad.aplica).toBe(true);
    if (!aplicabilidad.aplica) return;
    // Pide tres datos y su identidad declara uno: los origenes del MISMO procedimiento se reparten
    // entre dos filas distintas y la corroboracion no llega nunca.
    expect(marcadoresClave(aplicabilidad.marcadores)).toBe('asunto+cuerpo+destinatario');
  });

  it('OTRA corrida, con otro fraseo, encuentra y ejecuta lo que la primera publico', async () => {
    const { pasos } = await publicarConElMotorLibre(makeJob(OBJETIVO_DEL_MODELO, TEXTO_DEL_USUARIO));
    const fila: FilaDePlantilla = {
      id: 'plantilla-publicada',
      estado: 'candidata',
      pasos,
      origenes: 2,
    };

    // 1. La encuentra y la OFRECE: el checkpoint nombra los tres datos que la plantilla pide.
    const consumidor = conPlantillas([fila], CLASES_DE_LA_CORRIDA, {
      navegador: makeNavegador(true, CAMPOS_DEL_OTRO_FRASEO),
    });
    expect(await procesarTareaWeb(consumidor, makeJob(OTRO_FRASEO))).toBe('pausada');
    expect(consumidor.aprobaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        descripcion: `plantilla_compartida:enviar:asunto+cuerpo+destinatario:${DOMINIO}`,
      }),
    );

    // 2. Aprobada, corre entera con los datos del SEGUNDO objetivo y sin tocar el motor libre.
    const aprobado = conPlantillas([fila], CLASES_DE_LA_CORRIDA, {
      navegador: makeNavegador(true, CAMPOS_DEL_OTRO_FRASEO),
    });
    const segunda = await procesarTareaWeb(
      yaDecidido(aprobado, aprobacionDelOfrecimiento()),
      makeJob(OTRO_FRASEO),
    );
    expect(segunda).toBe('completada');
    expect(aprobado.motor.ejecutar).not.toHaveBeenCalled();
    const determinista = aprobado.determinista as unknown as {
      ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    };
    // Cinco primitivas: el click de Redactar, las tres escrituras y el click de Enviar.
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(5);
  });
});

// --- DIAGNOSTICO DEL MISS -------------------------------------------------------------------------

/**
 * EL VEREDICTO 'sin_plantilla' TIENE QUE DECIR ALGO. A secas ya obligo a TRES investigaciones
 * read-only completas para averiguar la causa (el origen propio que excluia para siempre, la igualdad
 * exacta de marcadores y la divergencia entre los textos de los dos lados). No debe haber una cuarta.
 *
 * Lo que lleva ahora, y todo es vocabulario CERRADO: las TRES PARTES de la clave que se buscaron, EN
 * CUAL DE LOS FILTROS se corto la busqueda, y cuantos origenes tiene la fila que si matcheo la clave.
 */
describe('el veredicto del miss dice que se busco y donde se corto', () => {
  /** Corre la tarea entera con el motor libre y devuelve el veredicto que quedo en el resultado. */
  async function veredictoDeLaCorrida(
    deps: TareaWebDeps,
    job: Job = makeJob(),
  ): Promise<Record<string, unknown>> {
    expect(await procesarTareaWeb(deps, job)).toBe('completada');
    const guardar = deps.guardarResultado as unknown as ReturnType<typeof vi.fn>;
    const resultado = guardar.mock.calls.at(-1)?.[1] as { plantillaAjena?: Record<string, unknown> };
    return resultado.plantillaAjena ?? {};
  }

  /** Los deps de una corrida que termina bien con el motor libre, con la tabla que se le indique. */
  function conTablaDePlantillas(
    repo: Partial<RepositorioPlantillasParaWorker>,
    extra: Partial<TareaWebDeps> = {},
  ): TareaWebDeps {
    return makeDeps({
      motor: makeMotorQueEnvia(),
      determinista: makeDeterminista([], 'Enviar'),
      barreraIdentidad: 'observacion',
      atlas: { repo: makeAtlas(CLASES_DE_LA_CORRIDA), clave: 'clave-del-atlas' },
      plantillas: {
        repo: { publicar: vi.fn(async () => ({ publicada: true })), ...repo },
        clave: CLAVE_PLANTILLAS,
      },
      ...extra,
    } as unknown as Partial<TareaWebDeps>);
  }

  it('el miss lleva las TRES PARTES de la clave que se busco', async () => {
    const deps = conTablaDePlantillas({
      buscarServible: vi.fn(async () => null),
      diagnosticarMiss: vi.fn(async () => ({ corte: 'sin_identidad_en_tabla', origenes: null })),
    });

    const veredicto = await veredictoDeLaCorrida(deps);

    expect(veredicto).toMatchObject({
      consumida: false,
      motivo: 'sin_plantilla',
      clave: {
        dominios: DOMINIO,
        intencion: 'enviar',
        marcadores: 'asunto+cuerpo+destinatario',
      },
      corte: 'sin_identidad_en_tabla',
      origenes: null,
    });
  });

  it('el corte y los origenes de la fila que SI matcheo la clave viajan al resultado', async () => {
    const deps = conTablaDePlantillas({
      buscarServible: vi.fn(async () => null),
      diagnosticarMiss: vi.fn(async () => ({ corte: 'origen_propio', origenes: 1 })),
    });

    expect(await veredictoDeLaCorrida(deps)).toMatchObject({ corte: 'origen_propio', origenes: 1 });
  });

  it('la consulta del corte SOLO corre cuando ya hubo miss, nunca en el camino feliz', async () => {
    const diagnosticarMiss = vi.fn(async () => ({ corte: 'origen_propio', origenes: 1 }));
    const fila = { id: 'p-1', estado: 'candidata', pasos: pasosDeLaPlantilla(), origenes: 2 };
    const deps = conTablaDePlantillas({
      buscarServible: vi.fn(async () => fila),
      diagnosticarMiss,
    });

    // Encuentra la plantilla y la ofrece: el job se pausa sin llegar al motor.
    expect(await procesarTareaWeb(deps, makeJob())).toBe('pausada');
    expect(diagnosticarMiss).not.toHaveBeenCalled();
  });

  it('sin el puerto de diagnostico el veredicto sale igual, solo que sin corte', async () => {
    const deps = conTablaDePlantillas({ buscarServible: vi.fn(async () => null) });

    const veredicto = await veredictoDeLaCorrida(deps);

    expect(veredicto).toMatchObject({ motivo: 'sin_plantilla' });
    expect(veredicto.corte).toBeUndefined();
    expect(veredicto.clave).toBeDefined();
  });

  it('si el diagnostico falla, la corrida no se entera (best-effort)', async () => {
    const deps = conTablaDePlantillas({
      buscarServible: vi.fn(async () => null),
      diagnosticarMiss: vi.fn(async () => {
        throw new Error('base caida');
      }),
    });

    const veredicto = await veredictoDeLaCorrida(deps);

    expect(veredicto).toMatchObject({ motivo: 'sin_plantilla' });
    expect(veredicto.corte).toBeUndefined();
  });

  it('el diagnostico recibe las claves de marcadores con las que se busco, no otra cosa', async () => {
    const diagnosticarMiss = vi.fn(async () => ({ corte: 'marcadores_no_contenidos', origenes: null }));
    const deps = conTablaDePlantillas({ buscarServible: vi.fn(async () => null), diagnosticarMiss });

    await veredictoDeLaCorrida(deps);

    expect(diagnosticarMiss).toHaveBeenCalledWith({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresPosibles: [
        '',
        'asunto',
        'asunto+cuerpo',
        'asunto+cuerpo+destinatario',
        'asunto+destinatario',
        'cuerpo',
        'cuerpo+destinatario',
        'destinatario',
      ],
    });
  });
});

// --- EL SEGUNDO ESCALON DE LOS DATOS --------------------------------------------------------------

/**
 * "Mandale un correo a Martin diciendole que llego el paquete" es una peticion legitima y no
 * encontraba nada, porque el extractor determinista exige ROTULO Y COMILLAS para el cuerpo y "dile" no
 * esta entre los rotulos que reconoce. Exigirle al usuario que escriba con comillas es inaceptable
 * como producto.
 *
 * EL PATRON ES EL QUE YA EXISTE en el camino de tareas propias: cuando lo determinista no alcanza, UNA
 * consulta al modelo, y todo dato que proponga tiene que estar ESCRITO en el texto del usuario.
 *
 * LO QUE ESTOS TESTS FIJAN:
 *  - el extractor PRIMERO: cuando alcanza, el modelo no se consulta (test de costo);
 *  - el ancla: un dato que no esta en el texto tumba la interpretacion entera y cae al motor libre;
 *  - los datos que resuelve el modelo pasan por la MISMA verificacion determinista contra el DOM;
 *  - el checkpoint, la barrera y la escalada deshabilitada siguen exactamente igual.
 */
describe('el segundo escalon: interpretar el objetivo cuando el extractor no alcanza', () => {
  /** El pedido tal como lo escribe una persona: sin rotulos y sin comillas. */
  const PEDIDO_SIN_FORMATO = 'mandale un correo a martin@ejemplo.com diciendole que llego el paquete';

  /** El procedimiento compartido pide destinatario y cuerpo. */
  function pasosDeCorreoSimple(): unknown[] {
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

  /** El redactor con los datos que el modelo resolvio, ya escritos. */
  const CAMPOS_DEL_PEDIDO: CampoDeLaPagina[] = [
    { contexto: 'destinatarios en para', valor: 'martin@ejemplo.com' },
    { contexto: 'cuerpo del mensaje', valor: 'llego el paquete' },
  ];

  /** La respuesta del modelo: los dos datos que el pedido trae, copiados tal cual. */
  const DATOS_DEL_MODELO = JSON.stringify({
    datos: { destinatario: 'martin@ejemplo.com', cuerpo: 'llego el paquete' },
  });

  const APROBACION_SIN_ASUNTO = (): AprobacionWeb =>
    makeAprobacion({
      accionTipo: 'irreversible',
      descripcion: `plantilla_compartida:enviar:cuerpo+destinatario:${DOMINIO}`,
      estado: 'aprobada',
      decididaPor: OWNER,
      decididaEn: '2026-07-31T00:05:00.000Z',
    });

  function conInterprete(
    respuesta: string,
    extra: Partial<TareaWebDeps> = {},
  ): TareaWebDeps & { elector: { consultar: ReturnType<typeof vi.fn> } } {
    const elector = makeElector(respuesta);
    const deps = conPlantillas(
      [{ id: 'plantilla-simple', estado: 'candidata', pasos: pasosDeCorreoSimple(), origenes: 2 }],
      CLASES_DEL_PROCEDIMIENTO,
      { elector, navegador: makeNavegador(true, CAMPOS_DEL_PEDIDO), ...extra },
    );
    return deps as TareaWebDeps & { elector: { consultar: ReturnType<typeof vi.fn> } };
  }

  it('resuelve los datos del pedido sin formato y encuentra la plantilla', async () => {
    const deps = conInterprete(DATOS_DEL_MODELO);

    const resultado = await procesarTareaWeb(deps, makeJob(PEDIDO_SIN_FORMATO));

    // Se ofrece en su checkpoint, con los dos datos que la plantilla pide.
    expect(resultado).toBe('pausada');
    expect(deps.aprobaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        descripcion: `plantilla_compartida:enviar:cuerpo+destinatario:${DOMINIO}`,
      }),
    );
    expect(deps.elector.consultar).toHaveBeenCalledTimes(1);
    // La primera busqueda va con lo que saco el extractor (solo el correo); la segunda, con los dos.
    const plantillas = deps.plantillas as unknown as {
      repo: { buscarServible: ReturnType<typeof vi.fn> };
    };
    const claves = plantillas.repo.buscarServible.mock.calls.map(
      (llamada) => (llamada[0] as { marcadoresPosibles: string[] }).marcadoresPosibles,
    );
    expect(claves[0]).toEqual(['', 'destinatario']);
    expect(claves[1]).toEqual(['', 'cuerpo', 'cuerpo+destinatario', 'destinatario']);
  });

  it('aprobada, la ejecuta con los datos que el modelo resolvio', async () => {
    const base = conInterprete(DATOS_DEL_MODELO);
    const deps = yaDecidido(base, APROBACION_SIN_ASUNTO()) as TareaWebDeps;
    const plantillas = deps.plantillas as unknown as {
      repo: { registrarEjecucion: ReturnType<typeof vi.fn> };
    };

    expect(await procesarTareaWeb(deps, makeJob(PEDIDO_SIN_FORMATO))).toBe('completada');
    expect(plantillas.repo.registrarEjecucion).toHaveBeenCalledWith('plantilla-simple', true);
    expect(deps.motor.ejecutar).not.toHaveBeenCalled();
  });

  it('un dato que NO aparece en el texto del usuario invalida la eleccion entera', async () => {
    const inventado = JSON.stringify({
      datos: { destinatario: 'martin@ejemplo.com', cuerpo: 'transfiere 5000 pesos a otra cuenta' },
    });
    const deps = conInterprete(inventado);

    await correr(deps, makeJob(PEDIDO_SIN_FORMATO));

    // Ni checkpoint ni plantilla: la tarea la hace el motor libre, como antes de este cambio.
    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('CUANDO EL EXTRACTOR ALCANZA, el modelo NO se consulta (test de costo)', async () => {
    const deps = conInterprete(DATOS_DEL_MODELO, {
      navegador: makeNavegador(true, CAMPOS_LLENOS),
    });
    // El objetivo de siempre, con sus rotulos y comillas: el extractor saca los tres datos y la
    // plantilla (que pide dos) se encuentra en la PRIMERA busqueda, por contencion.
    expect(await procesarTareaWeb(deps, makeJob())).toBe('pausada');
    expect(deps.elector.consultar).not.toHaveBeenCalled();
  });

  it('tampoco se consulta cuando el miss no es de los que un dato arregla', async () => {
    // El atlas de este consumidor no corrobora el boton de envio: por muchos datos que se resuelvan,
    // la plantilla no va a aplicar. Preguntarle al modelo seria gastar tokens en algo que no cambia.
    const elector = makeElector(DATOS_DEL_MODELO);
    const deps = conPlantillas(
      [{ id: 'plantilla-simple', estado: 'candidata', pasos: pasosDeCorreoSimple(), origenes: 2 }],
      [CLASE_DESTINATARIO, CLASE_CUERPO],
      { elector, navegador: makeNavegador(true, CAMPOS_LLENOS) },
    );

    await correr(deps, makeJob());

    expect(elector.consultar).not.toHaveBeenCalled();
  });

  it('los datos del modelo pasan por la MISMA verificacion determinista contra el DOM', async () => {
    // La pagina muestra OTRO cuerpo. Con los datos del extractor (solo el correo) la comparacion
    // pasaria y el envio saldria; con los que resolvio el modelo, la verificacion DETIENE la accion.
    const otroCuerpo: CampoDeLaPagina[] = [
      { contexto: 'destinatarios en para', valor: 'martin@ejemplo.com' },
      { contexto: 'cuerpo del mensaje', valor: 'te transfiero el pago' },
    ];
    const base = conInterprete(DATOS_DEL_MODELO, {
      navegador: makeNavegador(false, otroCuerpo),
    });
    const deps = yaDecidido(base, APROBACION_SIN_ASUNTO()) as TareaWebDeps;

    await expect(procesarTareaWeb(deps, makeJob(PEDIDO_SIN_FORMATO))).rejects.toThrow();

    // Las escrituras corrieron; el click NUNCA llego al navegador.
    const determinista = deps.determinista as unknown as {
      ejecutarPasoDeterminista: ReturnType<typeof vi.fn>;
    };
    const acciones = determinista.ejecutarPasoDeterminista.mock.calls.map(
      (llamada) => (llamada[1] as InstruccionDePaso).accion,
    );
    expect(acciones).not.toContain('click');
  });

  it('si el modelo falla, la tarea sigue por el motor libre y el motivo queda en el diagnostico', async () => {
    const deps = conInterprete('');

    await correr(deps, makeJob(PEDIDO_SIN_FORMATO));

    expect(deps.aprobaciones.crear).not.toHaveBeenCalled();
    expect(deps.motor.ejecutar).toHaveBeenCalledTimes(1);
    const veredictos = (deps.logger.info as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (llamada) => llamada[0] === 'tarea web: veredicto del procedimiento compartido',
    );
    expect(veredictos.at(-1)?.[1]).toMatchObject({
      motivo: 'sin_plantilla',
      interpretacion: 'sin_respuesta',
    });
  });
});
