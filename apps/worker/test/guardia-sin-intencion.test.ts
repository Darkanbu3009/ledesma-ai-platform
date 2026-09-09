import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import { parsearDetencion } from '@ledesma-platform/shared/verificacion';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  GuardiaDeAccion,
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import type {
  PasoCensurado,
  RegistradorDeTrayectorias,
  TrayectoriaNueva,
} from '../src/trayectoria.js';
import { AccionBloqueadaError, AccionSinConfirmarError } from '../src/errores.js';
import { verificarAccion } from '../src/verificacion.js';
import type { CampoDeLaPagina, RepositorioPoliticasParaWorker } from '../src/verificacion.js';
import { extraerParametrosDeclarados } from '../src/parametros-objetivo.js';
import { esNavegacionDeSoloLectura } from '../src/prompt-tarea-web.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import type { Logger } from '../src/logger.js';

/**
 * SIN INTENCION RECONOCIDA, LA GUARDIA NO DEJA PASAR SIN COMPARAR. Todo con FAKES: sin navegador, sin
 * modelo y sin base.
 *
 * EL HUECO QUE CIERRA, medido antes de escribir una linea: de 16 peticiones realistas escritas para
 * siete familias de interfaz, 16 no tienen ninguna intencion en el vocabulario cerrado de ocho verbos,
 * y sin verbo la guardia hacia `return permitir` sin comparar nada. Ademas, en las familias que SI
 * existen pero no exigen ningun parametro (borrar, publicar, comprar, firmar, cancelar suscripcion) la
 * verificacion determinista resolvia 'ejecutar' con CERO comparaciones.
 *
 * LA REGLA QUE ESTOS TESTS FIJAN: una intencion que el sistema no reconoce jamas puede resultar en
 * tratar la accion como reversible, y una accion irreversible sobre la que no se pudo comparar NADA no
 * se ejecuta. Con el default de produccion ('observacion') no se detiene nada: solo se cuenta.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });
const DOMINIO = 'correo.ejemplo.com';

/** La traza REAL de una corrida de enviar (el unico trafico de produccion hoy). */
const TRAZA_REAL_DE_ENVIAR = [
  'click the Redactar button to compose a new email',
  'click the Para input field in the compose window',
  'type "juan@ejemplo.com" into the Para field',
  'click the Enviar button in the compose window',
];
const OBJETIVO_DE_ENVIAR = 'envia el resumen mensual a juan@ejemplo.com';

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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    startedAt: '2026-09-01T00:00:00.000Z',
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
    creadoEn: '2026-08-16T00:00:00.000Z',
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

