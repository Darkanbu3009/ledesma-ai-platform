import { describe, it, expect, vi } from 'vitest';
import type { EstrategiaLocalizacion, Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  GuardiaDeAccion,
  MotorDeTareaWeb,
  NavegadorParaTarea,
  PasoObservado,
  RepositorioAtlasParaWorker,
  RepositorioPlantillasParaWorker,
  RepositorioRecetasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type { InstruccionDePaso, NavegadorDeterminista } from '../src/ejecutor-receta.js';
import type { ReferenciaDeElemento } from '../src/localizacion.js';
import { AccionBloqueadaError, AccionSinConfirmarError } from '../src/errores.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { claveDelAtlas, hashDeOrigen } from '../src/atlas-sitios.js';
import { clavePlantillas, hashDeOrigenDePlantilla } from '../src/plantillas-compartidas.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * PLANTILLAS COMPARTIDAS (V041) DE PUNTA A PUNTA dentro del handler de tarea web. Todo por fakes: cero
 * navegador, cero modelo, cero base.
 *
 * La corrida que se simula es la real: un ENVIO DE CORREO que escribe el destinatario, pasa la
 * verificacion determinista, hace clic en Enviar y confirma el efecto. Al cerrar, la version ANONIMA
 * del procedimiento se publica.
 *
 * CON LA CONFIGURACION DE PRODUCCION, y esto es lo que cambio: `observadorPasos` se queda en su
 * default REAL (apagado) y las estrategias de cada paso llegan por donde llegan en produccion, que es
 * la lectura de la PERCEPCION (`estrategiasPorAccion` del motor). Hasta este PR la suite corria con
 * el observador ENCENDIDO, o sea con la unica configuracion en la que produccion no corre: verde en
 * CI e imposible en el despliegue. Es la misma clase de error que ya costo tres rondas con el atlas.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - una corrida exitosa del motor libre publica, con las clases leidas del DOM y sin observador;
 *  - lo publicado no lleva NADA de la persona: ni valores, ni owner, ni firma, ni ids, ni xpath;
 *  - una tarea REVERSIBLE (verboBloqueado null) no publica nada;
 *  - el desenlace del job es IDENTICO con y sin publicacion, incluso cuando la publicacion falla;
 *  - el hash de origen de la plantilla no coincide con el que la misma corrida escribe en el atlas.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const VAULT = 'a'.repeat(64);
const CLAVE_ATLAS = claveDelAtlas({ vaultSecret: VAULT });
const CLAVE_PLANTILLAS = clavePlantillas({ vaultSecret: VAULT });

const DESTINATARIO = 'juan@ejemplo.com';
const OBJETIVO = `envia el resumen mensual a ${DESTINATARIO}`;
const OBJETIVO_REVERSIBLE = `abre el ultimo correo de ${DESTINATARIO}`;

const SELECTOR_PARA = 'xpath=/html[1]/body[1]//input[@aria-label=\'Para\']';
const SELECTOR_ENVIAR = 'xpath=/html[1]/body[1]//div[@aria-label=\'Enviar\']';

const ARIA_PARA: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Para' };
const ARIA_ENVIAR: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Enviar',
};
/** El id dinamico de Gmail y el xpath de la sesion: lo que el atlas ya descarta y la plantilla tambien. */
const ID_DINAMICO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'id', valor: ':u3' };

/**
 * LO QUE LA PERCEPCION LEE DEL DOM en cada paso, indexado por el selector que el motor resolvio. Es
 * la fuente de produccion: el mismo `estrategiasDe(el)` que usa el grabador, leido en la evaluacion
 * que ya corre despues de cada paso. Al campo Para se le suma el ID DINAMICO de Gmail a proposito:
 * es lo que la publicacion tiene que descartar.
 */
const PERCIBIDAS_POR_SELECTOR: Record<string, EstrategiaLocalizacion[]> = {
  [SELECTOR_PARA]: [ARIA_PARA, ID_DINAMICO],
  [SELECTOR_ENVIAR]: [ARIA_ENVIAR],
};

const CLASE_PARA = 'escribir|atributo:aria-label|para';
const CLASE_ENVIAR = 'click|atributo:aria-label|enviar';

const ESCRIBIR = 'escribe el destinatario';
const ENVIAR = 'haz clic en el boton Enviar';

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

