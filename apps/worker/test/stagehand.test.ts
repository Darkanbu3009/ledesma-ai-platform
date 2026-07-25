import { describe, it, expect, vi } from 'vitest';
import { Stagehand, ExperimentalNotConfiguredError } from '@browserbasehq/stagehand';
import { validateExperimentalFeatures } from '@browserbasehq/stagehand/lib/v3/agent/utils/validateExperimentalFeatures.js';
import {
  construirOpcionesDeEjecucion,
  construirOpcionesStagehand,
  crearActBlindado,
  esFalloDeEsquemaDelMotor,
  ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS,
  MAX_FALLOS_ESQUEMA_CONSECUTIVOS,
  MAX_REINTENTOS_ESQUEMA,
} from '../src/stagehand.js';
import { FalloDeEsquemaDelMotorError } from '../src/errores.js';
import type { AccionCrudaDeMotor } from '../src/trayectoria.js';
import type { Logger } from '../src/logger.js';

/**
 * La configuracion del motor pasa un abort signal a agent.execute() (el deadline de pared de
 * runTimeoutMs). Stagehand 3.6.0 exige experimental: true para aceptar ese signal, y el modo de
 * operacion del worker exige disableAPI: true (inferencia local con la key del owner). Estos tests
 * validan la configuracion REAL del worker contra la validacion REAL de Stagehand
 * (validateExperimentalFeatures, el mismo chequeo que corre agent.execute), sin abrir un navegador.
 */
describe('construirOpcionesStagehand', () => {
  const opciones = construirOpcionesStagehand({
    apiKey: 'bb-test',
    projectId: 'proj-test',
    sesionExternaId: 'ses-1',
    model: 'anthropic/claude-sonnet-4-6',
    modelApiKey: 'sk-test',
  });

  it('lleva los dos flags que exige el abort signal: experimental y disableAPI', () => {
    expect(opciones.experimental).toBe(true);
    expect(opciones.disableAPI).toBe(true);
  });

  it('con un abort signal, la validacion real de Stagehand NO lanza ExperimentalNotConfiguredError', () => {
    const signal = new AbortController().signal;
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: opciones.experimental ?? false,
        executeOptions: { signal },
      }),
    ).not.toThrow();
  });

  it('control negativo: sin experimental, la misma validacion SI lanza (el test vigila lo correcto)', () => {
    const signal = new AbortController().signal;
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: false,
        executeOptions: { signal },
      }),
    ).toThrow(ExperimentalNotConfiguredError);
  });

  it('el constructor de Stagehand acepta las opciones sin lanzar', () => {
    expect(() => new Stagehand(opciones)).not.toThrow();
  });
});

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Rechazo de esquema tal como lo emite el AI SDK cuando la respuesta no valida contra el esquema. */
function errorDeEsquema(): Error {
  const error = new Error('No object generated: response did not match schema.');
  error.name = 'AI_NoObjectGeneratedError';
  return error;
}

/**
 * BLINDAJE de la tool `act` (CAMBIO 2 y 3). El fallo real es del MOTOR: con `encodedId` undefined,
 * Stagehand rotula el arbol de accesibilidad con `[8246]` en vez de `[0-8246]`, el modelo lo copia y
 * el esquema de act (que exige `numero-numero`) lo rechaza. Estos tests fijan que el worker lo
 * reintenta y que, si se repite, corta en vez de girar minutos.
 */
