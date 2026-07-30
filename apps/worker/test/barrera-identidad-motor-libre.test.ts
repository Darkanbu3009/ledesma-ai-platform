import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  GuardiaDeAccion,
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RegistradorDeTrayectorias,
  RepositorioAtlasParaWorker,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
  TrayectoriaNueva,
} from '../src/tarea-web.js';
import { AccionBloqueadaError, AccionSinConfirmarError } from '../src/errores.js';
import { claveDelAtlas } from '../src/atlas-sitios.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * BARRERA DE IDENTIDAD EN EL MOTOR LIBRE (FIX A) y NO REGRESION (FIX B). Todo con FAKES: sin
 * navegador, sin modelo y sin base.
 *
 * EL HUECO QUE CIERRA. La barrera ya estaba cableada en el ejecutor de recetas, pero el motor libre
 * no pasa por ahi: sus acciones van por la GUARDIA (crearGuardiaDeAccion), otro camino entero. Dos
 * corridas del motor libre en produccion (30 jul 2026) no dejaron ni una etiqueta de identidad en su
 * trayectoria porque ese codigo nunca se ejecuto.
 *
 * Lo que estos tests fijan, y es la condicion para que esto pueda tocar produccion:
 *  - en MODO OBSERVACION el desenlace de una corrida es IDENTICO al de hoy, incluido el caso en el
 *    que la barrera HABRIA bloqueado;
 *  - un fallo de la propia barrera no altera nada (queda como identidad:no_evaluable);
 *  - el veredicto queda en la trayectoria con la MISMA etiqueta que el camino de recetas;
 *  - el nombre accesible se lee SOLO en la accion irreversible: una conexion por corrida, no una por
 *    accion (una corrida de 28 pasos no paga 28 lecturas);
 *  - en 'activa' el bloqueo viaja por el cierre que ya existe (DETENIDA_VERIFICACION) y la accion no
 *    llega al navegador.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';