/** La pagina MUTABLE que la accion irreversible consuma: es como se ve un envio hecho. */
interface PaginaFake {
  campos: CampoDeLaPagina[];
  texto: string;
}

function makePagina(): PaginaFake {
  return { campos: [{ contexto: 'input email para destinatario', valor: DESTINATARIO }], texto: '' };
}

function makeNavegador(pagina: PaginaFake): NavegadorParaTarea {
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
    leerCamposDeLaPagina: vi.fn(async () => pagina.campos),
    leerTextoVisible: vi.fn(async () => pagina.texto),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'MX' })),
    cerrarSesion: vi.fn(async () => {}),
  };
}

/** Que acciones propone el motor y con que selector resolvio cada una. */
interface AccionFake {
  instruccion: string;
  selector: string;
  metodo: 'fill' | 'click';
  argumentos: string[];
}

const ACCIONES_DEL_ENVIO: AccionFake[] = [
  { instruccion: ESCRIBIR, selector: SELECTOR_PARA, metodo: 'fill', argumentos: [DESTINATARIO] },
  { instruccion: ENVIAR, selector: SELECTOR_ENVIAR, metodo: 'click', argumentos: [] },
];

/**
 * Motor FAKE con el MISMO protocolo que el adaptador real (crearActBlindado): le pregunta a la GUARDIA
 * antes de cada accion, avisa al OBSERVADOR con el selector que resolvio, y confirma el efecto de la
 * accion irreversible sobre la pagina compartida.
 *
 * DEVUELVE `estrategiasPorAccion`, que es como el adaptador real entrega lo que la PERCEPCION leyo
 * del DOM despues de cada paso (stagehand.ts). Es la fuente de PRODUCCION de las estrategias, la que
 * el handler pasa por `pasosConEstrategiasPercibidas` al atlas y ahora tambien a la publicacion. El
 * observador de pasos, que es la otra fuente, esta apagado como en produccion y por eso
 * `params.observador` llega undefined.
 */
function makeMotor(
  acciones: AccionFake[] = ACCIONES_DEL_ENVIO,
  pagina?: PaginaFake,
  percibidas: Record<string, EstrategiaLocalizacion[]> = PERCIBIDAS_POR_SELECTOR,
): MotorDeTareaWeb & { ejecutadas: string[] } {
  const ejecutadas: string[] = [];
  return {
    ejecutadas,
    ejecutar: vi.fn(
      async (params: {
        guardia?: GuardiaDeAccion | undefined;
        observador?: ((paso: PasoObservado) => Promise<void>) | undefined;
      }) => {
        const crudas: Array<Record<string, unknown>> = [];
        const porAccion: EstrategiaLocalizacion[][] = [];
        for (const accion of acciones) {
          const veredicto = await params.guardia?.revisar(accion.instruccion);
          if (veredicto?.tipo === 'bloquear') {
            if (veredicto.causa === 'sin_efecto') {
              throw new AccionSinConfirmarError(veredicto.mensaje);
            }
            throw new AccionBloqueadaError(veredicto.mensaje);
          }
          if (veredicto?.tipo === 'incompleto' || veredicto?.tipo === 'rechazar') continue;
          ejecutadas.push(accion.instruccion);
          await params.observador?.({ selector: accion.selector, punto: null });
          porAccion.push(percibidas[accion.selector] ?? []);
          crudas.push({
            type: 'act',
            action: accion.instruccion,
            success: true,
            pageUrl: `https://${DOMINIO}/inbox`,
            playwrightArguments: {
              selector: accion.selector,
              method: accion.metodo,
              arguments: accion.argumentos,
            },
          });
          if (veredicto?.tipo === 'permitir' && veredicto.confirmar === true && params.guardia) {
            if (pagina) {
              pagina.campos = [];
              pagina.texto = 'Mensaje enviado. Deshacer';
            }
            const confirmacion = await params.guardia.confirmar();
            if (!confirmacion.confirmada && confirmacion.terminal) {
              throw new AccionSinConfirmarError(confirmacion.mensaje);
            }
          }
        }
        return {
          exito: true,
          completado: true,
          mensaje: 'listo',
          acciones: crudas,
          estrategiasPorAccion: porAccion,
          tokensIn: null,
          tokensOut: null,
        };
      },
    ),
  } as unknown as MotorDeTareaWeb & { ejecutadas: string[] };
}

