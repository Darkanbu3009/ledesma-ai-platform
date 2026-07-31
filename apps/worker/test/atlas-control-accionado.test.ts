import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  GuardiaDeAccion,
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioAtlasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type { PasoCensurado, RegistradorDeTrayectorias, TrayectoriaNueva } from '../src/trayectoria.js';
import { AccionBloqueadaError, AccionSinConfirmarError } from '../src/errores.js';
import { claveDelAtlas, hashDeOrigen } from '../src/atlas-sitios.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * LA CLASE DEL CONTROL QUE CONSUMA LA ACCION FINAL, DE PUNTA A PUNTA EN EL HANDLER. Todo con fakes:
 * sin navegador, sin modelo y sin base.
 *
 * EL CIRCUITO CERRADO QUE ESTO ABRE. La barrera de identidad exige que la clase del control este
 * corroborada por el atlas; el atlas solo aprende de lo que la percepcion lee DESPUES de cada paso; y
 * la accion final destruye su propio contexto, asi que cuando esa lectura corre el control ya no
 * existe. La UNICA fuente que lo ve vivo es la propia barrera, que corre ANTES, y hasta este cambio
 * su lectura se descartaba. Resultado medido en produccion (30 y 31 jul 2026): tres corridas con
 * 'identidad:habria_bloqueado' y motivo 'clase_no_corroborada' sobre envios legitimos.
 *
 * Lo que estos tests fijan:
 *  - la clase se escribe SOLO tras una corrida exitosa con el efecto irreversible CONFIRMADO;
 *  - con mas de un candidato en la pagina NO se escribe (no hay certeza de cual se acciono);
 *  - un fallo de la escritura jamas cambia el desenlace del job;
 *  - el nombre real de Gmail (con sus marcas invisibles) produce la misma clase que el limpio;
 *  - dos origenes distintos corroboran la clase y la barrera deja de echarla en falta sola;
 *  - el mecanismo se resuelve por el VERBO DEL OBJETIVO y por el marcado del sitio, jamas por el
 *    dominio: funciona igual con 'comprar' y con 'publicar' que con 'enviar'.
 *
 * CONFIGURACION DE PRODUCCION: observador de pasos APAGADO (no se pasa `observadorPasos`, que es el
 * default del env), asi que la traza no aporta NI UNA entrada al atlas y todo lo que se escribe sale
 * del control que la guardia leyo. La barrera va en 'observacion', que es el default de
 * TAREA_WEB_BARRERA_IDENTIDAD.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const CLAVE = claveDelAtlas({ vaultSecret: 'a'.repeat(64) });

const OBJETIVO = 'envia el resumen mensual a juan@ejemplo.com';
const ACCIONES_HASTA_ENVIAR = ['escribe el destinatario', 'haz clic en el boton Enviar'];

/** La clase que la barrera echa en falta y que la corrida tiene que dejar escrita. */
const CLASE_ENVIAR = 'click|rol:button|enviar (ctrl-enter)';

/** El control que la barrera encuentra en el DOM, o null cuando no hay ninguno de la familia. */
type ControlFake = { ariaLabel: string; rol: string; candidatos: number } | null;

const CONTROL_ENVIAR: ControlFake = { ariaLabel: 'Enviar (Ctrl-Enter)', rol: 'button', candidatos: 1 };

/** El MISMO control con el nombre tal como lo emite Gmail: aislante bidi alrededor del atajo. */
const CONTROL_ENVIAR_REAL: ControlFake = {
  ariaLabel: 'Enviar ‪(Ctrl-Enter)‬',
  rol: 'button',
  candidatos: 1,
};

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(objetivo = OBJETIVO, ownerId = 'user-1'): Job {
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
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    startedAt: '2026-07-31T00:00:00.000Z',
    finishedAt: null,
  };
}

function makeSitio(dominio = DOMINIO): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio,
    urlLogin: `https://${dominio}/login`,
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

