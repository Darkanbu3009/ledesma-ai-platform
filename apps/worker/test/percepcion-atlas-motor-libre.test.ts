import { describe, it, expect } from 'vitest';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import {
  crearControlDePercepcion,
  MAX_LINEAS_POR_TURNO,
  objetivoDeLectura,
  PREFIJO_PERCEPCION,
  type EventoDePasoPercibido,
  type ObjetivoDeLectura,
  type PercepcionDePagina,
} from '../src/percepcion.js';
import { construirOpcionesDeEjecucion } from '../src/stagehand.js';
import type { MensajeDeModelo } from '../src/costo-modelo.js';

/**
 * EL MOTOR LIBRE ALIMENTANDO EL ATLAS DESDE LA PERCEPCION. Todo con fakes: cero navegador, cero
 * modelo.
 *
 * Las garantias de NO REGRESION que fijan estos tests son la condicion para que esto pueda tocar
 * produccion, y por eso viven en su propio archivo:
 *  - el texto de percepcion que llega al modelo es IDENTICO con y sin la lectura fusionada;
 *  - el numero de lecturas de la pagina (una conexion CDP cada una) NO aumenta;
 *  - el dato del atlas no se encola como linea y no consume ni una ranura del presupuesto por turno;
 *  - un fallo de la lectura degrada a la percepcion de hoy y no cambia el desenlace de nada;
 *  - lo que se emite queda alineado UNA ENTRADA POR ACCION con la traza del motor.
 */

/**
 * Lo que la lectura fusionada devuelve del DOM. El valor es deliberadamente ajeno a todo texto de la
 * corrida: si apareciera en un mensaje al modelo, seria porque el dato del atlas se colo por la cola
 * de percepcion, que es justo lo que estos tests prohiben.
 */
const LEIDA_DEL_DOM: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'marca-que-solo-vive-en-el-atlas',
};

/** La secuencia de pasos del envio de correo: click, escritura, captura, tecleo suelto y envio. */
const PASOS: EventoDePasoPercibido[] = [
  {
    actionName: 'act',
    actionArgs: { action: 'click en Redactar' },
    toolOutput: {
      result: {
        playwrightArguments: { selector: 'xpath=/html[1]/body[1]/div[1]', method: 'click', arguments: [] },
      },
    },
  },
  {
    actionName: 'act',
    actionArgs: { action: 'escribir el destinatario en el campo Para' },
    toolOutput: {
      result: {
        playwrightArguments: {
          selector: 'xpath=/html[1]/body[1]/input[1]',
          method: 'fill',
          arguments: ['martin@ejemplo.com'],
        },
      },
    },
  },
  { actionName: 'screenshot', actionArgs: {}, toolOutput: { result: {} } },
  {
    actionName: 'type',
    actionArgs: { describe: 'the To field', text: 'martin@ejemplo.com' },
    toolOutput: { result: {} },
  },
  { actionName: 'act', actionArgs: { action: 'click en Enviar' }, toolOutput: { result: {} } },
];

function bandeja(extra?: Partial<PercepcionDePagina>): PercepcionDePagina {
  return {
    url: 'https://mail.google.com/mail/u/0/#inbox',
    titulo: 'Recibidos',
    nodos: 3200,
    foco: 'input text q Buscar correo',
    campos: [{ contexto: 'input text q Buscar correo', valor: 'martin@ejemplo.com' }],
    ...extra,
  };
}

/**
 * Corre la secuencia entera contra el bucle del motor y devuelve TODO lo que el modelo habria
 * recibido por el canal de percepcion, mas cuantas veces se leyo la pagina.
 */
