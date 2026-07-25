import { describe, it, expect, vi } from 'vitest';
import { Stagehand, ExperimentalNotConfiguredError } from '@browserbasehq/stagehand';
import { validateExperimentalFeatures } from '@browserbasehq/stagehand/lib/v3/agent/utils/validateExperimentalFeatures.js';
import {
  accionCrudaDeEvidencia,
  construirOpcionesDeEjecucion,
  construirOpcionesStagehand,
  crearActBlindado,
  elementIdDeFalloDeEsquema,
  esFalloDeEsquemaDelMotor,
  ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS,
  MAX_FALLOS_ESQUEMA_CONSECUTIVOS,
  MAX_REINTENTOS_ESQUEMA,
  TOOLS_RETIRADAS_CON_GUARDIA,
} from '../src/stagehand.js';
import { AccionBloqueadaError, FalloDeEsquemaDelMotorError } from '../src/errores.js';
import type { AccionCrudaDeMotor } from '../src/trayectoria.js';
import type { GuardiaDeAccion } from '../src/tarea-web.js';
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
 * Rechazo de esquema con el elementId que lo provoco, como el de produccion (25 jul 2026): el AI SDK
 * envuelve el TypeValidationError (con el objeto parseado en `value`) dentro del
 * NoObjectGeneratedError (con el JSON crudo en `text`), y el ZodError va al fondo de la cadena.
 */
function errorDeEsquemaCon(elementId: string): Error {
  const salida = { action: { elementId, description: 'boton', method: 'click', arguments: [] } };
  const zod = new Error('invalid_format');
  zod.name = 'ZodError';
  Object.assign(zod, {
    issues: [
      { code: 'invalid_format', format: 'regex', path: ['action', 'elementId'], input: elementId },
    ],
  });
  const validacion = new Error('Type validation failed');
  validacion.name = 'AI_TypeValidationError';
  Object.assign(validacion, { value: salida, cause: zod });
  const generacion = new Error('No object generated: response did not match schema.');
  generacion.name = 'AI_NoObjectGeneratedError';
  Object.assign(generacion, { text: JSON.stringify(salida), cause: validacion });
  return generacion;
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

/**
 * CAMBIO 3: el reintento por esquema deja de ser inutil. El fallo de produccion NO era intermitente:
 * el mismo arbol producia el mismo elementId malformado ("5662") y el mismo rechazo, cinco veces en
 * dos minutos. Un reintento sobre el MISMO identificador solo quema pasos y minutos de navegador.
 */
describe('elementIdDeFalloDeEsquema', () => {
  it('lee el elementId de la cadena de errores del AI SDK', () => {
    expect(elementIdDeFalloDeEsquema(errorDeEsquemaCon('5662'))).toBe('5662');
  });

  it('lo lee tambien cuando la envoltura solo dejo el mensaje serializado', () => {
    const error = new Error('response did not match schema: {"action":{"elementId":"5662"}}');
    error.name = 'AI_NoObjectGeneratedError';
    expect(elementIdDeFalloDeEsquema(error)).toBe('5662');
  });

  it('null cuando el error no trae ningun identificador (no se puede afirmar que se repita)', () => {
    expect(elementIdDeFalloDeEsquema(errorDeEsquema())).toBeNull();
    expect(elementIdDeFalloDeEsquema(null)).toBeNull();
  });
});

describe('crearActBlindado ante un fallo de esquema DETERMINISTA', () => {
  it('dos fallos con el MISMO elementId cortan en el acto, sin reintentar mas', async () => {
    const actuar = vi.fn(async () => {
      throw errorDeEsquemaCon('5662');
    });
    const esperas: number[] = [];
    const logger = makeLogger();
    const blindado = crearActBlindado({
      actuar,
      logger,
      esperar: async (ms) => void esperas.push(ms),
    });

    await expect(blindado.ejecutar('click en Enviar')).rejects.toThrow(FalloDeEsquemaDelMotorError);

    // Dos intentos y nada mas: el primero fija el identificador, el segundo lo repite y corta.
    expect(actuar).toHaveBeenCalledTimes(2);
    expect(esperas).toEqual([ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS]);
    expect(blindado.corto()).toBe(true);
    // El identificador entra al diagnostico: es un numero del arbol, no contenido de la pagina.
    expect(blindado.corte()?.message).toContain('5662');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('MISMO identificador'), {
      elementId: '5662',
    });
  });

  it('solo se reintenta mientras el elementId CAMBIA entre intentos', async () => {
    const ids = ['5662', '7001', '9100'];
    const actuar = vi.fn(async () => {
      throw errorDeEsquemaCon(ids[actuar.mock.calls.length - 1] ?? 'ultimo');
    });
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), esperar: async () => {} });

    const salida = await blindado.ejecutar('click en Enviar');

    // Identificadores distintos cada vez: se agota el presupuesto de reintentos como antes.
    expect(actuar).toHaveBeenCalledTimes(1 + MAX_REINTENTOS_ESQUEMA);
    expect(salida.success).toBe(false);
    expect(blindado.corto()).toBe(false);
  });

  it('el mismo elementId en DOS llamadas de tool distintas tambien corta', async () => {
    const actuar = vi.fn(async () => {
      throw errorDeEsquemaCon('5662');
    });
    // El primer intento de la primera llamada fija el id; el segundo ya lo repite.
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), esperar: async () => {} });
    await expect(blindado.ejecutar('click en Enviar')).rejects.toThrow(FalloDeEsquemaDelMotorError);
    expect(actuar).toHaveBeenCalledTimes(2);
  });

  it('un act exitoso olvida el ultimo identificador rechazado', async () => {
    let falla = true;
    const actuar = vi.fn(async () => {
      if (falla) throw errorDeEsquemaCon('5662');
      return { success: true, actions: [{ selector: 'xpath=//button' }] };
    });
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), esperar: async () => {} });

    falla = false;
    await blindado.ejecutar('click en Redactar');
    falla = true;
    // Con el identificador olvidado, este primer fallo NO cuenta como repeticion: se reintenta.
    await expect(blindado.ejecutar('click en Enviar')).rejects.toThrow(FalloDeEsquemaDelMotorError);
    expect(actuar).toHaveBeenCalledTimes(3);
  });
});