/**
 * Navegador determinista fake: devuelve las estrategias del elemento SEGUN el selector observado, que
 * es lo que hace posible que cada paso tenga su propia clase. Al campo Para se le suma el ID DINAMICO
 * de Gmail a proposito: es lo que la publicacion tiene que descartar.
 */
function makeDeterminista(
  porSelector: Record<string, EstrategiaLocalizacion[]> = {
    [SELECTOR_PARA]: [ARIA_PARA, ID_DINAMICO],
    [SELECTOR_ENVIAR]: [ARIA_ENVIAR],
  },
): NavegadorDeterminista {
  return {
    ejecutarPasoDeterminista: vi.fn(async (sesion: string, instruccion: InstruccionDePaso) => {
      void sesion;
      void instruccion;
      return { estado: 'ok' as const, estrategias: [], detalle: null };
    }),
    // La referencia llega con el selector TAL CUAL lo observo el motor (crearObservadorDePasos lo
    // pasa entero, prefijo 'xpath=' incluido), asi que la tabla se indexa por esa misma cadena.
    leerEstrategiasDeElemento: vi.fn(
      async (_sesion: string, referencia: ReferenciaDeElemento) =>
        porSelector[referencia.tipo === 'xpath' ? referencia.xpath : ''] ?? [],
    ),
  };
}