async function correrLaSecuencia(opciones: {
  conEstrategias: boolean;
}): Promise<{ mensajes: string[]; lecturas: number; porAccion: EstrategiaLocalizacion[][] }> {
  let lecturas = 0;
  const porAccion: EstrategiaLocalizacion[][] = [];
  const control = crearControlDePercepcion({
    percibir: async (objetivo?: ObjetivoDeLectura | undefined) => {
      lecturas += 1;
      return bandeja(
        opciones.conEstrategias && objetivo !== undefined ? { estrategias: [LEIDA_DEL_DOM] } : {},
      );
    },
  });
  await control.inicializar();
  const ejecucion = construirOpcionesDeEjecucion({
    objetivo: 'enviar un correo',
    maxPasos: 20,
    toolTimeoutMs: 1000,
    historialPasos: 8,
    percepcion: control,
    registrarEstrategias: (lista) => porAccion.push(...lista),
  });
  const mensajes: string[] = [];
  const base: MensajeDeModelo[] = [{ role: 'user', content: 'objetivo' }];
  for (const paso of PASOS) {
    await ejecucion.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: paso.actionName,
      actionArgs: paso.actionArgs,
      reasoning: '',
      toolOutput: { ok: true, result: paso.toolOutput.result },
    } as never);
    const preparado = await ejecucion.callbacks?.prepareStep?.({ messages: base } as never);
    for (const mensaje of (preparado as { messages: MensajeDeModelo[] }).messages) {
      mensajes.push(String(mensaje.content));
    }
  }
  return { mensajes, lecturas, porAccion };
}

describe('garantias de no regresion de la lectura fusionada', () => {
  it('el texto de percepcion que llega al modelo es IDENTICO con y sin la lectura', async () => {
    const sin = await correrLaSecuencia({ conEstrategias: false });
    const con = await correrLaSecuencia({ conEstrategias: true });
    expect(con.mensajes).toEqual(sin.mensajes);
    // Y no es una comparacion vacia: la secuencia si produjo lineas de percepcion.
    expect(sin.mensajes.some((texto) => texto.includes(PREFIJO_PERCEPCION))).toBe(true);
  });

  it('el numero de lecturas de la pagina (conexiones CDP) NO aumenta', async () => {
    const sin = await correrLaSecuencia({ conEstrategias: false });
    const con = await correrLaSecuencia({ conEstrategias: true });
    expect(con.lecturas).toBe(sin.lecturas);
    // Una por la huella inicial mas una por paso que toca la pagina; la captura no paga ninguna.
    expect(con.lecturas).toBe(1 + PASOS.length - 1);
  });

  it('el dato del atlas NO se encola como linea ni consume ranuras del presupuesto', async () => {
    const con = await correrLaSecuencia({ conEstrategias: true });
    const sin = await correrLaSecuencia({ conEstrategias: false });
    expect(con.mensajes.join('\n')).not.toContain('marca-que-solo-vive-en-el-atlas');
    for (const mensaje of con.mensajes) {
      expect(mensaje.split('\n').length).toBeLessThanOrEqual(MAX_LINEAS_POR_TURNO);
    }
    expect(con.mensajes).toHaveLength(sin.mensajes.length);
    // Pero SI se recogieron para el atlas, por el canal que no ve el modelo.
    expect(con.porAccion.filter((lista) => lista.length > 0).length).toBeGreaterThan(0);
  });

  it('lo emitido queda alineado UNA ENTRADA POR ACCION con la traza del motor', async () => {
    const con = await correrLaSecuencia({ conEstrategias: true });
    // Cinco tools, cinco acciones en la traza (ninguna de ellas es fillForm).
    expect(con.porAccion).toHaveLength(PASOS.length);
    // La captura no toca la pagina: su ranura va vacia, pero existe.
    expect(con.porAccion[2]).toEqual([]);
    expect(con.porAccion[0]).toEqual([LEIDA_DEL_DOM]);
  });

  it('fillForm empuja una accion por campo y todas sus ranuras quedan emitidas', async () => {
    const porAccion: EstrategiaLocalizacion[][] = [];
    const control = crearControlDePercepcion({ percibir: async () => bandeja() });
    const ejecucion = construirOpcionesDeEjecucion({
      objetivo: 'x',
      maxPasos: 5,
      toolTimeoutMs: 1000,
      historialPasos: 8,
      percepcion: control,
      registrarEstrategias: (lista) => porAccion.push(...lista),
    });
    await ejecucion.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: 'fillForm',
      actionArgs: {},
      reasoning: '',
      toolOutput: {
        ok: true,
        result: {
          playwrightArguments: [{ selector: 'xpath=/a' }, { selector: 'xpath=/b' }],
        },
      },
    } as never);
    // La accion de la propia tool mas una por campo resuelto.
    expect(porAccion).toHaveLength(3);
  });

  it('una lectura que falla degrada: sin dato para el atlas, percepcion y desenlace intactos', async () => {
    const control = crearControlDePercepcion({
      percibir: async () => {
        throw new Error('sesion caida');
      },
    });
    await control.inicializar();
    const estrategias = await control.alTerminarPaso(PASOS[0] as EventoDePasoPercibido);
    expect(estrategias).toEqual([]);
    expect(control.tomarLineas()).toEqual([]);
  });

  it('una lectura que vuelve sin estrategias no rompe nada: lista vacia', async () => {
    const control = crearControlDePercepcion({ percibir: async () => bandeja() });
    await control.inicializar();
    expect(await control.alTerminarPaso(PASOS[0] as EventoDePasoPercibido)).toEqual([]);
  });

  it('sin percepcion cableada no se emite nada para el atlas', async () => {
    const porAccion: EstrategiaLocalizacion[][] = [];
    const ejecucion = construirOpcionesDeEjecucion({
      objetivo: 'x',
      maxPasos: 5,
      toolTimeoutMs: 1000,
      historialPasos: 8,
      registrarAccion: () => {},
      registrarEstrategias: (lista) => porAccion.push(...lista),
    });
    await ejecucion.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: 'goto',
      actionArgs: { instruction: 'ir al inicio' },
      reasoning: '',
      toolOutput: { ok: true, result: {} },
    } as never);
    expect(porAccion).toEqual([]);
  });
});