/**
 * CAMBIO 4: la trayectoria de una corrida CANCELADA. La accion entra a la traza ANTES de tocar el
 * navegador y el registro se completa al terminar. Registrarla despues perdia toda accion que
 * estuviera en vuelo (o entre reintentos) cuando llegaba la cancelacion, que es por lo que una tarea
 * cancelada quedaba con cero pasos pese al arreglo anterior.
 */
describe('crearActBlindado y la traza de una corrida cancelada', () => {
  it('una accion EN VUELO ya esta registrada antes de que el navegador responda', async () => {
    const acciones: AccionCrudaDeMotor[] = [];
    const blindado = crearActBlindado({
      // Nunca resuelve: imita la llamada que sigue en vuelo cuando el job deja de estar running.
      actuar: () => new Promise(() => {}),
      logger: makeLogger(),
      registrarAccion: (accion) => void acciones.push(accion),
    });

    void blindado.ejecutar('click en Enviar');
    await Promise.resolve();

    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ type: 'act', action: 'click en Enviar', success: false });
  });

  it('una accion cancelada ENTRE reintentos de esquema tampoco se pierde', async () => {
    const acciones: AccionCrudaDeMotor[] = [];
    let liberar: () => void = () => {};
    const enEspera = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const blindado = crearActBlindado({
      actuar: async () => {
        throw errorDeEsquema();
      },
      logger: makeLogger(),
      // La corrida se cancela mientras el blindaje espera para reintentar.
      esperar: async () => enEspera,
      registrarAccion: (accion) => void acciones.push(accion),
    });

    void blindado.ejecutar('click en Enviar');
    await Promise.resolve();
    await Promise.resolve();

    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ type: 'act', action: 'click en Enviar', success: false });
    liberar();
  });

  it('un fallo que no es de esquema deja UN solo registro, no dos', async () => {
    const acciones: AccionCrudaDeMotor[] = [];
    const blindado = crearActBlindado({
      actuar: async () => {
        throw new Error('el elemento ya no existe');
      },
      logger: makeLogger(),
      registrarAccion: (accion) => void acciones.push(accion),
    });

    await expect(blindado.ejecutar('click en Enviar')).resolves.toMatchObject({ success: false });
    expect(acciones).toHaveLength(1);
  });
});

