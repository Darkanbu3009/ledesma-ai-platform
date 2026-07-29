import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import { parsearDetencion, parsearPasosDeReceta } from '@ledesma-platform/shared';
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
import type { EscaladorDePaso, NavegadorDeterminista } from '../src/ejecutor-receta.js';
import { firmaDeObjetivo } from '../src/receta-web.js';
import type { ElectorDeTareaEnsenada } from '../src/eleccion-tarea.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * EL AGENTE ELIGE ENTRE LAS TAREAS YA ENSENADAS (CAMBIO 3), de punta a punta dentro del handler y con
 * un elector FAKE: cero navegador, cero base y cero llamadas reales a un modelo.
 *
 * EL CASO DE PRODUCCION que esto arregla: una tarea ensenada con la descripcion "enviar un correo"
 * quedo bajo esa firma. Al pedir "manda un correo a martin@ejemplo.com con el asunto Paquete y dile
 * que llego", la firma calculada fue otra y lo aprendido NUNCA se encontro, aunque describia
 * exactamente esa tarea.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - si la firma exacta coincide, NI SE CONSULTA al modelo (la via rapida sigue siendo gratis);
 *  - si no coincide, se consulta UNA vez y la tarea ensenada se ejecuta con los datos elegidos;
 *  - esos datos pasan por la MISMA verificacion determinista: si la pagina no los muestra, la tarea
 *    se DETIENE sin ejecutar la accion, igual que por cualquier otro camino;
 *  - la politica del usuario se aplica igual;
 *  - una respuesta del modelo que no se puede verificar (datos inventados) no ejecuta nada.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const CORREO = 'martin@ejemplo.com';
/** Como lo escribe el usuario. La firma de esto NO es la de "enviar un correo". */
const PEDIDO = `manda un correo a ${CORREO} con el asunto Paquete y dile que llego`;

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload: {
      kind: 'tarea_web',
      connectionId: CONNECTION_ID,
      // El objetivo lo redacta el modelo conversacional; el texto del usuario viaja aparte y es el
      // que manda para los parametros (y para el ancla de la eleccion).
      objetivo: 'enviar un correo con el reporte',
      textoUsuario: PEDIDO,
    },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    startedAt: '2026-07-26T00:00:00.000Z',
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
  } as unknown as NavegadorParaTarea;
}

function makeMotor(): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(async () => ({
      exito: true,
      completado: true,
      mensaje: 'listo',
      acciones: [],
      tokensIn: 100_000,
      tokensOut: 2_000,
    })),
  } as unknown as MotorDeTareaWeb;
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