/** Pagina MUTABLE: la accion irreversible la consuma (el redactor se cierra) y confirma su efecto. */
interface PaginaFake {
  campos: CampoDeLaPagina[];
  texto: string;
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

/**
 * Motor FAKE con el MISMO protocolo que el adaptador real (crearActBlindado, stagehand.ts): le
 * pregunta a la guardia por cada accion ANTES de ejecutarla, un bloqueo lanza y una accion permitida
 * con `confirmar` se confirma tras tocar la pagina.
 */
function makeMotor(
  acciones: string[],
  pagina: PaginaFake,
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
          pagina.campos = [];
          pagina.texto = 'Mensaje enviado. Deshacer';
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

function makeTrayectorias(): RegistradorDeTrayectorias & { guardadas: TrayectoriaNueva[] } {
  const guardadas: TrayectoriaNueva[] = [];
  return {
    guardadas,
    guardar: vi.fn(async (trayectoria: TrayectoriaNueva) => {
      guardadas.push(trayectoria);
    }),
  };
}

type Modo = 'apagada' | 'observacion' | 'activa';

/**
 * El escenario: un objetivo, las acciones que el motor propone y el modo de la guardia. La pagina no
 * muestra ningun dato comparable, que es el estado normal de un objetivo que no declara ninguno.
 */
function escenario(opciones: { objetivo: string; acciones: string[]; modo?: Modo | undefined }) {
  const pagina: PaginaFake = { campos: [], texto: 'Bandeja de entrada' };
  const navegador = makeNavegador(pagina);
  const motor = makeMotor(opciones.acciones, pagina);
  const trayectorias = makeTrayectorias();
  const politicas = makePoliticas();
  const guardarResultado = vi.fn(async () => {});
  const deps = {
    repo: makeRepo(),
    navegador,
    motor,
    trayectorias,
    aprobaciones: makeAprobacionesRepo(),
    politicas,
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
    guardarResultado,
    esperar: async () => {},
    logger: makeLogger(),
    ...(opciones.modo === undefined ? {} : { guardiaSinIntencion: opciones.modo }),
  } as unknown as TareaWebDeps;
  return { deps, motor, trayectorias, politicas, guardarResultado, job: makeJob(opciones.objetivo) };
}

/** Los pasos que la guardia con criterio generico dejo en la trayectoria. */
function pasosDeGuardia(trayectorias: ReturnType<typeof makeTrayectorias>): PasoCensurado[] {
  return (trayectorias.guardadas[0]?.pasos ?? []).filter((paso: PasoCensurado) =>
    paso.accion.tipo.startsWith('guardia_generica:'),
  );
}

/** El resultado que el cierre exitoso guardo, para leerle la telemetria de observacion. */
function resultadoGuardado(guardar: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const ultima = guardar.mock.calls.at(-1);
  return (ultima?.[1] ?? {}) as Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------------
// D1: INTENCION QUE EL SISTEMA NO RECONOCE
// -------------------------------------------------------------------------------------------------

/**
 * Los seis verbos con los que se midio el agujero. Ninguno esta en VERBOS_ACCION_BLOQUEADA y los seis
 * describen acciones que no se pueden deshacer.
 */
const OBJETIVOS_SIN_INTENCION: readonly { objetivo: string; accion: string }[] = [
  { objetivo: 'desactiva la cuenta de servicio', accion: 'haz clic en el boton Desactivar' },
  { objetivo: 'archiva la conversacion del proyecto', accion: 'haz clic en el boton Archivar' },
  { objetivo: 'revoca el acceso de la aplicacion', accion: 'haz clic en el boton Revocar' },
  { objetivo: 'da de baja el servicio contratado', accion: 'haz clic en el boton Dar de baja' },
  { objetivo: 'vacia la papelera de la cuenta', accion: 'haz clic en el boton Vaciar ahora' },
  { objetivo: 'reinicia el servidor de pruebas', accion: 'haz clic en el boton Reiniciar' },
];

describe('intencion desconocida: hay guardia con criterio generico, nunca ausencia de guardia', () => {
  for (const { objetivo, accion } of OBJETIVOS_SIN_INTENCION) {
    it(`modo activa: "${objetivo}" se detiene y la accion NO llega al navegador`, async () => {
      const { deps, motor, job } = escenario({ objetivo, acciones: [accion], modo: 'activa' });
      await expect(procesarTareaWeb(deps, job)).rejects.toThrow(/DETENIDA_VERIFICACION/);
      expect(motor.ejecutadas).toEqual([]);
    });

    it(`modo observacion: "${objetivo}" se registra y NO se detiene`, async () => {
      const { deps, motor, trayectorias, job } = escenario({
        objetivo,
        acciones: [accion],
        modo: 'observacion',
      });
      await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
      expect(motor.ejecutadas).toEqual([accion]);
      const pasos = pasosDeGuardia(trayectorias);
      expect(pasos[0]?.accion.tipo).toBe('guardia_generica:habria_detenido');
      // El paso NO es un fallo: la accion siguio su camino y marcarlo fallido leeria como si algo
      // no hubiera corrido.
      expect(pasos[0]?.exito).toBe(true);
    });
  }

  it('el motivo de la detencion es de VOCABULARIO CERRADO: sinEvidenciaParaComparar', async () => {
    const { deps, job } = escenario({
      objetivo: 'desactiva la cuenta de servicio',
      acciones: ['haz clic en el boton Desactivar'],
      modo: 'activa',
    });
    const error = await procesarTareaWeb(deps, job).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(parsearDetencion(error?.message)?.motivo).toBe('sinEvidenciaParaComparar');
  });

  it('modo apagada: el comportamiento es el anterior a este cambio, sin un solo paso nuevo', async () => {
    const { deps, motor, trayectorias, job } = escenario({
      objetivo: 'desactiva la cuenta de servicio',
      acciones: ['haz clic en el boton Desactivar'],
      modo: 'apagada',
    });
    await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(['haz clic en el boton Desactivar']);
    expect(pasosDeGuardia(trayectorias)).toEqual([]);
  });

  /**
   * TODA esta rama es comportamiento NUEVO: hasta hoy una corrida sin verbo no podia detenerse aqui
   * por NINGUN motivo, ni siquiera por la politica del usuario. En observacion, entonces, NINGUN
   * veredicto puede detener nada, no solo el de cero comparaciones.
   */
  const DETENCIONES_QUE_NO_EXISTIAN: readonly {
    caso: string;
    motivo: string;
    prepara: (politicas: RepositorioPoliticasParaWorker) => void;
  }[] = [
    {
      caso: 'el usuario apago las acciones irreversibles',
      motivo: 'accionesDesactivadas',
      prepara: (politicas) => {
        (politicas.obtenerPorOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
          ejecutarAccionesIrreversibles: false,
          topeMontoSinConfirmacion: 5000,
          sitiosExcluidos: [],
        });
      },
    },
    {
      caso: 'no se pudieron leer las preferencias del usuario',
      motivo: 'politicaNoDisponible',
      prepara: (politicas) => {
        (politicas.obtenerPorOwner as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('base caida'),
        );
      },
    },
  ];

  for (const { caso, motivo, prepara } of DETENCIONES_QUE_NO_EXISTIAN) {
    it(`observacion: ${caso} tampoco detiene (motivo ${motivo} solo en activa)`, async () => {
      const enObservacion = escenario({
        objetivo: 'desactiva la cuenta de servicio',
        acciones: ['haz clic en el boton Desactivar'],
        modo: 'observacion',
      });
      prepara(enObservacion.politicas);
      await expect(procesarTareaWeb(enObservacion.deps, enObservacion.job)).resolves.toBe(
        'completada',
      );
      expect(enObservacion.motor.ejecutadas).toEqual(['haz clic en el boton Desactivar']);
      expect(pasosDeGuardia(enObservacion.trayectorias)[0]?.accion.tipo).toBe(
        'guardia_generica:habria_detenido',
      );

      const enActiva = escenario({
        objetivo: 'desactiva la cuenta de servicio',
        acciones: ['haz clic en el boton Desactivar'],
        modo: 'activa',
      });
      prepara(enActiva.politicas);
      const error = await procesarTareaWeb(enActiva.deps, enActiva.job).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(parsearDetencion(error?.message)?.motivo).toBe(motivo);
      expect(enActiva.motor.ejecutadas).toEqual([]);
      expect(pasosDeGuardia(enActiva.trayectorias)[0]?.accion.tipo).toBe(
        'guardia_generica:detenida',
      );
    });
  }

  it('con un dato declarado que SI esta en la pagina, la accion pasa tambien en modo activa', async () => {
    // La guardia no es un "no" general: cuando hay algo que comparar, compara y deja pasar. Es lo que
    // separa "no se pudo comprobar nada" de "se comprobo y no corresponde".
    const { deps, motor, job } = escenario({
      objetivo: 'archiva la conversacion con juan@ejemplo.com',
      acciones: ['haz clic en el boton Archivar'],
      modo: 'activa',
    });
    (deps.navegador.leerCamposDeLaPagina as ReturnType<typeof vi.fn>).mockResolvedValue([
      { contexto: 'input email para', valor: 'juan@ejemplo.com' },
    ]);
    await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
    expect(motor.ejecutadas).toEqual(['haz clic en el boton Archivar']);
  });
});

// -------------------------------------------------------------------------------------------------
// D2: INTENCION RECONOCIDA QUE NO EXIGE PARAMETROS (borrar, publicar)
// -------------------------------------------------------------------------------------------------

describe('intencion reconocida sin parametro exigido: cero comparaciones no ejecuta', () => {
  const CASOS: readonly { objetivo: string; accion: string }[] = [
    { objetivo: 'elimina el ultimo mensaje de la bandeja', accion: 'haz clic en el boton Eliminar' },
    { objetivo: 'publica la entrada del blog', accion: 'haz clic en el boton Publicar' },
    { objetivo: 'borra el borrador que quedo abierto', accion: 'haz clic en el boton Borrar' },
  ];

  for (const { objetivo, accion } of CASOS) {
    it(`modo activa: "${objetivo}" se detiene con sinEvidenciaParaComparar`, async () => {
      const { deps, motor, job } = escenario({ objetivo, acciones: [accion], modo: 'activa' });
      const error = await procesarTareaWeb(deps, job).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(parsearDetencion(error?.message)?.motivo).toBe('sinEvidenciaParaComparar');
      expect(motor.ejecutadas).toEqual([]);
    });

    it(`modo observacion: "${objetivo}" se registra y NO se detiene`, async () => {
      const { deps, motor, job } = escenario({ objetivo, acciones: [accion], modo: 'observacion' });
      await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
      expect(motor.ejecutadas).toEqual([accion]);
    });
  }
});

// -------------------------------------------------------------------------------------------------
// LA EXENCION: navegacion y lectura reconocidas
// -------------------------------------------------------------------------------------------------

describe('navegacion y lectura reconocidas: pasan sin guardia en los dos modos', () => {
  const SOLO_LECTURA = [
    'lee el resumen de la bandeja',
    'scroll down to see more messages',
    'click the Enviados link in the Gmail left sidebar',
    'extract the list of unread messages',
  ];

  for (const modo of ['observacion', 'activa'] as const) {
    it(`modo ${modo}: ninguna se detiene y ninguna deja paso de guardia`, async () => {
      const { deps, motor, trayectorias, job } = escenario({
        objetivo: 'revisa la bandeja y dime que llego',
        acciones: SOLO_LECTURA,
        modo,
      });
      await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
      expect(motor.ejecutadas).toEqual(SOLO_LECTURA);
      expect(pasosDeGuardia(trayectorias)).toEqual([]);
    });
  }

  it('la exencion es la de esNavegacionDeSoloLectura y ninguna otra', () => {
    for (const accion of SOLO_LECTURA) expect(esNavegacionDeSoloLectura(accion)).toBe(true);
    for (const { accion } of OBJETIVOS_SIN_INTENCION) {
      expect(esNavegacionDeSoloLectura(accion)).toBe(false);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// D5: EL CAMINO DE ENVIAR NO CAMBIA (el unico con trafico real hoy)
// -------------------------------------------------------------------------------------------------

describe('regresion de produccion: la traza real de enviar no se mueve en ningun modo', () => {
  it('mismo veredicto, mismas acciones ejecutadas y cero pasos de guardia generica', async () => {
    const corridas = await Promise.all(
      (['apagada', 'observacion', 'activa'] as const).map(async (modo) => {
        const { deps, motor, trayectorias, job } = escenario({
          objetivo: OBJETIVO_DE_ENVIAR,
          acciones: TRAZA_REAL_DE_ENVIAR,
          modo,
        });
        // El destinatario que el objetivo declara SI esta en la pagina: es la corrida que en
        // produccion termina con 9 ejecuciones exitosas.
        (deps.navegador.leerCamposDeLaPagina as ReturnType<typeof vi.fn>).mockResolvedValue([
          { contexto: 'input email para', valor: 'juan@ejemplo.com' },
        ]);
        const desenlace = await procesarTareaWeb(deps, job);
        return { modo, desenlace, ejecutadas: motor.ejecutadas, guardia: pasosDeGuardia(trayectorias) };
      }),
    );
    for (const corrida of corridas) {
      expect(corrida.desenlace).toBe('completada');
      expect(corrida.ejecutadas).toEqual(TRAZA_REAL_DE_ENVIAR);
      // La guardia generica no toca este camino: hay verbo, y ese verbo exige destinatario.
      expect(corrida.guardia).toEqual([]);
    }
  });

  it('enviar SIEMPRE tiene al menos una comparacion, asi que D2 no puede dispararse sobre el', () => {
    const parametros = extraerParametrosDeclarados(OBJETIVO_DE_ENVIAR);
    const veredicto = verificarAccion({
      politica: {
        ejecutarAccionesIrreversibles: true,
        topeMontoSinConfirmacion: 5000,
        sitiosExcluidos: [],
      },
      dominio: DOMINIO,
      verbo: 'enviar',
      parametros,
      pagina: { campos: [{ contexto: 'input email para', valor: 'juan@ejemplo.com' }], texto: '' },
      exigeComparacion: true,
    });
    expect(veredicto.tipo).toBe('ejecutar');
    expect(veredicto.comparaciones.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// D3/D4: LA TELEMETRIA DE OBSERVACION
// -------------------------------------------------------------------------------------------------

describe('telemetria del modo observacion', () => {
  it('cuenta las acciones evaluadas y las que HABRIAN sido detenidas', async () => {
    const { deps, guardarResultado, job } = escenario({
      objetivo: 'archiva las tres conversaciones viejas',
      acciones: [
        'lee la lista de conversaciones',
        'haz clic en el boton Archivar',
        'haz clic en el boton Archivar de la segunda',
      ],
      modo: 'observacion',
    });
    await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
    expect(resultadoGuardado(guardarResultado).guardiaSinIntencion).toEqual({
      modo: 'observacion',
      // La lectura esta exenta y no se cuenta; las dos acciones si.
      evaluadas: 2,
      habriaDetenido: 2,
    });
  });

  it('una corrida que la guardia no toca deja el resultado exactamente como antes', async () => {
    const { deps, guardarResultado, job } = escenario({
      objetivo: 'revisa la bandeja y dime que llego',
      acciones: ['lee el resumen de la bandeja'],
      modo: 'observacion',
    });
    await expect(procesarTareaWeb(deps, job)).resolves.toBe('completada');
    expect(resultadoGuardado(guardarResultado)).not.toHaveProperty('guardiaSinIntencion');
  });
});

// -------------------------------------------------------------------------------------------------
// LA PIEZA PURA: verificarAccion con exigeComparacion
// -------------------------------------------------------------------------------------------------

describe('verificarAccion: la exigencia de comparacion (D2)', () => {
  const POLITICA = {
    ejecutarAccionesIrreversibles: true,
    topeMontoSinConfirmacion: 5000,
    sitiosExcluidos: [],
  };
  const PAGINA = { campos: [], texto: 'una pagina cualquiera' };

  it('sin la exigencia, cero comparaciones sigue siendo ejecutar (comportamiento anterior)', () => {
    const veredicto = verificarAccion({
      politica: POLITICA,
      dominio: DOMINIO,
      verbo: 'borrar',
      parametros: extraerParametrosDeclarados('borra el borrador'),
      pagina: PAGINA,
    });
    expect(veredicto.tipo).toBe('ejecutar');
  });

  it('con la exigencia, cero comparaciones detiene con el motivo nuevo', () => {
    const veredicto = verificarAccion({
      politica: POLITICA,
      dominio: DOMINIO,
      verbo: 'borrar',
      parametros: extraerParametrosDeclarados('borra el borrador'),
      pagina: PAGINA,
      exigeComparacion: true,
    });
    expect(veredicto.tipo).toBe('detener');
    if (veredicto.tipo !== 'detener') return;
    expect(veredicto.detencion.motivo).toBe('sinEvidenciaParaComparar');
  });

  it('la invariante del paso 7 queda intacta: con datos declarados el veredicto no cambia', () => {
    const parametros = extraerParametrosDeclarados('borra el correo de juan@ejemplo.com');
    const entrada = {
      politica: POLITICA,
      dominio: DOMINIO,
      verbo: 'borrar',
      parametros,
      pagina: { campos: [] as CampoDeLaPagina[], texto: '' },
    };
    // El dato declarado todavia no esta en pantalla: sigue siendo 'incompleto' con y sin la exigencia.
    expect(verificarAccion(entrada).tipo).toBe('incompleto');
    expect(verificarAccion({ ...entrada, exigeComparacion: true }).tipo).toBe('incompleto');
  });

  it('la exigencia no adelanta ninguna detencion previa: la politica sigue mandando primero', () => {
    const veredicto = verificarAccion({
      politica: { ...POLITICA, ejecutarAccionesIrreversibles: false },
      dominio: DOMINIO,
      verbo: null,
      parametros: extraerParametrosDeclarados('desactiva la cuenta'),
      pagina: PAGINA,
      exigeComparacion: true,
    });
    expect(veredicto.tipo).toBe('detener');
    if (veredicto.tipo !== 'detener') return;
    expect(veredicto.detencion.motivo).toBe('accionesDesactivadas');
  });
});