const CLAVE = claveDelAtlas({ vaultSecret: 'a'.repeat(64) });
/** La clase que claseDeElemento produce para el boton Enviar leido del DOM por la barrera. */
const CLASE_ENVIAR = 'click|rol:button|enviar (ctrl-enter)';
const OBJETIVO = 'envia el resumen mensual a juan@ejemplo.com';
const ACCIONES_HASTA_ENVIAR = ['escribe el destinatario', 'haz clic en el boton Enviar'];

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(objetivo = OBJETIVO): Job {
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

/** Pagina MUTABLE: la accion irreversible la consuma (el redactor se cierra) y eso confirma su efecto. */
interface PaginaFake {
  campos: CampoDeLaPagina[];
  texto: string;
}

/** El boton que la barrera encuentra en el DOM, o null cuando no hay ninguno de la familia. */
type BotonFake = { ariaLabel: string; rol: string; candidatos: number } | null;

const BOTON_ENVIAR: BotonFake = { ariaLabel: 'Enviar (Ctrl-Enter)', rol: 'button', candidatos: 1 };

function makeNavegador(
  pagina: PaginaFake,
  boton: BotonFake | 'sin_primitiva' | 'falla' = BOTON_ENVIAR,
): NavegadorParaTarea {
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
  if (boton === 'sin_primitiva') return base;
  return {
    ...base,
    localizarBotonPorAriaLabel: vi.fn(async () => {
      if (boton === 'falla') throw new Error('la sesion de navegador se cayo');
      return boton;
    }),
  };
}

/**
 * Motor FAKE con el MISMO protocolo que el adaptador real (crearActBlindado, stagehand.ts): le
 * pregunta a la guardia por cada accion ANTES de ejecutarla, un bloqueo lanza y una accion permitida
 * con `confirmar` se confirma tras tocar la pagina.
 */
function makeMotor(
  acciones: string[] = ACCIONES_HASTA_ENVIAR,
  pagina?: PaginaFake,
): MotorDeTareaWeb & { ejecutadas: string[]; rechazadas: string[] } {
  const ejecutadas: string[] = [];
  const rechazadas: string[] = [];
  return {
    ejecutadas,
    rechazadas,
    ejecutar: vi.fn(async (params: { guardia?: GuardiaDeAccion | undefined }) => {
      for (const accion of acciones) {
        const veredicto = await params.guardia?.revisar(accion);
        if (veredicto?.tipo === 'bloquear') {
          if (veredicto.causa === 'sin_efecto') throw new AccionSinConfirmarError(veredicto.mensaje);
          throw new AccionBloqueadaError(veredicto.mensaje);
        }
        if (veredicto?.tipo === 'incompleto' || veredicto?.tipo === 'rechazar') {
          rechazadas.push(accion);
          continue;
        }
        ejecutadas.push(accion);
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
        mensaje: 'accion ejecutada',
        acciones: ejecutadas.map((accion) => ({ type: 'act', action: accion, success: true })),
        tokensIn: null,
        tokensOut: null,
      };
    }),
  } as unknown as MotorDeTareaWeb & { ejecutadas: string[]; rechazadas: string[] };
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

/** Atlas fake de SOLO LECTURA con las clases que el dominio tiene corroboradas. */
function makeAtlas(clases: string[]): { repo: RepositorioAtlasParaWorker; clave: string } {
  return {
    clave: CLAVE,
    repo: {
      listarPorDominio: vi.fn(async (dominio: string) =>
        dominio !== DOMINIO
          ? []
          : clases.map((claseDeElemento) => ({
              claseDeElemento,
              estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Enviar (Ctrl-Enter)' }],
              corroboraciones: 4,
              // DOS origenes independientes: es lo que hace servible una entrada ajena (invariante 3).
              origenesHash: ['origen-a', 'origen-b'],
            })),
      ),
      registrarObservacion: vi.fn(async () => {}),
    },
  };
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

function makeDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: makeRepo(),
    navegador: makeNavegador({ campos: [], texto: '' }),
    motor: makeMotor(),
    aprobaciones: makeAprobacionesRepo(),
    politicas: makePoliticas(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
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
    ...overrides,
  } as unknown as TareaWebDeps;
}

/** El escenario del caso real: el destinatario esta en pantalla y el motor redacta y envia. */
function escenario(
  opciones: {
    clasesDelAtlas?: string[];
    boton?: BotonFake | 'sin_primitiva' | 'falla';
    barreraIdentidad?: 'apagada' | 'observacion' | 'activa' | undefined;
    acciones?: string[];
  } = {},
) {
  const pagina: PaginaFake = {
    campos: [{ contexto: 'input email para', valor: 'juan@ejemplo.com' }],
    texto: '',
  };
  const navegador = makeNavegador(
    pagina,
    opciones.boton === undefined ? BOTON_ENVIAR : opciones.boton,
  );
  const motor = makeMotor(opciones.acciones ?? ACCIONES_HASTA_ENVIAR, pagina);
  const trayectorias = makeTrayectorias();
  const deps = makeDeps({
    navegador,
    motor,
    trayectorias,
    atlas: makeAtlas(opciones.clasesDelAtlas ?? [CLASE_ENVIAR]),
    ...(opciones.barreraIdentidad === undefined ? {} : { barreraIdentidad: opciones.barreraIdentidad }),
  });
  return { deps, navegador, motor, trayectorias };
}

/** Los pasos de identidad que la corrida dejo en la trayectoria. */
function pasosDeIdentidad(trayectorias: ReturnType<typeof makeTrayectorias>) {
  return (trayectorias.guardadas[0]?.pasos ?? []).filter((paso) =>
    paso.accion.tipo.startsWith('identidad:'),
  );
}

// -------------------------------------------------------------------------------------------------
// FIX A: la barrera se evalua y queda registrada
// -------------------------------------------------------------------------------------------------

describe('la barrera de identidad se interpone en el motor libre', () => {
  it('registra identidad:permitida cuando el DOM muestra el control del verbo y el atlas lo corroboro', async () => {
    const { deps, motor, trayectorias } = escenario({ barreraIdentidad: 'observacion' });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    const identidad = pasosDeIdentidad(trayectorias);
    expect(identidad).toHaveLength(1);
    expect(identidad[0]?.accion.tipo).toBe('identidad:permitida');
    expect(identidad[0]?.exito).toBe(true);
  });

  it('el nombre accesible se lee SOLO en la accion irreversible: una lectura por corrida, no por accion', async () => {
    const acciones = [
      'abre el redactor',
      'escribe el destinatario',
      'escribe el asunto',
      'escribe el cuerpo del mensaje',
      'haz clic en el boton Enviar',
    ];
    const { deps, navegador } = escenario({ barreraIdentidad: 'observacion', acciones });
    await procesarTareaWeb(deps, makeJob());
    expect(navegador.localizarBotonPorAriaLabel).toHaveBeenCalledTimes(1);
  });

  it('la clase que la barrera compara sale del elemento LEIDO DEL DOM, no de la descripcion del modelo', async () => {
    // El atlas no corroboro esa clase en este dominio: el veredicto lo dice, y no bloquea nada.
    const { deps, motor, trayectorias } = escenario({
      barreraIdentidad: 'observacion',
      clasesDelAtlas: ['click|rol:button|redactar'],
    });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    const identidad = pasosDeIdentidad(trayectorias);
    expect(identidad[0]?.accion.tipo).toBe('identidad:habria_bloqueado');
    expect(identidad[0]?.accion.argumentos).toContain('clase_no_corroborada');
  });

  it('distingue en la traza el caso en el que la pagina no muestra ningun control de la familia', async () => {
    const { deps, trayectorias } = escenario({ barreraIdentidad: 'observacion', boton: null });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    const identidad = pasosDeIdentidad(trayectorias);
    expect(identidad[0]?.accion.tipo).toBe('identidad:habria_bloqueado');
    expect(identidad[0]?.accion.argumentos).toContain(
      'sin elemento de la familia del verbo en la pagina',
    );
  });

  it('APAGADA no evalua nada: ni lectura extra ni paso sintetico', async () => {
    const { deps, navegador, motor, trayectorias } = escenario({ barreraIdentidad: 'apagada' });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(navegador.localizarBotonPorAriaLabel).not.toHaveBeenCalled();
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    expect(pasosDeIdentidad(trayectorias)).toEqual([]);
  });

  it('un objetivo SIN verbo bloqueado no paga ninguna lectura: no hay identidad que comprobar', async () => {
    const { deps, navegador } = escenario({ barreraIdentidad: 'observacion' });
    await expect(
      procesarTareaWeb(deps, makeJob('busca el resumen mensual en la bandeja')),
    ).resolves.toBe('completada');
    expect(navegador.localizarBotonPorAriaLabel).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------------------------------
// FIX B: NO REGRESION. El desenlace en observacion es IDENTICO al de hoy
// -------------------------------------------------------------------------------------------------

describe('modo observacion: el desenlace es identico al de hoy (FIX B)', () => {
  it('la corrida que la barrera HABRIA bloqueado termina exactamente igual que sin barrera', async () => {
    // Mismo escenario, dos corridas: con la barrera apagada y con la barrera en observacion sobre un
    // atlas que no corrobora nada (veredicto de bloqueo en las dos acciones posibles).
    const sinBarrera = escenario({ barreraIdentidad: 'apagada', clasesDelAtlas: [] });
    const conBarrera = escenario({ barreraIdentidad: 'observacion', clasesDelAtlas: [] });
    const referencia = await procesarTareaWeb(sinBarrera.deps, makeJob());
    const observada = await procesarTareaWeb(conBarrera.deps, makeJob());
    expect(observada).toBe(referencia);
    expect(conBarrera.motor.ejecutadas).toEqual(sinBarrera.motor.ejecutadas);
    expect(conBarrera.deps.guardarResultado).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ estado: 'ok' }),
    );
    // Y el veredicto quedo registrado: la medicion existe, el desenlace no cambio.
    expect(pasosDeIdentidad(conBarrera.trayectorias)[0]?.accion.tipo).toBe(
      'identidad:habria_bloqueado',
    );
  });

  it('un FALLO de la barrera no altera nada: queda no_evaluable y la accion sigue su camino', async () => {
    const { deps, motor, trayectorias } = escenario({
      barreraIdentidad: 'observacion',
      boton: 'falla',
    });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    const identidad = pasosDeIdentidad(trayectorias);
    expect(identidad[0]?.accion.tipo).toBe('identidad:no_evaluable');
    expect(identidad[0]?.exito).toBe(true);
  });

  it('un navegador SIN la primitiva de lectura corre igual (falla cerrada, jamas una excepcion)', async () => {
    const { deps, motor, trayectorias } = escenario({
      barreraIdentidad: 'observacion',
      boton: 'sin_primitiva',
    });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
    expect(pasosDeIdentidad(trayectorias)[0]?.accion.tipo).toBe('identidad:habria_bloqueado');
  });
});

// -------------------------------------------------------------------------------------------------
// MODO ACTIVA: el bloqueo viaja por el cierre que YA existe
// -------------------------------------------------------------------------------------------------

describe("modo activa: el bloqueo se traduce al veredicto 'bloquear' de la guardia", () => {
  it('la accion NO llega al navegador y la corrida cierra con DETENIDA_VERIFICACION', async () => {
    const { deps, motor } = escenario({ barreraIdentidad: 'activa', clasesDelAtlas: [] });
    await expect(procesarTareaWeb(deps, makeJob())).rejects.toThrow(/DETENIDA_VERIFICACION/);
    // Los pasos intermedios corrieron; la accion irreversible NO.
    expect(motor.ejecutadas).toEqual(['escribe el destinatario']);
  });

  it('un veredicto de permitir en activa deja pasar la accion igual que en observacion', async () => {
    const { deps, motor } = escenario({ barreraIdentidad: 'activa' });
    await expect(procesarTareaWeb(deps, makeJob())).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(ACCIONES_HASTA_ENVIAR);
  });
});