function makeRepo(dominio = DOMINIO): RepositorioSitiosParaTarea {
  const sitio = makeSitio(dominio);
  return {
    obtenerPorId: vi.fn(async () => sitio),
    obtenerContextoDescifrado: vi.fn(async () => CONTEXTO_PLANO),
    guardarContexto: vi.fn(async () => sitio),
    actualizarEstado: vi.fn(async () => sitio),
  };
}

/** Pagina MUTABLE: la accion irreversible la consuma (el formulario se cierra) y eso confirma. */
interface PaginaFake {
  campos: CampoDeLaPagina[];
  texto: string;
}

function makeNavegador(pagina: PaginaFake, control: ControlFake | 'sin_primitiva'): NavegadorParaTarea {
  const base: NavegadorParaTarea = {
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
  if (control === 'sin_primitiva') return base;
  return { ...base, localizarBotonPorAriaLabel: vi.fn(async () => control) };
}

/**
 * Motor FAKE con el MISMO protocolo que el adaptador real: pregunta a la guardia por cada accion
 * ANTES de ejecutarla y confirma las permitidas con `confirmar`. `consumaLaPagina` es lo que
 * distingue una accion que surtio efecto de una que no: sin eso el formulario sigue ahi.
 */
function makeMotor(
  acciones: string[],
  pagina: PaginaFake,
  consumaLaPagina: boolean,
): MotorDeTareaWeb & { ejecutadas: string[] } {
  const ejecutadas: string[] = [];
  return {
    ejecutadas,
    ejecutar: vi.fn(async (params: { guardia?: GuardiaDeAccion | undefined }) => {
      for (const accion of acciones) {
        const veredicto = await params.guardia?.revisar(accion);
        if (veredicto?.tipo === 'bloquear') {
          if (veredicto.causa === 'sin_efecto') throw new AccionSinConfirmarError(veredicto.mensaje);
          throw new AccionBloqueadaError(veredicto.mensaje);
        }
        if (veredicto?.tipo === 'incompleto' || veredicto?.tipo === 'rechazar') continue;
        ejecutadas.push(accion);
        if (veredicto?.tipo === 'permitir' && veredicto.confirmar === true && params.guardia) {
          if (consumaLaPagina) {
            pagina.campos = [];
            pagina.texto = 'Listo. Deshacer';
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
        mensaje: 'accion ejecutada',
        acciones: ejecutadas.map((accion) => ({ type: 'act', action: accion, success: true })),
        tokensIn: null,
        tokensOut: null,
      };
    }),
  } as unknown as MotorDeTareaWeb & { ejecutadas: string[] };
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

/** Atlas en memoria con la semantica del upsert real (ver tarea-web-atlas.test.ts). */
function makeAtlas(filas: FilaDeAtlas[] = []) {
  const observaciones: Array<Record<string, unknown>> = [];
  const repo: RepositorioAtlasParaWorker = {
    listarPorDominio: vi.fn(async (dominio: string) => filas.filter((fila) => fila.dominio === dominio)),
    registrarObservacion: vi.fn(async (observacion) => {
      observaciones.push({ ...observacion });
      const existente = filas.find(
        (fila) =>
          fila.dominio === observacion.dominio && fila.claseDeElemento === observacion.claseDeElemento,
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

function makeTrayectorias(): RegistradorDeTrayectorias & { guardadas: TrayectoriaNueva[] } {
  const guardadas: TrayectoriaNueva[] = [];
  return {
    guardadas,
    guardar: vi.fn(async (trayectoria: TrayectoriaNueva) => {
      guardadas.push(trayectoria);
    }),
  };
}

/** El escenario del caso real: el destinatario en pantalla, el motor redacta y acciona. */
function escenario(
  opciones: {
    control?: ControlFake | 'sin_primitiva';
    acciones?: string[];
    confirmaEfecto?: boolean;
    barreraIdentidad?: 'apagada' | 'observacion' | 'activa';
    filas?: FilaDeAtlas[];
    dominio?: string;
  } = {},
) {
  const pagina: PaginaFake = {
    campos: [{ contexto: 'input email para', valor: 'juan@ejemplo.com' }],
    texto: '',
  };
  const navegador = makeNavegador(pagina, opciones.control === undefined ? CONTROL_ENVIAR : opciones.control);
  const motor = makeMotor(
    opciones.acciones ?? ACCIONES_HASTA_ENVIAR,
    pagina,
    opciones.confirmaEfecto !== false,
  );
  const atlas = makeAtlas(opciones.filas ?? []);
  const trayectorias = makeTrayectorias();
  const deps = {
    repo: makeRepo(opciones.dominio),
    navegador,
    motor,
    trayectorias,
    aprobaciones: makeAprobacionesRepo(),
    politicas: makePoliticas(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    atlas: { repo: atlas.repo, clave: CLAVE },
    barreraIdentidad: opciones.barreraIdentidad ?? 'observacion',
    vaultSecret: 'a'.repeat(64),
    model: 'anthropic/claude-opus-4-5',
    maxPasos: 120,
    historialPasos: 8,
    modoScreenshots: 'cambios',
    runTimeoutMs: 600_000,
    resolveCredential: vi.fn(async () => ({
      providerId: 'anthropic' as const,
      apiKey: 'sk-owner',
      credentialId: 'cred-1',
    })),
    guardarResultado: vi.fn(async () => {}),
    esperar: async () => {},
    logger: makeLogger(),
  } as unknown as TareaWebDeps;
  return { deps, navegador, motor, atlas, trayectorias };
}

/** Las clases que la corrida dejo escritas en el atlas. */
function clasesEscritas(atlas: ReturnType<typeof makeAtlas>): string[] {
  return atlas.observaciones.map((observacion) => String(observacion.claseDeElemento));
}

/** Los pasos de identidad que la corrida dejo en la trayectoria. */
function pasosDeIdentidad(trayectorias: ReturnType<typeof makeTrayectorias>) {
  return (trayectorias.guardadas[0]?.pasos ?? []).filter((paso: PasoCensurado) =>
    paso.accion.tipo.startsWith('identidad:'),
  );
}

// -------------------------------------------------------------------------------------------------
// LA ESCRITURA: solo con efecto confirmado
// -------------------------------------------------------------------------------------------------

describe('la clase del control accionado llega al atlas', () => {
  it('una corrida exitosa CON efecto confirmado deja la clase que la barrera echaba en falta', async () => {
    const { deps, atlas, trayectorias } = escenario();

    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');

    // El atlas no sabia nada de este control (por eso la barrera lo dio por no corroborado) y ahora
    // si: es la MISMA clase, escrita por la unica fuente que ve vivo el elemento.
    expect(pasosDeIdentidad(trayectorias)[0]?.accion.argumentos).toContain('clase_no_corroborada');
    expect(clasesEscritas(atlas)).toEqual([CLASE_ENVIAR]);
    expect(atlas.filas[0]?.dominio).toBe(DOMINIO);
    expect(atlas.filas[0]?.estrategias).toEqual([
      { tipo: 'rol', rol: 'button', nombre: 'Enviar (Ctrl-Enter)' },
    ]);
  });

  it('la fila que se escribe no lleva nada del usuario ni de la corrida', async () => {
    const { deps, atlas } = escenario();

    await procesarTareaWeb(deps, makeJob('envia el resumen mensual a juan@ejemplo.com'));

    expect(Object.keys(atlas.observaciones[0] ?? {}).sort()).toEqual([
      'claseDeElemento',
      'dominio',
      'estrategias',
      'origenHash',
    ]);
    const serializado = JSON.stringify(atlas.observaciones);
    for (const prohibido of ['user-1', 'job-1', 'ses-1', 'juan@ejemplo.com']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
    expect(atlas.observaciones[0]?.origenHash).toBe(hashDeOrigen('user-1', CLAVE));
  });

  it('una corrida que NO confirma el efecto no escribe nada: la evidencia es la misma que exige el atlas', async () => {
    // El formulario sigue en pantalla despues de accionar: la guardia autoriza su unico reintento,
    // tampoco confirma, y el handler cierra la tarea como accion sin efecto confirmado.
    const { deps, navegador, atlas } = escenario({
      confirmaEfecto: false,
      acciones: [...ACCIONES_HASTA_ENVIAR, 'haz clic en el boton Enviar'],
    });

    await expect(procesarTareaWeb(deps, makeJob())).rejects.toThrow(/no se pudo confirmar/);
    // El control SI se leyo (la barrera corrio dos veces, una por intento): lo que falta es la
    // evidencia de que la accion surtio efecto, y sin ella no se aprende nada.
    expect(navegador.localizarBotonPorAriaLabel).toHaveBeenCalledTimes(2);
    expect(atlas.repo.registrarObservacion).not.toHaveBeenCalled();
    expect(atlas.filas).toEqual([]);
  });

  it('con MAS DE UN candidato en la pagina no se escribe, y la corrida termina igual', async () => {
    const { deps, navegador, atlas, motor } = escenario({
      control: { ariaLabel: 'Enviar (Ctrl-Enter)', rol: 'button', candidatos: 2 },
    });

    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    expect(navegador.localizarBotonPorAriaLabel).toHaveBeenCalledTimes(1);
    expect(atlas.repo.registrarObservacion).not.toHaveBeenCalled();
  });

  it('un fallo de la escritura NO cambia el desenlace del job', async () => {
    const { deps, atlas } = escenario();
    atlas.repo.registrarObservacion = vi.fn(async () => {
      throw new Error('la base no respondio');
    });

    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(deps.guardarResultado).toHaveBeenCalledWith('job-1', expect.objectContaining({ estado: 'ok' }));
  });

  it('sin lectura del control no se inventa ninguna clase', async () => {
    const sinPrimitiva = escenario({ control: 'sin_primitiva' });
    await expect(procesarTareaWeb(sinPrimitiva.deps, makeJob())).resolves.toBe('completada');
    expect(sinPrimitiva.atlas.repo.registrarObservacion).not.toHaveBeenCalled();

    const sinControl = escenario({ control: null });
    await expect(procesarTareaWeb(sinControl.deps, makeJob())).resolves.toBe('completada');
    expect(sinControl.atlas.repo.registrarObservacion).not.toHaveBeenCalled();

    const apagada = escenario({ barreraIdentidad: 'apagada' });
    await expect(procesarTareaWeb(apagada.deps, makeJob())).resolves.toBe('completada');
    expect(apagada.atlas.repo.registrarObservacion).not.toHaveBeenCalled();
  });

  it('el nombre REAL de Gmail (con marcas bidi) escribe la MISMA clase que el limpio', async () => {
    const real = escenario({ control: CONTROL_ENVIAR_REAL });
    const limpio = escenario({ control: CONTROL_ENVIAR });

    await procesarTareaWeb(real.deps, makeJob());
    await procesarTareaWeb(limpio.deps, makeJob());

    expect(clasesEscritas(real.atlas)).toEqual(clasesEscritas(limpio.atlas));
    expect(clasesEscritas(real.atlas)).toEqual([CLASE_ENVIAR]);
  });
});

// -------------------------------------------------------------------------------------------------
// EL CIRCUITO SE ABRE: lo que se escribe es lo que la barrera vuelve a leer
// -------------------------------------------------------------------------------------------------

describe('el circuito cerrado de la barrera se abre', () => {
  it('dos origenes distintos corroboran la clase y la tercera corrida ya la ve permitida', async () => {
    const filas: FilaDeAtlas[] = [];

    const primera = escenario({ filas });
    await procesarTareaWeb(primera.deps, makeJob(OBJETIVO, 'user-1'));
    expect(pasosDeIdentidad(primera.trayectorias)[0]?.accion.tipo).toBe('identidad:habria_bloqueado');

    const segunda = escenario({ filas });
    await procesarTareaWeb(segunda.deps, makeJob(OBJETIVO, 'user-2'));

    expect(filas).toHaveLength(1);
    expect(filas[0]?.claseDeElemento).toBe(CLASE_ENVIAR);
    expect(filas[0]?.origenesHash).toHaveLength(2);

    // Un TERCER origen, que no aporto nada, ya recibe la clase corroborada: la barrera permite.
    const tercera = escenario({ filas });
    await procesarTareaWeb(tercera.deps, makeJob(OBJETIVO, 'user-3'));
    expect(pasosDeIdentidad(tercera.trayectorias)[0]?.accion.tipo).toBe('identidad:permitida');
  });
});

// -------------------------------------------------------------------------------------------------
// LA FAMILIA SALE DEL OBJETIVO DEL USUARIO, JAMAS DEL DOMINIO
// -------------------------------------------------------------------------------------------------

describe('el mecanismo se resuelve por el verbo del objetivo, nunca por el sitio', () => {
  /** Lo que la corrida le pide al navegador buscar en el DOM. */
  function prefijosPedidos(navegador: NavegadorParaTarea): string[] {
    const localizar = navegador.localizarBotonPorAriaLabel as unknown as {
      mock: { calls: Array<[string, string[]]> };
    };
    return localizar.mock.calls[0]?.[1] ?? [];
  }

  it('comprar en una tienda: misma cadena, otra familia, otra clase', async () => {
    const { deps, navegador, atlas } = escenario({
      dominio: 'tienda.ejemplo.com',
      acciones: ['revisa el carrito', 'haz clic en el boton Comprar ahora'],
      control: { ariaLabel: 'Comprar ahora', rol: 'button', candidatos: 1 },
    });

    await expect(
      procesarTareaWeb(deps, makeJob('compra ahora el articulo que quedo en el carrito')),
    ).resolves.toBe('completada');

    expect(prefijosPedidos(navegador)).toContain('comprar');
    expect(prefijosPedidos(navegador)).toContain('checkout');
    expect(clasesEscritas(atlas)).toEqual(['click|rol:button|comprar ahora']);
    expect(atlas.filas[0]?.dominio).toBe('tienda.ejemplo.com');
  });

  it('publicar en otro sitio: el mismo mecanismo, sin una sola regla propia', async () => {
    const { deps, navegador, atlas } = escenario({
      dominio: 'blog.ejemplo.com',
      acciones: ['escribe la entrada', 'haz clic en el boton Publicar entrada'],
      control: { ariaLabel: 'Publicar entrada', rol: 'button', candidatos: 1 },
    });

    await expect(procesarTareaWeb(deps, makeJob('publica la entrada del blog'))).resolves.toBe(
      'completada',
    );

    expect(prefijosPedidos(navegador)).toEqual(['publicar', 'publish']);
    expect(clasesEscritas(atlas)).toEqual(['click|rol:button|publicar entrada']);
  });

  it('el MISMO objetivo en dos dominios distintos pide exactamente los mismos prefijos', async () => {
    const correo = escenario({ dominio: 'correo.ejemplo.com' });
    const otro = escenario({ dominio: 'otrocorreo.ejemplo.com' });

    await procesarTareaWeb(correo.deps, makeJob());
    await procesarTareaWeb(otro.deps, makeJob());

    expect(prefijosPedidos(correo.navegador)).toEqual(prefijosPedidos(otro.navegador));
    expect(prefijosPedidos(correo.navegador)).toEqual(['enviar', 'send']);
  });

  it('y el mismo sitio con DOS objetivos distintos aprende dos controles distintos', async () => {
    // La familia sale del objetivo del usuario: cambiar el verbo cambia el control que se busca y la
    // clase que se aprende, sin que el dominio intervenga en ninguna de las dos decisiones.
    const filas: FilaDeAtlas[] = [];
    const enviar = escenario({ filas });
    const borrar = escenario({
      filas,
      acciones: ['abre el mensaje', 'haz clic en el boton Eliminar definitivamente'],
      control: { ariaLabel: 'Eliminar definitivamente', rol: 'button', candidatos: 1 },
    });

    await procesarTareaWeb(enviar.deps, makeJob(OBJETIVO));
    await procesarTareaWeb(borrar.deps, makeJob('elimina el ultimo mensaje de la bandeja'));

    expect(filas.map((fila) => fila.claseDeElemento)).toEqual([
      CLASE_ENVIAR,
      'click|rol:button|eliminar definitivamente',
    ]);
  });
});
