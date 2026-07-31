import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { MODELO_SIN_ACCESO_PREFIX } from '@ledesma-platform/shared/verificacion';
import { procesarTareaWeb } from '../src/tarea-web.js';
import type {
  MotorDeTareaWeb,
  NavegadorParaTarea,
  RepositorioSitiosParaTarea,
  TareaWebDeps,
} from '../src/tarea-web.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import { FalloDeAccesoAlModeloError, marcaDeFalloDeModelo } from '../src/fallo-modelo.js';
import type { Logger } from '../src/logger.js';

/**
 * CORTE DE LA TAREA WEB POR FALTA DE ACCESO AL MODELO (saldo agotado o credencial invalida).
 *
 * Fija los dos comportamientos que la evidencia del 31 jul 2026 pedia:
 *  - la sesion de navegador se CIERRA en el camino del corte (no se pagan minutos de proveedor por
 *    una corrida que no puede continuar);
 *  - el cierre lleva el prefijo estable MODELO_SIN_ACCESO, que es lo que la consola traduce al
 *    mensaje que nombra la causa en vez del generico "La tarea no se pudo completar".
 *
 * El motor fake devuelve el resultado SIN EXITO con la marca en el mensaje, que es exactamente lo que
 * produce el motor real: `agent.execute` de Stagehand atrapa el error del proveedor y lo entrega como
 * texto, y la marca la planta el middleware de modelo antes de que eso ocurra.
 */

const VAULT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(): Job {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo: 'dime cuantos correos tengo' },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-31T07:11:00.000Z',
    updatedAt: '2026-07-31T07:11:00.000Z',
    startedAt: '2026-07-31T07:11:00.000Z',
    finishedAt: null,
  };
}

function makeSitio(): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: 'app.ejemplo.com',
    urlLogin: 'https://app.ejemplo.com/login',
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    proxyCountry: 'AR',
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
  } as SitioConectado;
}

function makeRepo(): RepositorioSitiosParaTarea {
  return {
    obtenerPorId: vi.fn(async () => makeSitio()),
    obtenerContextoDescifrado: vi.fn(async () => CONTEXTO_PLANO),
    guardarContexto: vi.fn(async () => makeSitio()),
    actualizarEstado: vi.fn(async () => makeSitio()),
  };
}

function makeNavegador(): NavegadorParaTarea {
  return {
    abrirSesionParaTarea: vi.fn(async () => ({
      sesionExternaId: 'ses-1',
      egressIp: '203.0.113.7',
      egressCountry: 'AR',
    })),
    inyectarContexto: vi.fn(async () => {}),
    detectarPantallaDeLogin: vi.fn(async () => false),
    extraerContexto: vi.fn(async () => CONTEXTO_PLANO),
    estadoDeSesion: vi.fn(async () => 'viva' as const),
    capturarPantalla: vi.fn(async () => 'cGxhY2Vob2xkZXI='),
    leerCamposDeLaPagina: vi.fn(async () => []),
    leerTextoVisible: vi.fn(async () => ''),
    observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'AR' })),
    cerrarSesion: vi.fn(async () => {}),
  };
}

/** Motor que muere como el real cuando la llave se queda sin saldo: resultado sin exito con la marca. */
function makeMotorSinSaldo(): MotorDeTareaWeb {
  return {
    ejecutar: vi.fn(async () => ({
      exito: false,
      completado: false,
      mensaje:
        `Failed to execute task: ${marcaDeFalloDeModelo('saldo')} Error: Your credit balance is ` +
        'too low to access the Anthropic API.',
      acciones: [],
      tokensIn: null,
      tokensOut: null,
    })),
  };
}

function makeDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: makeRepo(),
    navegador: makeNavegador(),
    motor: makeMotorSinSaldo(),
    vaultSecret: VAULT_SECRET,
    model: 'anthropic/claude-sonnet-4-6',
    maxPasos: 120,
    historialPasos: 8,
    modoScreenshots: 'cambios',
    runTimeoutMs: 600_000,
    resolveCredential: vi.fn(async () => ({
      id: 'cred-1',
      providerId: 'anthropic' as const,
      apiKey: 'sk-ant-secreta',
      baseUrl: null,
    })),
    guardarResultado: vi.fn(async () => {}),
    aprobaciones: makeAprobacionesRepo(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    esperar: async () => {},
    logger: makeLogger(),
    ...overrides,
  } as unknown as TareaWebDeps;
}

/** El error con el que fallo la tarea. Lanza si NO fallo (asi un test nunca pasa por accidente). */
async function errorDe(promesa: Promise<unknown>): Promise<Error> {
  try {
    await promesa;
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba que la tarea fallara y termino bien');
}

describe('procesarTareaWeb: la llave del modelo se quedo sin saldo', () => {
  it('corta con el fallo permanente propio, no con el mensaje generico del motor', async () => {
    const deps = makeDeps();
    await expect(procesarTareaWeb(deps, makeJob())).rejects.toBeInstanceOf(
      FalloDeAccesoAlModeloError,
    );
  });

  it('el last_error empieza con el prefijo estable y nombra la causa', async () => {
    const deps = makeDeps();
    const error = await errorDe(procesarTareaWeb(deps, makeJob()));
    // El last_error del job lo arma execution.ts como `${name}: ${message}`.
    expect(`${error.name}: ${error.message}`.startsWith(MODELO_SIN_ACCESO_PREFIX)).toBe(true);
    expect(error.message).toContain('no tiene saldo');
    // Y NO el diagnostico generico del motor, que mandaba a revisar el objetivo.
    expect(error.message).not.toContain('limite de pasos');
  });

  it('cierra la sesion de navegador en el camino del corte', async () => {
    const deps = makeDeps();
    await procesarTareaWeb(deps, makeJob()).catch(() => undefined);
    expect(deps.navegador.abrirSesionParaTarea).toHaveBeenCalledTimes(1);
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledTimes(1);
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
  });

  it('un fallo del motor que NO es de acceso al modelo conserva el diagnostico de siempre', async () => {
    const deps = makeDeps({
      motor: {
        ejecutar: vi.fn(async () => ({
          exito: false,
          completado: false,
          mensaje: 'no encontre la bandeja de entrada',
          acciones: [],
          tokensIn: null,
          tokensOut: null,
        })),
      },
    });
    const error = await errorDe(procesarTareaWeb(deps, makeJob()));
    expect(error).not.toBeInstanceOf(FalloDeAccesoAlModeloError);
    expect(error.message).toContain('se detuvo sin exito');
  });
});