function makeEscalador() {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: null,
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeRecetas(): RepositorioRecetasParaWorker & { promover: ReturnType<typeof vi.fn> } {
  const promover = vi.fn(async () => null);
  return {
    buscarActiva: vi.fn(async () => null),
    listarActivas: vi.fn(async () => []),
    promover,
    marcarObsoleta: vi.fn(async () => {}),
    reemplazarPasos: vi.fn(async () => {}),
    registrarEjecucion: vi.fn(async () => {}),
  } as unknown as RepositorioRecetasParaWorker & { promover: ReturnType<typeof vi.fn> };
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

/**
 * ATLAS fake con las dos clases del envio YA AVALADAS por dos origenes independientes, que es el
 * umbral que autoriza a publicar. Con un solo origen la publicacion tiene que rechazar.
 */
function makeAtlas(origenesPorClase = 2): RepositorioAtlasParaWorker {
  const origenes = Array.from({ length: origenesPorClase }, (_, i) => `otro-origen-${i}`);
  return {
    listarPorDominio: vi.fn(async (dominio: string) =>
      dominio !== DOMINIO
        ? []
        : [
            {
              claseDeElemento: CLASE_PARA,
              estrategias: [ARIA_PARA],
              corroboraciones: 5,
              origenesHash: [...origenes],
            },
            {
              claseDeElemento: CLASE_ENVIAR,
              estrategias: [ARIA_ENVIAR],
              corroboraciones: 5,
              origenesHash: [...origenes],
            },
          ],
    ),
    registrarObservacion: vi.fn(async () => {}),
  };
}

/** Repositorio de plantillas fake: guarda lo publicado tal cual llego. */
function makePlantillas(
  fallar = false,
): RepositorioPlantillasParaWorker & { publicadas: Array<Record<string, unknown>> } {
  const publicadas: Array<Record<string, unknown>> = [];
  return {
    publicadas,
    publicar: vi.fn(async (plantilla) => {
      if (fallar) throw new Error('base caida');
      publicadas.push({ ...plantilla });
      return { publicada: true };
    }),
  };
}

function makeDeps(overrides: Partial<TareaWebDeps> = {}, pagina = makePagina()): TareaWebDeps {
  return {
    repo: makeRepo(),
    navegador: makeNavegador(pagina),
    motor: makeMotor(ACCIONES_DEL_ENVIO, pagina),
    aprobaciones: makeAprobacionesRepo(),
    politicas: makePoliticas(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    recetas: makeRecetas(),
    determinista: makeDeterminista(),
    escalador: makeEscalador(),
    // `observadorPasos` NO se fija: queda en su default REAL (apagado, TAREA_WEB_OBSERVADOR_PASOS).
    // Las estrategias llegan por la percepcion, igual que en produccion.
    atlas: { repo: makeAtlas(), clave: CLAVE_ATLAS },
    plantillas: { repo: makePlantillas(), clave: CLAVE_PLANTILLAS },
    vaultSecret: VAULT,
    model: 'anthropic/claude-opus-4-5',
    maxPasos: 40,
    historialPasos: 8,
    modoScreenshots: 'cambios',
    runTimeoutMs: 60_000,
    esperar: async () => {},
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

function plantillasDe(deps: TareaWebDeps): Array<Record<string, unknown>> {
  return (deps.plantillas?.repo as unknown as { publicadas: Array<Record<string, unknown>> })
    .publicadas;
}

// -------------------------------------------------------------------------------------------------

describe('una corrida irreversible exitosa publica su plantilla', () => {
  it('la publica con la identidad completa, sin observador y sin receta propia', async () => {
    const pagina = makePagina();
    const recetas = makeRecetas();
    const deps = makeDeps({ recetas }, pagina);

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');

    // EL CASO EXACTO DE PRODUCCION: con el observador apagado los pasos llegan sin `estrategias`, la
    // promocion a receta no promueve nada y hasta este PR ahi terminaba tambien la publicacion. La
    // plantilla ya no cuelga de eso.
    expect(recetas.promover).not.toHaveBeenCalled();
    const publicadas = plantillasDe(deps);
    expect(publicadas).toHaveLength(1);
    expect(publicadas[0]).toMatchObject({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      origenHash: hashDeOrigenDePlantilla('user-1', CLAVE_PLANTILLAS),
    });
  });

  it('las clases publicadas son las que la PERCEPCION leyo del DOM', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    const pasos = plantillasDe(deps)[0]?.pasos as Array<Record<string, unknown>>;
    // Las dos clases salen de `PERCIBIDAS_POR_SELECTOR`, que es lo que el atlas tambien recibe. Si
    // salieran de la descripcion del modelo serian otras ("field", "compose window") y ninguna
    // entrada del atlas las corroboraria.
    expect(pasos.map((p) => p.claseDeElemento)).toEqual([CLASE_PARA, null, CLASE_ENVIAR]);
  });

  it('lo publicado son CUATRO campos y ninguno es de tenencia', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(Object.keys(plantillasDe(deps)[0] ?? {}).sort()).toEqual([
      'codigoDeIntencion',
      'dominiosClave',
      'origenHash',
      'pasos',
    ]);
  });

  it('lo publicado no contiene NINGUN valor de usuario, ni xpath, ni ruta, ni id o name', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    const serializado = JSON.stringify(plantillasDe(deps));
    for (const prohibido of [
      DESTINATARIO,
      'user-1',
      'job-1',
      'ses-1',
      'ctx-1',
      CONNECTION_ID,
      'resumen mensual',
      'xpath',
      'ruta',
      'literal',
      '"id"',
      '"name"',
      ':u3',
      'firma',
      'descripcion',
    ]) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
  });

  it('los pasos publicados llevan su clase de elemento y su ranura, no el valor', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    const pasos = plantillasDe(deps)[0]?.pasos as Array<Record<string, unknown>>;
    expect(pasos.map((p) => p.accion)).toEqual(['escribir', 'verificar', 'click']);
    expect(pasos.map((p) => p.claseDeElemento)).toEqual([CLASE_PARA, null, CLASE_ENVIAR]);
    // El destinatario SI lo declaro el objetivo, asi que viaja como marcador de parametro.
    expect(pasos[0]?.valor).toEqual({ tipo: 'parametro', parametro: 'destinatario' });
    // El paso `verificar` viaja: es donde la plantilla dice que hay que comparar antes de actuar.
    expect(pasos[1]?.estrategias).toEqual([]);
  });

  it('el hash de origen de la plantilla NO coincide con el que la misma corrida usa en el atlas', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    const dePlantilla = plantillasDe(deps)[0]?.origenHash;
    expect(dePlantilla).not.toBe(hashDeOrigen('user-1', CLAVE_ATLAS));
    expect(dePlantilla).toBe(hashDeOrigenDePlantilla('user-1', CLAVE_PLANTILLAS));
  });
});

describe('lo que NO se publica', () => {
  it('una tarea REVERSIBLE (sin verbo bloqueado) no publica nada', async () => {
    const deps = makeDeps();
    // Sin verbo bloqueado la guardia deja pasar todo y la corrida cierra bien, pero sin intencion
    // irreversible no hay plantilla: es la decision de diseno de V041, no un fallo del cableado.
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO_REVERSIBLE))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
  });

  it('una clase avalada por UN SOLO origen no alcanza para publicar', async () => {
    const deps = makeDeps({ atlas: { repo: makeAtlas(1), clave: CLAVE_ATLAS } });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
  });

  it('sin atlas cableado no hay clases corroboradas y no se publica nada', async () => {
    const deps = makeDeps({ atlas: undefined });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
  });

  it('sin la migracion aplicada (deps.plantillas ausente) la tarea corre exactamente igual', async () => {
    const deps = makeDeps({ plantillas: undefined });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'ok' }),
    );
  });
});