/** La tarea ensenada: escribe destinatario y asunto, verifica y confirma. */
function makeTareaEnsenada(descripcion: string | null = 'enviar un correo'): RecetaWeb {
  const pasos = parsearPasosDeReceta([
    {
      idx: 0,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
    {
      idx: 1,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'subjectbox' }],
      valor: { tipo: 'parametro', parametro: 'asunto' },
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
    { idx: 2, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
    {
      idx: 3,
      accion: 'click',
      estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
  ]);
  if (pasos === null) throw new Error('los pasos del fixture no validan contra el contrato');
  return {
    id: 'rec-ensenada-1',
    ownerId: 'user-1',
    dominio: DOMINIO,
    firmaObjetivo: 'enviar un correo',
    descripcion,
    version: 1,
    estado: 'activa',
    origen: 'grabacion',
    pasos,
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 1,
    ejecucionesFallidas: 0,
    ajustesAutomaticos: 0,
    ultimaEjecucionEn: null,
    creadaEn: '2026-07-25T00:00:00.000Z',
    actualizadaEn: '2026-07-25T00:00:00.000Z',
  };
}

/** La misma tarea, pero pidiendo SOLO el destinatario (lo que el extractor si saca de un texto). */
function makeTareaEnsenadaSoloDestinatario(): RecetaWeb {
  const ensenada = makeTareaEnsenada();
  const pasos = parsearPasosDeReceta([
    {
      idx: 0,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
    { idx: 1, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
    {
      idx: 2,
      accion: 'click',
      estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    },
  ]);
  if (pasos === null) throw new Error('los pasos del fixture no validan contra el contrato');
  return { ...ensenada, pasos };
}

function makeRecetas(
  ensenadas: RecetaWeb[],
  activaPorFirma: RecetaWeb | null = null,
): RepositorioRecetasParaWorker & {
  buscarActiva: ReturnType<typeof vi.fn>;
  listarActivas: ReturnType<typeof vi.fn>;
} {
  return {
    buscarActiva: vi.fn(async () => activaPorFirma),
    listarActivas: vi.fn(async () => ensenadas),
    promover: vi.fn(async () => null),
    marcarObsoleta: vi.fn(async () => {}),
    reemplazarPasos: vi.fn(async () => {}),
    registrarEjecucion: vi.fn(async () => {}),
  };
}

/** Elector fake: devuelve la respuesta cruda que se le indique, sin red y sin modelo. */
function makeElector(respuesta: string): ElectorDeTareaEnsenada & {
  consultar: ReturnType<typeof vi.fn>;
} {
  return { consultar: vi.fn(async () => respuesta) };
}

const RESPUESTA_CORRECTA = JSON.stringify({
  tarea: 'rec-ensenada-1',
  datos: { destinatario: CORREO, asunto: 'Paquete' },
});

function makePoliticas(sitiosExcluidos: string[] = []): RepositorioPoliticasParaWorker {
  return {
    obtenerPorOwner: vi.fn(async () => ({
      ejecutarAccionesIrreversibles: true,
      topeMontoSinConfirmacion: 5000,
      sitiosExcluidos,
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
    recetas: makeRecetas([makeTareaEnsenada()]),
    determinista: makeDeterminista(),
    escalador: makeEscalador(),
    elector: makeElector(RESPUESTA_CORRECTA),
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

/** La pagina ya con los datos escritos: es lo que la verificacion determinista compara. */
const PAGINA_COMPLETA: CampoDeLaPagina[] = [
  { contexto: 'input para destinatario to', valor: CORREO },
  { contexto: 'input asunto subjectbox', valor: 'Paquete' },
];

describe('el agente elige entre las tareas que el usuario ya enseno', () => {
  it('ejecuta una tarea ensenada cuya descripcion NO coincide literalmente con lo pedido', async () => {
    const recetas = makeRecetas([makeTareaEnsenada()]);
    const elector = makeElector(RESPUESTA_CORRECTA);
    const determinista = makeDeterminista();
    const motor = makeMotor();
    const deps = makeDeps({
      recetas,
      elector,
      determinista,
      motor,
      navegador: makeNavegador(PAGINA_COMPLETA),
    });

    const resultado = await procesarTareaWeb(deps, makeJob());

    expect(resultado).toBe('completada');
    // Las DOS firmas exactas (la del objetivo del modelo y la del texto del usuario) no encontraron
    // nada, y por eso se consulto: UNA sola vez, sin bucle.
    expect(recetas.buscarActiva).toHaveBeenCalledTimes(2);
    expect(elector.consultar).toHaveBeenCalledTimes(1);
    // La tarea corrio con lo aprendido: sus cuatro pasos menos el de verificacion.
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(3);
    expect(motor.ejecutar).not.toHaveBeenCalled();
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ via: 'receta' }));
  });

  it('los datos que da el agente son los que se TECLEAN, y salen del texto del usuario', async () => {
    const determinista = makeDeterminista();
    await procesarTareaWeb(
      makeDeps({ determinista, navegador: makeNavegador(PAGINA_COMPLETA) }),
      makeJob(),
    );
    const tecleados = determinista.ejecutarPasoDeterminista.mock.calls
      .map((llamada) => (llamada[1] as { texto: string | null }).texto)
      .filter((texto): texto is string => texto !== null);
    expect(tecleados).toEqual([CORREO, 'Paquete']);
  });

  it('los datos que da el agente pasan por la MISMA verificacion determinista', async () => {
    // La pagina muestra OTRO destinatario que el que se pidio: la comparacion falla y la tarea se
    // DETIENE antes del clic que envia, exactamente igual que por cualquier otro camino.
    const determinista = makeDeterminista();
    const navegador = makeNavegador([
      { contexto: 'input para destinatario to', valor: 'otro@ejemplo.com' },
      { contexto: 'input asunto subjectbox', valor: 'Paquete' },
    ]);

    const error = await procesarTareaWeb(
      makeDeps({ determinista, navegador }),
      makeJob(),
    ).then(() => null, (e: unknown) => e as Error);

    expect(parsearDetencion(error?.message)).not.toBeNull();
    expect(navegador.leerCamposDeLaPagina).toHaveBeenCalled();
    // Se escribieron los dos campos y NUNCA se llego al paso que confirma.
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(2);
  });

  it('la politica del usuario tambien manda sobre una tarea ensenada elegida por el agente', async () => {
    const determinista = makeDeterminista();
    const error = await procesarTareaWeb(
      makeDeps({
        determinista,
        politicas: makePoliticas([DOMINIO]),
        navegador: makeNavegador(PAGINA_COMPLETA),
      }),
      makeJob(),
    ).then(() => null, (e: unknown) => e as Error);

    expect(parsearDetencion(error?.message)?.motivo).toBe('sitioExcluido');
    expect(determinista.ejecutarPasoDeterminista).toHaveBeenCalledTimes(2);
  });

  it('si la firma exacta YA coincide, no se consulta al modelo', async () => {
    // Una tarea que solo pide el destinatario: el extractor determinista lo saca del texto sin ayuda
    // de nadie, asi que la via rapida se basta sola y completa la tarea.
    const ensenada = makeTareaEnsenadaSoloDestinatario();
    const recetas = makeRecetas([ensenada], ensenada);
    const elector = makeElector(RESPUESTA_CORRECTA);

    const resultado = await procesarTareaWeb(
      makeDeps({ recetas, elector, navegador: makeNavegador(PAGINA_COMPLETA) }),
      makeJob(),
    );

    expect(resultado).toBe('completada');
    expect(elector.consultar).not.toHaveBeenCalled();
  });

  it('un dato que el usuario NO escribio no ejecuta nada: la tarea corre con el motor', async () => {
    const determinista = makeDeterminista();
    const motor = makeMotor();
    const elector = makeElector(
      JSON.stringify({
        tarea: 'rec-ensenada-1',
        datos: { destinatario: 'otro@ejemplo.com', asunto: 'Paquete' },
      }),
    );

    // El motor fake termina sin pasar por la guardia, asi que el handler cierra la tarea como fallo
    // (proteccion existente contra el DONE prematuro). Lo que este test fija es el camino tomado.
    await procesarTareaWeb(
      makeDeps({ determinista, motor, elector, navegador: makeNavegador(PAGINA_COMPLETA) }),
      makeJob(),
    ).catch(() => null);

    expect(elector.consultar).toHaveBeenCalledTimes(1);
    expect(determinista.ejecutarPasoDeterminista).not.toHaveBeenCalled();
    expect(motor.ejecutar).toHaveBeenCalled();
  });

  it('sin elector cableado, todo sigue como antes: solo la firma exacta', async () => {
    const recetas = makeRecetas([makeTareaEnsenada()]);
    const motor = makeMotor();

    await procesarTareaWeb(makeDeps({ recetas, motor, elector: undefined }), makeJob()).catch(
      () => null,
    );

    expect(recetas.listarActivas).not.toHaveBeenCalled();
    expect(motor.ejecutar).toHaveBeenCalled();
  });
});

/**
 * VIA RAPIDA POR FIRMA CANONICA (FIX firma, jul 2026). La firma sustituye cada dato declarado por UN
 * marcador en la posicion de su valor, asi que dos pedidos con la MISMA estructura y datos distintos
 * firman igual: se encuentra lo aprendido y se ejecuta con los valores nuevos, extraidos por el
 * extractor determinista. Cero llamadas al modelo, ni al selector ni al motor.
 *
 * ALCANCE, explicito: es igualdad ESTRUCTURAL de firma, no equivalencia de significado. Un fraseo
 * libre de la misma tarea firma distinto y sigue yendo al selector con modelo.
 */
describe('via rapida: misma estructura con OTROS valores (FIX firma canonica)', () => {
  const plantilla = (destinatario: string, asunto: string, cuerpo: string): string =>
    `Enviar un correo electronico a ${destinatario} con el asunto "${asunto}" y el siguiente ` +
    `cuerpo del mensaje "${cuerpo}". La tarea termina cuando el correo haya sido enviado exitosamente.`;

  /** Los valores con los que se aprendio la receta (corrida origen de produccion). */
  const APRENDIDA = plantilla(
    'omar.ledesm91@gmail.com',
    'Trayectoria fresca',
    'Este correo lo envio el sistema',
  );
  /** El pedido NUEVO: misma estructura, los tres datos distintos. */
  const NUEVO_DESTINATARIO = 'ana@ejemplo.com';
  const NUEVO_ASUNTO = 'Paquete';
  const NUEVO_CUERPO = 'Ya llego el paquete';
  const NUEVA = plantilla(NUEVO_DESTINATARIO, NUEVO_ASUNTO, NUEVO_CUERPO);

  const PAGINA_CON_LOS_NUEVOS: CampoDeLaPagina[] = [
    { contexto: 'input para destinatario to', valor: NUEVO_DESTINATARIO },
    { contexto: 'input asunto subjectbox', valor: NUEVO_ASUNTO },
    { contexto: 'textarea cuerpo del mensaje body', valor: NUEVO_CUERPO },
  ];

  function makeJobConObjetivo(objetivo: string, textoUsuario?: string): Job {
    const job = makeJob();
    return {
      ...job,
      payload: {
        kind: 'tarea_web',
        connectionId: CONNECTION_ID,
        objetivo,
        ...(textoUsuario === undefined ? {} : { textoUsuario }),
      },
    };
  }

  /** La receta de enviar correo: los tres datos como parametros, con su punto de verificacion. */
  function makeRecetaDeCorreo(firmaObjetivo: string): RecetaWeb {
    const pasos = parsearPasosDeReceta([
      {
        idx: 0,
        accion: 'escribir',
        estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
        valor: { tipo: 'parametro', parametro: 'destinatario' },
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
      {
        idx: 1,
        accion: 'escribir',
        estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'subjectbox' }],
        valor: { tipo: 'parametro', parametro: 'asunto' },
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
      {
        idx: 2,
        accion: 'escribir',
        estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'body' }],
        valor: { tipo: 'parametro', parametro: 'cuerpo' },
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
      { idx: 3, accion: 'verificar', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
      {
        idx: 4,
        accion: 'click',
        estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
    ]);
    if (pasos === null) throw new Error('los pasos del fixture no validan contra el contrato');
    return { ...makeTareaEnsenada(null), id: 'rec-correo-1', firmaObjetivo, pasos };
  }

  /** Repositorio que solo devuelve la receta cuando la firma consultada es EXACTAMENTE la suya. */
  function makeRecetasPorFirma(receta: RecetaWeb): ReturnType<typeof makeRecetas> {
    const recetas = makeRecetas([]);
    return {
      ...recetas,
      buscarActiva: vi.fn(async (_ownerId: string, _dominio: string, firma: string) =>
        firma === receta.firmaObjetivo ? receta : null,
      ),
    };
  }

  it('encuentra lo aprendido y teclea los TRES datos nuevos, sin selector y sin motor', async () => {
    const recetas = makeRecetasPorFirma(makeRecetaDeCorreo(firmaDeObjetivo(APRENDIDA)));
    const determinista = makeDeterminista();
    const motor = makeMotor();
    const elector = makeElector(RESPUESTA_CORRECTA);

    const resultado = await procesarTareaWeb(
      makeDeps({
        recetas,
        determinista,
        motor,
        elector,
        navegador: makeNavegador(PAGINA_CON_LOS_NUEVOS),
      }),
      makeJobConObjetivo(NUEVA),
    );

    expect(resultado).toBe('completada');
    expect(elector.consultar).not.toHaveBeenCalled();
    expect(motor.ejecutar).not.toHaveBeenCalled();
    const tecleados = determinista.ejecutarPasoDeterminista.mock.calls
      .map((llamada) => (llamada[1] as { texto: string | null }).texto)
      .filter((texto): texto is string => texto !== null);
    expect(tecleados).toEqual([NUEVO_DESTINATARIO, NUEVO_ASUNTO, NUEVO_CUERPO]);
  });

  it('tambien se prueba la firma del TEXTO LITERAL del usuario, no solo la del objetivo del modelo', async () => {
    // Lo aprendido quedo bajo la firma del texto del usuario (una tarea ensenada desde una
    // grabacion); el objetivo que redacta el modelo es otro texto y por si solo no encontraria nada.
    const recetas = makeRecetasPorFirma(makeRecetaDeCorreo(firmaDeObjetivo(APRENDIDA)));
    const elector = makeElector(RESPUESTA_CORRECTA);

    const resultado = await procesarTareaWeb(
      makeDeps({ recetas, elector, navegador: makeNavegador(PAGINA_CON_LOS_NUEVOS) }),
      makeJobConObjetivo('enviale ese correo al contacto', NUEVA),
    );

    expect(resultado).toBe('completada');
    expect(elector.consultar).not.toHaveBeenCalled();
    expect(recetas.buscarActiva).toHaveBeenCalledTimes(2);
  });

  it('un fraseo libre NO dispara la via rapida: cae en el selector con modelo', async () => {
    const recetas = makeRecetasPorFirma(makeRecetaDeCorreo(firmaDeObjetivo(APRENDIDA)));
    const elector = makeElector(JSON.stringify({ tarea: null, datos: {} }));
    const motor = makeMotor();

    await procesarTareaWeb(
      makeDeps({ recetas, elector, motor, navegador: makeNavegador(PAGINA_CON_LOS_NUEVOS) }),
      makeJobConObjetivo(`Manda un correo a ${NUEVO_DESTINATARIO} con el asunto "${NUEVO_ASUNTO}" y dile: "${NUEVO_CUERPO}"`),
    ).catch(() => null);

    expect(recetas.buscarActiva).toHaveBeenCalled();
    expect(motor.ejecutar).toHaveBeenCalled();
  });
});
