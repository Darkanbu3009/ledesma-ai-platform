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
 * verificacion determinista, hace clic en Enviar y confirma el efecto. Al cerrar, la receta propia se
 * guarda y su version ANONIMA se publica.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - se publica DESPUES de que la receta propia se guardo, nunca antes;
 *  - lo publicado no lleva NADA de la persona: ni valores, ni owner, ni firma, ni ids, ni xpath;
 *  - una tarea REVERSIBLE (verboBloqueado null) no publica nada;
 *  - un fallo de la publicacion NO cambia el desenlace del job;
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
 */
function makeMotor(
  acciones: AccionFake[] = ACCIONES_DEL_ENVIO,
  pagina?: PaginaFake,
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
    // El observador es lo que pone en cada paso las estrategias leidas del DOM, y con ellas la clase.
    observadorPasos: true,
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
  it('la publica con la identidad completa y DESPUES de guardar la receta propia', async () => {
    const pagina = makePagina();
    const recetas = makeRecetas();
    const deps = makeDeps({ recetas }, pagina);

    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');

    expect(recetas.promover).toHaveBeenCalledTimes(1);
    const publicadas = plantillasDe(deps);
    expect(publicadas).toHaveLength(1);
    expect(publicadas[0]).toMatchObject({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      origenHash: hashDeOrigenDePlantilla('user-1', CLAVE_PLANTILLAS),
    });
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
    // Sin verbo bloqueado la guardia deja pasar todo, la corrida cierra bien y la receta se promueve.
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO_REVERSIBLE))).resolves.toBe('completada');
    expect(
      (deps.recetas as unknown as { promover: ReturnType<typeof vi.fn> }).promover,
    ).toHaveBeenCalledTimes(1);
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

  it('si la receta propia NO se pudo guardar, no se publica nada', async () => {
    const recetas = makeRecetas();
    recetas.promover.mockRejectedValue(new Error('base caida'));
    const deps = makeDeps({ recetas });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(plantillasDe(deps)).toHaveLength(0);
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
    expect(veredictoDe(deps)).toEqual({ publicada: true, motivo: null, idx: null, clases: 2 });
  });

  it('la promocion de la receta que FALLA deja el motivo registrado igual', async () => {
    // EL CASO QUE COSTO LA AUDITORIA: el return temprano de la promocion se llevaba consigo la
    // decision de publicar, asi que este job cerraba sin una sola linea sobre plantillas.
    const recetas = makeRecetas();
    recetas.promover.mockRejectedValue(new Error('base caida'));
    const deps = makeDeps({ recetas });
    await procesarTareaWeb(deps, makeJob(OBJETIVO));
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'sin_receta_propia',
      idx: null,
      clases: 2,
    });
    expect(plantillasDe(deps)).toHaveLength(0);
  });

  it('sin observador de pasos la corrida no deja receta, y eso queda registrado', async () => {
    // La forma REAL en la que produccion no publica nada: con el observador apagado (default) los
    // pasos no llevan estrategias, la promocion rechaza y antes de este PR ahi terminaba el rastro.
    const deps = makeDeps({ observadorPasos: false });
    await expect(procesarTareaWeb(deps, makeJob(OBJETIVO))).resolves.toBe('completada');
    expect(veredictoDe(deps)).toMatchObject({ publicada: false, motivo: 'sin_receta_propia' });
    expect(plantillasDe(deps)).toHaveLength(0);
  });

  it('una tarea reversible registra el motivo de diseno de V041', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob(OBJETIVO_REVERSIBLE));
    expect(veredictoDe(deps)).toEqual({
      publicada: false,
      motivo: 'sin_intencion_irreversible',
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
      idx: null,
      clases: 2,
    });
  });
});