/**
 * PUNTO DE INTERCEPCION: la tool `act` del agente pasa por la guardia del worker ANTES de tocar el
 * navegador. Estos tests fijan que el bloqueo NO es una sugerencia (`actuar` no se llama) y que corta
 * la corrida en el acto (lanza), que es lo que impide que el agente busque otra ruta.
 */
describe('crearActBlindado con GUARDIA', () => {
  function guardiaQueBloquea(mensaje: string): GuardiaDeAccion & { revisadas: string[] } {
    const revisadas: string[] = [];
    return {
      revisadas,
      revisar: async (accion: string) => {
        revisadas.push(accion);
        return { tipo: 'bloquear', mensaje };
      },
    };
  }

  it('la guardia se consulta ANTES de actuar y un bloqueo impide que la accion llegue al navegador', async () => {
    const actuar = vi.fn(async () => ({ success: true }));
    const guardia = guardiaQueBloquea('DETENIDA_VERIFICACION: {"motivo":"noCoincide"}');
    const acciones: AccionCrudaDeMotor[] = [];
    const blindado = crearActBlindado({
      actuar,
      logger: makeLogger(),
      guardia,
      registrarAccion: (accion) => acciones.push(accion),
    });

    await expect(blindado.ejecutar('click en Enviar')).rejects.toThrow(AccionBloqueadaError);

    expect(guardia.revisadas).toEqual(['click en Enviar']);
    // Lo que importa: el navegador nunca se toco y la traza no registra una accion que no ocurrio.
    expect(actuar).not.toHaveBeenCalled();
    expect(acciones).toEqual([]);
    // El mensaje de la detencion viaja intacto para que la consola pueda traducirlo.
    expect(blindado.bloqueo()).toBe('DETENIDA_VERIFICACION: {"motivo":"noCoincide"}');
  });

  it('una guardia que permite deja pasar la accion y no registra bloqueo', async () => {
    const actuar = vi.fn(async () => ({ success: true }));
    const revisadas: string[] = [];
    const guardia: GuardiaDeAccion = {
      revisar: async (accion) => {
        revisadas.push(accion);
        return { tipo: 'permitir' };
      },
    };
    const blindado = crearActBlindado({ actuar, logger: makeLogger(), guardia });

    const salida = await blindado.ejecutar('escribe el destinatario');

    expect(salida.success).toBe(true);
    expect(actuar).toHaveBeenCalledTimes(1);
    expect(revisadas).toEqual(['escribe el destinatario']);
    expect(blindado.bloqueo()).toBeNull();
  });

  it('sin guardia cableada, el comportamiento es exactamente el de antes', async () => {
    const actuar = vi.fn(async () => ({ success: true }));
    const blindado = crearActBlindado({ actuar, logger: makeLogger() });
    await blindado.ejecutar('click en Enviar');
    expect(actuar).toHaveBeenCalledTimes(1);
    expect(blindado.bloqueo()).toBeNull();
  });

  it('la guardia se consulta UNA vez por llamada de tool, no por reintento de esquema', async () => {
    let falla = true;
    const actuar = vi.fn(async () => {
      if (falla) {
        falla = false;
        throw errorDeEsquema();
      }
      return { success: true };
    });
    const revisadas: string[] = [];
    const guardia: GuardiaDeAccion = {
      revisar: async (accion) => {
        revisadas.push(accion);
        return { tipo: 'permitir' };
      },
    };
    const blindado = crearActBlindado({
      actuar,
      logger: makeLogger(),
      guardia,
      esperar: async () => {},
    });

    await blindado.ejecutar('click en Enviar');

    // Dos intentos de la MISMA accion (el primero rechazado por esquema) y una sola comparacion: el
    // reintento repite una accion que nunca llego a ejecutarse.
    expect(actuar).toHaveBeenCalledTimes(2);
    expect(revisadas).toEqual(['click en Enviar']);
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
  it('sin observador NI registro no se pasa onEvidence (TAREA_WEB_OBSERVADOR_PASOS apagado)', () => {
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'abre el ultimo correo',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
    });
    expect(opciones.callbacks).toBeUndefined();
    expect(opciones.toolTimeout).toBe(90_000);
    expect(opciones.maxSteps).toBe(120);
  });

  /**
   * CAMBIO 4. La traza del motor solo llega cuando `execute()` DEVUELVE; una corrida cancelada
   * (o cortada por deadline o por esquema) lanza y no devuelve nada. Sin este registro en vivo, las
   * tools que no son `act` desaparecian de la trayectoria y una tarea cancelada antes de su primer
   * `act` quedaba con cero pasos.
   */
  it('registra EN VIVO las tools que no son act, sin necesidad del observador', async () => {
    const acciones: AccionCrudaDeMotor[] = [];
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'abre el ultimo correo',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
      registrarAccion: (accion) => void acciones.push(accion),
    });
    expect(opciones.callbacks?.onEvidence).toBeDefined();

    await opciones.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: 'goto',
      actionArgs: { url: 'https://app.ejemplo.com/', describe: 'ir a la bandeja' },
      reasoning: 'hay que abrir la bandeja',
      toolOutput: { ok: true, result: {} },
    });

    expect(acciones).toEqual([{ type: 'goto', success: true, describe: 'ir a la bandeja' }]);
  });

  it('NO registra `act` por evidencia: el blindaje ya la registro antes de tocar el navegador', async () => {
    const acciones: AccionCrudaDeMotor[] = [];
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'abre el ultimo correo',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
      registrarAccion: (accion) => void acciones.push(accion),
    });

    await opciones.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: 'act',
      actionArgs: { action: 'click en Enviar' },
      reasoning: '',
      toolOutput: { ok: true, result: {} },
    });

    expect(acciones).toEqual([]);
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

  it('SIN guardia el toolset queda intacto: no se retira ninguna tool', () => {
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'abre el ultimo correo',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
    });
    expect(opciones.excludeTools).toBeUndefined();
  });

  it('CON guardia se retiran las tools que llegarian al navegador sin pasar por ella', () => {
    const opciones = construirOpcionesDeEjecucion({
      objetivo: 'envia el resumen a juan@ejemplo.com',
      maxPasos: 120,
      toolTimeoutMs: 90_000,
      conGuardia: true,
    });
    // `keys` manda un Control+Enter a donde este el foco y `fillForm` actua sobre cualquier elemento
    // que le describan: las dos alcanzan la accion irreversible sin pasar por la comparacion.
    expect(opciones.excludeTools).toEqual(['keys', 'fillForm']);
    expect(TOOLS_RETIRADAS_CON_GUARDIA).toEqual(['keys', 'fillForm']);
    // La tool que SI lleva guardia sigue disponible: es la unica via de interaccion que queda.
    expect(opciones.excludeTools).not.toContain('act');
  });

  it('la validacion real de Stagehand acepta excludeTools con experimental: true', () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: true,
        executeOptions: { excludeTools: [...TOOLS_RETIRADAS_CON_GUARDIA] },
      }),
    ).not.toThrow();
  });
});

describe('accionCrudaDeEvidencia', () => {
  it('copia por WHITELIST solo los campos de texto: nada de contenido de la pagina', () => {
    const accion = accionCrudaDeEvidencia({
      actionName: 'extract',
      actionArgs: {
        instruction: 'lee el asunto',
        schema: { type: 'object', properties: { asunto: { type: 'string' } } },
        selector: 'xpath=//div[@id="cuerpo"]',
      },
      toolOutput: { ok: true },
    });

    expect(accion).toEqual({ type: 'extract', success: true, instruction: 'lee el asunto' });
  });

  it('un paso por coordenadas conserva lo que la traza del motor tambien lleva', () => {
    const accion = accionCrudaDeEvidencia({
      actionName: 'type',
      actionArgs: { describe: 'el campo Para', text: 'juan@ejemplo.com', coordinates: [10, 20] },
      toolOutput: { ok: false },
    });

    expect(accion).toEqual({
      type: 'type',
      success: false,
      describe: 'el campo Para',
      text: 'juan@ejemplo.com',
    });
  });
});