describe('objetivoDeLectura: que elemento se lee en cada paso', () => {
  it('act de escritura: el campo donde aterrizo el texto', () => {
    expect(objetivoDeLectura(PASOS[1] as EventoDePasoPercibido)).toEqual({
      tipo: 'campo',
      texto: 'martin@ejemplo.com',
    });
  });

  it('act de click con selector: ese elemento, sin el prefijo de Stagehand', () => {
    expect(objetivoDeLectura(PASOS[0] as EventoDePasoPercibido)).toEqual({
      tipo: 'xpath',
      xpath: '/html[1]/body[1]/div[1]',
    });
  });

  it('act resuelto por VISION (sin playwrightArguments): el elemento enfocado', () => {
    expect(objetivoDeLectura(PASOS[4] as EventoDePasoPercibido)).toEqual({ tipo: 'foco' });
  });

  it('act de click SIN selector utilizable: el elemento enfocado', () => {
    expect(
      objetivoDeLectura({
        actionName: 'act',
        actionArgs: { action: 'click' },
        toolOutput: { result: { playwrightArguments: { method: 'click', selector: '#id' } } },
      }),
    ).toEqual({ tipo: 'foco' });
  });

  it('tools nativas por coordenadas: click lee el foco y type el campo del texto', () => {
    expect(objetivoDeLectura({ actionName: 'click', actionArgs: {}, toolOutput: { result: {} } })).toEqual({
      tipo: 'foco',
    });
    expect(objetivoDeLectura(PASOS[3] as EventoDePasoPercibido)).toEqual({
      tipo: 'campo',
      texto: 'martin@ejemplo.com',
    });
  });

  it('los pasos que el atlas nunca clasifica no piden ninguna lectura', () => {
    for (const actionName of ['screenshot', 'extract', 'ariaTree', 'done', 'goto', 'scroll', 'keys']) {
      expect(objetivoDeLectura({ actionName, actionArgs: {}, toolOutput: { result: {} } })).toBeNull();
    }
    // Un act que ni escribe ni clickea (pulsar una tecla sobre el campo) tampoco.
    expect(
      objetivoDeLectura({
        actionName: 'act',
        actionArgs: { action: 'press Tab' },
        toolOutput: { result: { playwrightArguments: { method: 'press', arguments: ['Tab'] } } },
      }),
    ).toBeNull();
  });
});