describe('la publicacion es best-effort: su fallo no cambia el desenlace del job', () => {
  it('un fallo del repositorio deja el job completado igual y solo deja un warn', async () => {
    const plantillas = makePlantillas(true);
    const deps = makeDeps({ plantillas: { repo: plantillas, clave: CLAVE_PLANTILLAS } });

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');

    expect(plantillas.publicar).toHaveBeenCalledTimes(1);
    expect(deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'ok' }),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no se pudo compartir la plantilla'),
      expect.anything(),
    );
  });

  it('un rechazo de la SEGUNDA puerta tampoco cambia el desenlace', async () => {
    const plantillas: RepositorioPlantillasParaWorker = {
      publicar: vi.fn(async () => ({ publicada: false, motivo: 'la plantilla no es publicable' })),
    };
    const deps = makeDeps({ plantillas: { repo: plantillas, clave: CLAVE_PLANTILLAS } });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('el backend rechazo la plantilla'),
      expect.anything(),
    );
  });

  it('si la receta propia NO se pudo guardar, se publica igual', async () => {
    // DECISION DE POLITICA de este PR: conservar la receta propia depende de una palanca de COSTO (el
    // observador) y de que la base este arriba, no de ningun juicio sobre el procedimiento. Lo que
    // respalda a la plantilla sigue intacto: efecto confirmado, dos origenes por clase y las dos
    // puertas de `esPublicable`.
    const recetas = makeRecetas();
    recetas.promover.mockRejectedValue(new Error('base caida'));
    const deps = makeDeps({ recetas });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(1);
  });
});

/**
 * NO REGRESION (obligatorio): la publicacion NO puede tocar el desenlace del job. Se compara el
 * resultado que el handler escribe -- sin el campo `plantilla`, que es justamente lo que la
 * publicacion agrega -- entre la corrida con el puerto cableado, la corrida sin el puerto y la
 * corrida en la que la publicacion revienta.
 */
describe('el desenlace del job es IDENTICO con y sin publicacion', () => {
  async function desenlaceDe(deps: TareaWebDeps): Promise<{
    devuelto: string;
    resultado: Record<string, unknown>;
  }> {
    const devuelto = await procesarTareaWeb(deps, makeJob(OBJETIVO));
    const llamadas = (deps.guardarResultado as ReturnType<typeof vi.fn>).mock.calls;
    const resultado = { ...((llamadas[0]?.[1] ?? {}) as Record<string, unknown>) };
    // Fuera el unico campo que la publicacion agrega: lo que se compara es todo lo demas.
    delete resultado.plantilla;
    return { devuelto, resultado };
  }

  it('con el puerto cableado, sin el puerto y con la publicacion rota, el resultado es el mismo', async () => {
    const repoRoto = makePlantillas(true);
    const conPublicacion = await desenlaceDe(makeDeps());
    const sinPuerto = await desenlaceDe(makeDeps({ plantillas: undefined }));
    const rota = await desenlaceDe(
      makeDeps({ plantillas: { repo: repoRoto, clave: CLAVE_PLANTILLAS } }),
    );

    expect(conPublicacion.devuelto).toBe('completada');
    expect(sinPuerto).toEqual(conPublicacion);
    expect(rota).toEqual(conPublicacion);
    // El desenlace identico no es "no se intento": la corrida rota SI llamo al puerto y reviento.
    expect(repoRoto.publicar).toHaveBeenCalledTimes(1);
  });

  it('el atlas recibe lo mismo publique o no publique la corrida', async () => {
    const observadas = (deps: TareaWebDeps): unknown[] =>
      ((deps.atlas?.repo as unknown as { registrarObservacion: ReturnType<typeof vi.fn> })
        .registrarObservacion.mock.calls ?? []).map((llamada) => llamada[0]);

    const conPublicacion = makeDeps();
    await procesarTareaWeb(conPublicacion, makeJob(OBJETIVO));
    const sinPuerto = makeDeps({ plantillas: undefined });
    await procesarTareaWeb(sinPuerto, makeJob(OBJETIVO));

    expect(observadas(sinPuerto)).toEqual(observadas(conPublicacion));
    expect(observadas(conPublicacion).length).toBeGreaterThan(0);
  });
});