describe('crearActBlindado', () => {
  it('un fallo de esquema se reintenta 2 veces antes de contar como fallo de la tool', async () => {
    const actuar = vi.fn(async () => {
      throw errorDeEsquema();
    });
    const esperas: number[] = [];
    const logger = makeLogger();
    const blindado = crearActBlindado({
      actuar,
      logger,
      esperar: async (ms) => void esperas.push(ms),
    });

    const salida = await blindado.ejecutar('click en Enviar');

    // Un intento original + MAX_REINTENTOS_ESQUEMA reintentos, con 1 segundo entre ellos.
    expect(actuar).toHaveBeenCalledTimes(1 + MAX_REINTENTOS_ESQUEMA);
    expect(esperas).toEqual([ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS, ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS]);
    // Cada reintento se loguea como fallo del MOTOR, no del objetivo del usuario.
    expect(logger.warn).toHaveBeenCalledTimes(MAX_REINTENTOS_ESQUEMA);
    // Agotados los reintentos, el fallo se le devuelve al modelo (no corta la corrida todavia).
    expect(salida.success).toBe(false);
    expect(blindado.corto()).toBe(false);
  });

  it('tres fallos de esquema consecutivos cortan la corrida con el error especifico', async () => {
    const actuar = vi.fn(async () => {
      throw errorDeEsquema();
    });
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), esperar: async () => {} });

    await blindado.ejecutar('click en Enviar');
    await blindado.ejecutar('click en Enviar');
    await expect(blindado.ejecutar('click en Enviar')).rejects.toThrow(FalloDeEsquemaDelMotorError);

    expect(blindado.corto()).toBe(true);
    // Ni un intento mas alla del corte: 3 llamadas de tool x (1 + reintentos).
    expect(actuar).toHaveBeenCalledTimes(MAX_FALLOS_ESQUEMA_CONSECUTIVOS * (1 + MAX_REINTENTOS_ESQUEMA));
  });

  it('un act exitoso reinicia el contador de fallos consecutivos', async () => {
    let falla = true;
    const actuar = vi.fn(async () => {
      if (falla) throw errorDeEsquema();
      return { success: true, actions: [{ selector: 'xpath=//button', method: 'click' }] };
    });
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), esperar: async () => {} });

    await blindado.ejecutar('click en Enviar');
    await blindado.ejecutar('click en Enviar');
    falla = false;
    await blindado.ejecutar('click en Enviar');
    falla = true;
    // Con el contador reiniciado, estos dos fallos NO alcanzan el corte.
    await blindado.ejecutar('click en Enviar');
    await expect(blindado.ejecutar('click en Enviar')).resolves.toMatchObject({ success: false });
    expect(blindado.corto()).toBe(false);
  });

  it('un fallo que NO es de esquema no se reintenta ni cuenta para el corte', async () => {
    const actuar = vi.fn(async () => {
      throw new Error('el elemento ya no existe');
    });
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), esperar: async () => {} });

    for (let i = 0; i < MAX_FALLOS_ESQUEMA_CONSECUTIVOS + 1; i++) {
      await expect(blindado.ejecutar('click en Enviar')).resolves.toMatchObject({ success: false });
    }
    expect(actuar).toHaveBeenCalledTimes(MAX_FALLOS_ESQUEMA_CONSECUTIVOS + 1);
    expect(blindado.corto()).toBe(false);
  });

  it('registra cada intento (fallido con exito false) para que la trayectoria lo conserve', async () => {
    const acciones: AccionCrudaDeMotor[] = [];
    let falla = true;
    const blindado = crearActBlindado({
      actuar: async () => {
        if (falla) throw errorDeEsquema();
        return { success: true, actions: [{ selector: 'xpath=//button', method: 'click' }] };
      },
      logger: makeLogger(),
      esperar: async () => {},
      registrarAccion: (accion) => void acciones.push(accion),
    });

    await blindado.ejecutar('click en Enviar');
    falla = false;
    await blindado.ejecutar('click en Enviar');

    // Un registro por LLAMADA de tool (no por reintento): el fallido y el exitoso.
    expect(acciones).toHaveLength(2);
    expect(acciones[0]).toMatchObject({ type: 'act', action: 'click en Enviar', success: false });
    expect(acciones[1]).toMatchObject({ type: 'act', success: true });
    expect(acciones[1]?.playwrightArguments).toMatchObject({ selector: 'xpath=//button' });
  });
});

describe('esFalloDeEsquemaDelMotor', () => {
  it('reconoce el rechazo de esquema por nombre, por mensaje y por la cadena de cause', () => {
    expect(esFalloDeEsquemaDelMotor(errorDeEsquema())).toBe(true);
    const porTipo = new Error('value did not match schema');
    porTipo.name = 'AI_TypeValidationError';
    expect(esFalloDeEsquemaDelMotor(porTipo)).toBe(true);
    expect(esFalloDeEsquemaDelMotor(new Error('fallo', { cause: errorDeEsquema() }))).toBe(true);
  });

  it('no confunde otros fallos del motor con un rechazo de esquema', () => {
    expect(esFalloDeEsquemaDelMotor(new Error('TimeoutError: act() timed out'))).toBe(false);
    expect(esFalloDeEsquemaDelMotor(null)).toBe(false);
  });
});

describe('construirOpcionesDeEjecucion', () => {
  it('SIN observador no se pasa onEvidence (TAREA_WEB_OBSERVADOR_PASOS apagado: cero CDP extra)', () => {
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'abre el ultimo correo',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
    });
    expect(opciones.callbacks).toBeUndefined();
    expect(opciones.toolTimeout).toBe(90_000);
    expect(opciones.maxSteps).toBe(120);
  });

  it('CON observador se pasa onEvidence y cada step_finished llega al observador', async () => {
    const pasos: Array<{ selector: string | null }> = [];
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'abre el ultimo correo',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
      observador: async (paso) => void pasos.push(paso),
    });
    expect(opciones.callbacks?.onEvidence).toBeDefined();

    await opciones.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: 'act',
      actionArgs: {},
      reasoning: '',
      toolOutput: {
        ok: true,
        result: { playwrightArguments: { selector: 'xpath=//button' } },
      },
    });
    expect(pasos).toEqual([{ selector: 'xpath=//button', punto: null }]);
  });
});