/**
 * EL VEREDICTO SIEMPRE QUEDA REGISTRADO (OBSERVABILIDAD, 30 jul 2026). Hasta este PR la publicacion
 * no dejaba rastro de su decision en ningun lado: el log solo salia si se llegaba a evaluarla, y a la
 * evaluacion no se llegaba nunca cuando la promocion de la receta propia fallaba, que es justo el
 * caso a diagnosticar. Ahora el veredicto viaja en `jobs.resultado.plantilla` en TODOS los caminos.
 *
 * Lo que estos tests fijan: que el motivo del NO se registre, y que el comportamiento de la
 * publicacion no haya cambiado (los casos que no publicaban siguen sin publicar).
 */
describe('el veredicto de la publicacion queda registrado en el resultado del job', () => {
  function veredictoDe(deps: TareaWebDeps): Record<string, unknown> {
    const llamadas = (deps.guardarResultado as ReturnType<typeof vi.fn>).mock.calls;
    const resultado = llamadas[0]?.[1] as { plantilla?: Record<string, unknown> } | undefined;
    return resultado?.plantilla ?? {};
  }

  it('cuando se publica, lo dice con las clases que lo autorizaron', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(veredictoDe(deps)).toEqual({
      publicada: true,
      motivo: null,
      submotivo: null,
      idx: null,
      clases: 2,
    });
  });

  it('la promocion de la receta que FALLA ya no impide publicar', async () => {
    // EL CASO QUE COSTO LA AUDITORIA: la publicacion colgaba del exito de `recetas.promover`, asi que
    // este job cerraba sin plantilla. Ahora la decision es propia y el veredicto lo dice.
    const recetas = makeRecetas();
    recetas.promover.mockRejectedValue(new Error('base caida'));
    const deps = makeDeps({ recetas });
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(veredictoDe(deps)).toEqual({
      publicada: true,
      motivo: null,
      submotivo: null,
      idx: null,
      clases: 2,
    });
    expect(plantillasDe(deps)).toHaveLength(1);
  });

  it('una traza que no se puede convertir en pasos registra su motivo', async () => {
    // Un click de foco solo, sin nada leido del DOM y sin escritura posterior que lo cubra: la
    // conversion rechaza la trayectoria entera y no hay procedimiento que publicar.
    const pagina = makePagina();
    const deps = makeDeps(
      {
        motor: makeMotor(
          [{ instruccion: ENVIAR, selector: SELECTOR_ENVIAR, metodo: 'click', argumentos: [] }],
          pagina,
          {},
        ),
      },
      pagina,
    );
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    // EL SUB-MOTIVO, que es lo que hasta hoy no quedaba en ningun lado: `sin_procedimiento_repetible`
    // son las trece reglas del conversor metidas en una palabra, y averiguar cual habia cortado
    // costo leer el conversor entero. Ahora la regla y el paso implicado viajan con el veredicto.
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'sin_procedimiento_repetible',
      submotivo: 'click_sin_localizacion_sin_cobertura',
      // El paso implicado en la TRAZA: el click de Enviar, que va detras de la navegacion inicial.
      idx: 1,
      clases: 2,
    });
    expect(plantillasDe(deps)).toHaveLength(0);
  });

  it('una tarea reversible registra el motivo de diseno de V041', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO_REVERSIBLE));
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'sin_intencion_irreversible',
      submotivo: null,
      idx: null,
      clases: 2,
    });
  });

  it('sin atlas se registra el paso que rechazo y que no habia ninguna clase avalada', async () => {
    const deps = makeDeps({ atlas: undefined });
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'clase_no_corroborada',
      submotivo: null,
      idx: 0,
      clases: 0,
    });
  });

  it('sin el puerto de plantillas cableado tambien queda registrado', async () => {
    const deps = makeDeps({ plantillas: undefined });
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'publicacion_no_cableada',
      submotivo: null,
      idx: null,
      clases: 2,
    });
  });

  it('el rechazo de la SEGUNDA puerta se registra sin el texto libre del backend', async () => {
    const plantillas: RepositorioPlantillasParaWorker = {
      publicar: vi.fn(async () => ({ publicada: false, motivo: 'la plantilla no es publicable' })),
    };
    const deps = makeDeps({ plantillas: { repo: plantillas, clave: CLAVE_PLANTILLAS } });
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'rechazada_por_el_backend',
      submotivo: null,
      idx: null,
      clases: 2,
    });
  });

  it('un fallo de la publicacion se registra y no cambia el desenlace', async () => {
    const deps = makeDeps({ plantillas: { repo: makePlantillas(true), clave: CLAVE_PLANTILLAS } });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'error_al_publicar',
      submotivo: null,
      idx: null,
      clases: 2,
    });
  });
});

/**
 * EL CLICK FINAL SIN LOCALIZADOR, DE PUNTA A PUNTA EN EL HANDLER. Es la forma REAL con la que la
 * corrida del 31 jul 2026 03:27 UTC cerro en produccion: correo enviado, efecto confirmado, y en el
 * resultado del job `sin_procedimiento_repetible` / `click_sin_localizacion_sin_cobertura`.
 *
 * POR QUE EL PASO LLEGA VACIO: la percepcion lee el elemento DESPUES de la accion y al enviar el
 * sitio desmonta el compose, asi que ese paso no recibe nada (aqui, la tabla de percibidas no tiene
 * entrada para el selector del envio). La UNICA lectura que alcanza al control vivo es la de la
 * BARRERA DE IDENTIDAD, que corre ANTES, y es la que este cableado lleva al paso.
 *
 * La barrera va en 'observacion', que es el default de produccion de TAREA_WEB_BARRERA_IDENTIDAD, y
 * el observador de pasos sigue apagado como en el resto de este archivo.
 */
describe('el click final publica con lo que la barrera de identidad leyo del DOM', () => {
  /** El control que la barrera encuentra vivo justo antes de accionarlo (nombre accesible completo). */
  const CONTROL_ENVIAR = { ariaLabel: 'Enviar (Ctrl-Enter)', rol: 'button', candidatos: 1 };

  /** La clase de ese control: la MISMA que la corrida escribe en el atlas por la otra puerta. */
  const CLASE_DE_LA_BARRERA = 'click|rol:button|enviar (ctrl-enter)';

  /** Lo que la percepcion alcanza a leer: el campo Para si, el boton de envio NO. */
  const PERCIBIDAS_SIN_EL_ENVIO: Record<string, EstrategiaLocalizacion[]> = {
    [SELECTOR_PARA]: [ARIA_PARA, ID_DINAMICO],
  };

  /** La estrategia con la que el atlas tiene guardada la clase del boton de envio. */
  const ROL_ENVIAR: EstrategiaLocalizacion = {
    tipo: 'rol',
    rol: 'button',
    nombre: 'Enviar (Ctrl-Enter)',
  };

  /** Atlas con las dos clases que esta corrida necesita avaladas por dos origenes independientes. */
  function makeAtlasConLaClaseDeLaBarrera(): RepositorioAtlasParaWorker {
    const filas: Array<{ claseDeElemento: string; estrategias: EstrategiaLocalizacion[] }> = [
      { claseDeElemento: CLASE_PARA, estrategias: [ARIA_PARA] },
      { claseDeElemento: CLASE_DE_LA_BARRERA, estrategias: [ROL_ENVIAR] },
    ];
    return {
      listarPorDominio: vi.fn(async (dominio: string) =>
        dominio !== DOMINIO
          ? []
          : filas.map((fila) => ({
              ...fila,
              corroboraciones: 5,
              origenesHash: ['otro-origen-0', 'otro-origen-1'],
            })),
      ),
      registrarObservacion: vi.fn(async () => {}),
    };
  }

  function depsDelEnvioSinLocalizador(
    overrides: Partial<TareaWebDeps> = {},
    control: typeof CONTROL_ENVIAR | null = CONTROL_ENVIAR,
  ): TareaWebDeps {
    const pagina = makePagina();
    return makeDeps(
      {
        navegador: {
          ...makeNavegador(pagina),
          localizarBotonPorAriaLabel: vi.fn(async () => control),
        },
        motor: makeMotor(ACCIONES_DEL_ENVIO, pagina, PERCIBIDAS_SIN_EL_ENVIO),
        atlas: { repo: makeAtlasConLaClaseDeLaBarrera(), clave: CLAVE_ATLAS },
        barreraIdentidad: 'observacion',
        ...overrides,
      },
      pagina,
    );
  }

  function veredictoDe(deps: TareaWebDeps): Record<string, unknown> {
    const llamadas = (deps.guardarResultado as ReturnType<typeof vi.fn>).mock.calls;
    const resultado = llamadas[0]?.[1] as { plantilla?: Record<string, unknown> } | undefined;
    return resultado?.plantilla ?? {};
  }

  it('la corrida PUBLICA, y el paso del envio viaja con la clase que la barrera leyo', async () => {
    const deps = depsDelEnvioSinLocalizador();

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');

    const publicadas = plantillasDe(deps);
    expect(publicadas).toHaveLength(1);
    const pasos = publicadas[0]?.pasos as Array<Record<string, unknown>>;
    expect(pasos.map((p) => p.accion)).toEqual(['escribir', 'verificar', 'click']);
    expect(pasos.map((p) => p.claseDeElemento)).toEqual([CLASE_PARA, null, CLASE_DE_LA_BARRERA]);
    expect(pasos[2]?.estrategias).toEqual([
      { tipo: 'rol', rol: 'button', nombre: 'Enviar (Ctrl-Enter)' },
    ]);
    expect(veredictoDe(deps)).toEqual({
      publicada: true,
      motivo: null,
      submotivo: null,
      idx: null,
      clases: 2,
    });
    // Ni el nombre del control ni nada de la persona convierten esto en un dato de usuario: lo que
    // viaja es el nombre accesible que el sitio le promete a cualquier lector de pantalla.
    const serializado = JSON.stringify(publicadas);
    for (const prohibido of [DESTINATARIO, 'user-1', 'job-1', 'xpath', 'ruta', ':u3']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
  });

  it('la clase que se publica es la MISMA que la corrida escribe en el atlas', async () => {
    const deps = depsDelEnvioSinLocalizador();
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    const registrar = (deps.atlas?.repo as unknown as {
      registrarObservacion: ReturnType<typeof vi.fn>;
    }).registrarObservacion;
    const escritas = registrar.mock.calls.map((llamada) => (llamada[0] as { claseDeElemento: string }).claseDeElemento);
    // La del control accionado la escribe la otra puerta del mismo cierre; si divergieran, la
    // plantilla se caeria por 'clase_no_corroborada' y este arreglo no serviria de nada.
    expect(escritas).toContain(CLASE_DE_LA_BARRERA);
    const pasos = plantillasDe(deps)[0]?.pasos as Array<Record<string, unknown>>;
    expect(pasos[2]?.claseDeElemento).toBe(CLASE_DE_LA_BARRERA);
  });

  it('SIN la lectura de la barrera, la misma corrida vuelve a quedar sin publicar', async () => {
    // La barrera apagada es la LINEA BASE: nadie ve vivo el control, el paso del envio sigue sin una
    // sola estrategia y la destilacion lo rechaza con el motivo de produccion.
    const deps = depsDelEnvioSinLocalizador({ barreraIdentidad: 'apagada' });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
    expect(veredictoDe(deps)).toMatchObject({
      publicada: false,
      motivo: 'sin_procedimiento_repetible',
      submotivo: 'click_sin_localizacion_sin_cobertura',
    });
  });

  it('con MAS DE UN candidato en la pagina tampoco se completa y no se publica', async () => {
    const deps = depsDelEnvioSinLocalizador({}, { ...CONTROL_ENVIAR, candidatos: 3 });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
    expect(veredictoDe(deps)).toMatchObject({
      publicada: false,
      motivo: 'sin_procedimiento_repetible',
      submotivo: 'click_sin_localizacion_sin_cobertura',
    });
  });

  it('sin el metodo de lectura en el puerto, la corrida cierra igual de bien y no publica', async () => {
    // El fake que no trae la primitiva deja la barrera sin control que leer: falla cerrada y el
    // desenlace del job es exactamente el mismo.
    const pagina = makePagina();
    const deps = makeDeps(
      {
        navegador: makeNavegador(pagina),
        motor: makeMotor(ACCIONES_DEL_ENVIO, pagina, PERCIBIDAS_SIN_EL_ENVIO),
        atlas: { repo: makeAtlasConLaClaseDeLaBarrera(), clave: CLAVE_ATLAS },
        barreraIdentidad: 'observacion',
      },
      pagina,
    );
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
  });
});
