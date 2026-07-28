import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { PasoTrayectoria, TrayectoriaConPasos } from '@ledesma-platform/backend/trayectorias';
import type { NuevaRecetaWeb, RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import {
  convertirTrayectoriaPersistida,
  derivarEstrategiasDeDescripcion,
  derivarEstrategiasDePaso,
  derivarEstrategiasDeSelector,
  pasosCensuradosDesdeTrayectorias,
  procesarJobDePromoverTrayectoria,
  type PromocionTrayectoriaDeps,
} from '../src/promover-trayectoria.js';
import { VALOR_CENSURADO } from '../src/censura.js';
import type { Logger } from '../src/logger.js';

/**
 * GUARDAR COMO TAREA APRENDIDA: conversion de una trayectoria PERSISTIDA (V030) a receta (V035) con
 * consentimiento. El fixture central reproduce el caso real que motivo la funcionalidad: el envio de
 * un correo en Gmail en 19 pasos, con su verificacion determinista y un reintento a mitad de camino.
 * Lo que estos tests fijan:
 *  - solo los pasos CON EFECTO del flujo exitoso quedan en la receta (screenshots, ariaTree,
 *    extract, scroll, think y done se descartan; los pasos fallidos tambien);
 *  - los valores tecleados que coinciden con los parametros del objetivo quedan como MARCADORES
 *    (jamas el valor), con el mismo vocabulario del extractor determinista;
 *  - las estrategias derivadas del selector priorizan el atributo estable sobre el xpath;
 *  - la verificacion viaja como paso 'verificar' (la receta derivada no puede saltarse la guardia);
 *  - el handler del job es idempotente ante el doble guardado y estampa el vinculo de auditoria.
 */

const OWNER = 'user-1';
const JOB_ORIGEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DOMINIO = 'mail.google.com';
const OBJETIVO =
  'envia un correo a martin@ejemplo.com con asunto "Reporte semanal" y cuerpo "Adjunto el resumen de la semana"';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(payload: unknown): Job {
  return {
    id: 'job-promo-1',
    agentId: null,
    ownerId: OWNER,
    credentialId: null,
    status: 'running',
    payload,
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    startedAt: '2026-07-27T00:00:00.000Z',
    finishedAt: null,
  };
}

let siguienteId = 0;
function paso(
  idx: number,
  accion: { tipo: string; instruccion?: string | null; metodo?: string | null; argumentos?: string[] },
  extras: Partial<Pick<PasoTrayectoria, 'selector' | 'valorCensurado' | 'url' | 'exito'>> = {},
): PasoTrayectoria {
  siguienteId += 1;
  return {
    id: `paso-${siguienteId}`,
    idx,
    accion: {
      tipo: accion.tipo,
      instruccion: accion.instruccion ?? null,
      metodo: accion.metodo ?? null,
      argumentos: accion.argumentos ?? [],
    },
    selector: extras.selector ?? null,
    valorCensurado: extras.valorCensurado ?? null,
    url: extras.url ?? `https://${DOMINIO}/mail/u/0/`,
    exito: extras.exito ?? true,
    creadoEn: '2026-07-26T18:00:00.000Z',
  };
}

/** La trayectoria REAL del caso Gmail: 19 pasos persistidos, con verificacion y un reintento. */
function pasosGmail(): PasoTrayectoria[] {
  siguienteId = 0;
  return [
    paso(0, { tipo: 'goto', instruccion: 'abrir el correo' }, { url: `https://${DOMINIO}/` }),
    paso(1, { tipo: 'screenshot' }),
    paso(2, { tipo: 'ariaTree' }),
    paso(3, { tipo: 'act', instruccion: 'click en Redactar', metodo: 'click' }, {
      selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[1]/div[2]/div[1]/div[1]',
    }),
    paso(4, { tipo: 'screenshot' }),
    paso(5, { tipo: 'act', instruccion: 'escribir el destinatario', metodo: 'fill', argumentos: ['martin@ejemplo.com'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
      valorCensurado: 'martin@ejemplo.com',
    }),
    paso(6, { tipo: 'keys', argumentos: ['Enter'] }),
    paso(7, { tipo: 'act', instruccion: 'escribir el asunto', metodo: 'fill', argumentos: ['Reporte semanal'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`,
      valorCensurado: 'Reporte semanal',
    }),
    paso(8, { tipo: 'screenshot' }),
    paso(9, { tipo: 'act', instruccion: 'escribir el cuerpo', metodo: 'fill', argumentos: ['Adjunto el resumen de la semana'] }, {
      selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[2]/div[1]/div[2]',
      valorCensurado: 'Adjunto el resumen de la semana',
    }),
    paso(10, { tipo: 'extract' }),
    paso(11, { tipo: 'scroll' }),
    // Reintento real del caso: el primer click al selector del boton fallo y el motor reintento.
    paso(12, { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click' }, {
      selector: 'xpath=/html[1]/body[1]/div[7]/div[999]/div[1]',
      exito: false,
    }),
    paso(13, { tipo: 'act', instruccion: 'abrir opciones de envio', metodo: 'click' }, {
      selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[4]/div[1]',
    }),
    paso(14, { tipo: 'verificacion', instruccion: 'verificacion previa: los datos coinciden con lo pedido' }),
    paso(15, { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`,
    }),
    paso(16, { tipo: 'screenshot' }),
    paso(17, { tipo: 'extract', instruccion: 'confirmar que el mensaje se envio' }),
    paso(18, { tipo: 'done' }),
  ];
}

function trayectoria(overrides: Partial<TrayectoriaConPasos> = {}): TrayectoriaConPasos {
  return {
    id: 'tray-1',
    ownerId: OWNER,
    jobId: JOB_ORIGEN,
    connectionId: 'conn-1',
    dominio: DOMINIO,
    objetivo: OBJETIVO,
    estado: 'exitosa',
    iniciadaEn: '2026-07-26T18:00:00.000Z',
    terminadaEn: '2026-07-26T18:05:00.000Z',
    duracionMs: 300_000,
    tokensIn: 1000,
    tokensOut: 100,
    creadaEn: '2026-07-26T18:00:00.000Z',
    pasos: pasosGmail(),
    ...overrides,
  };
}

describe('derivarEstrategiasDeSelector', () => {
  it('convierte el selector de Stagehand (con prefijo xpath=) en una estrategia xpath', () => {
    expect(derivarEstrategiasDeSelector('xpath=/html[1]/body[1]/button[1]')).toEqual([
      { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
    ]);
  });

  it('deriva estrategias de atributo estable de los predicados del xpath', () => {
    const estrategias = derivarEstrategiasDeSelector(
      `xpath=/html[1]//div[@aria-label='Enviar'][@class='ignorado']`,
    );
    // El atributo estable entra; `class` no es estable y queda fuera; el xpath cierra la lista.
    expect(estrategias).toEqual([
      { tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' },
      { tipo: 'xpath', xpath: `/html[1]//div[@aria-label='Enviar'][@class='ignorado']` },
    ]);
  });

  it('sin selector, o con uno que no es un xpath, no hay estrategias', () => {
    expect(derivarEstrategiasDeSelector(null)).toEqual([]);
    expect(derivarEstrategiasDeSelector('boton de enviar')).toEqual([]);
  });
});

describe('derivarEstrategiasDeDescripcion (FIX estrategias multiples, 28 jul 2026)', () => {
  it('un click sin palabra de rol deriva boton y texto visible', () => {
    expect(
      derivarEstrategiasDeDescripcion({ tipo: 'act', instruccion: 'click en Enviar', metodo: 'click', argumentos: [] }),
    ).toEqual([
      { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
      { tipo: 'texto', texto: 'Enviar' },
    ]);
  });

  it('el rol nombrado ANTES del campo se deriva con el nombre completo', () => {
    expect(
      derivarEstrategiasDeDescripcion({
        tipo: 'act',
        instruccion: 'click the textbox Cuerpo del mensaje',
        metodo: 'click',
        argumentos: [],
      }),
    ).toEqual([{ tipo: 'rol', rol: 'textbox', nombre: 'Cuerpo del mensaje' }]);
  });

  it('el rol nombrado DESPUES del campo se deriva con su mapeo', () => {
    expect(
      derivarEstrategiasDeDescripcion({
        tipo: 'act',
        instruccion: 'click the recipients field',
        metodo: 'click',
        argumentos: [],
      }),
    ).toEqual([{ tipo: 'rol', rol: 'textbox', nombre: 'recipients' }]);
  });

  it('una escritura deriva un textbox por campo nombrado, sin el valor tecleado', () => {
    expect(
      derivarEstrategiasDeDescripcion({
        tipo: 'act',
        instruccion: 'type Reporte semanal into the subject field',
        metodo: 'fill',
        argumentos: ['Reporte semanal'],
      }),
    ).toEqual([{ tipo: 'rol', rol: 'textbox', nombre: 'subject' }]);
    expect(
      derivarEstrategiasDeDescripcion({
        tipo: 'act',
        instruccion: 'type the message into the body',
        metodo: 'type',
        argumentos: ['hola'],
      }),
    ).toEqual([
      { tipo: 'rol', rol: 'textbox', nombre: 'message' },
      { tipo: 'rol', rol: 'textbox', nombre: 'body' },
    ]);
  });

  it('sin instruccion, o con un metodo que no es click ni escritura, no deriva nada', () => {
    expect(
      derivarEstrategiasDeDescripcion({ tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] }),
    ).toEqual([]);
    expect(
      derivarEstrategiasDeDescripcion({
        tipo: 'act',
        instruccion: 'press Tab key to confirm the recipient',
        metodo: 'press',
        argumentos: ['Tab'],
      }),
    ).toEqual([]);
    expect(
      derivarEstrategiasDeDescripcion({
        tipo: 'act',
        instruccion: 'click the message body area',
        metodo: null,
        argumentos: [],
      }),
    ).toEqual([]);
  });
});

describe('derivarEstrategiasDePaso', () => {
  it('combina atributos del selector, derivadas de la descripcion y el xpath al FINAL', () => {
    const estrategias = derivarEstrategiasDePaso(
      `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
      { tipo: 'act', instruccion: 'escribir el destinatario', metodo: 'fill', argumentos: ['a@b.com'] },
    );
    expect(estrategias).toEqual([
      { tipo: 'atributo', atributo: 'aria-label', valor: 'Para' },
      { tipo: 'rol', rol: 'textbox', nombre: 'destinatario' },
      { tipo: 'xpath', xpath: `/html[1]/body[1]/div[7]//input[@aria-label='Para']` },
    ]);
  });

  it('un xpath posicional puro con descripcion deja de ser la unica estrategia', () => {
    const estrategias = derivarEstrategiasDePaso('xpath=/html[1]/body[1]/div[31]/div[2]', {
      tipo: 'act',
      instruccion: 'escribir el cuerpo',
      metodo: 'fill',
      argumentos: ['hola'],
    });
    expect(estrategias).toEqual([
      { tipo: 'rol', rol: 'textbox', nombre: 'cuerpo' },
      { tipo: 'xpath', xpath: '/html[1]/body[1]/div[31]/div[2]' },
    ]);
  });
});

describe('pasosCensuradosDesdeTrayectorias', () => {
  it('descarta los pasos fallidos y renumera los idx de forma continua', () => {
    const pasos = pasosCensuradosDesdeTrayectorias([trayectoria()]);
    expect(pasos).toHaveLength(18);
    expect(pasos.map((p) => p.idx)).toEqual([...pasos.keys()]);
    expect(pasos.every((p) => p.exito)).toBe(true);
    expect(pasos.some((p) => p.selector?.includes('div[999]'))).toBe(false);
  });
});

describe('convertirTrayectoriaPersistida (fixture Gmail de 19 pasos)', () => {
  it('produce la receta limpia: solo pasos con efecto, en orden', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria()]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'click',
      'verificar',
      'click',
    ]);
    expect(resultado.pasos[0]?.ruta).toBe('/');
    expect(resultado.pasos[3]?.teclas).toBe('Enter');
  });

  it('sustituye los valores tecleados por los marcadores del objetivo, sin guardar los valores', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria()]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    expect(escritos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
    // Ningun valor concreto queda persistido en ningun paso.
    const serializada = JSON.stringify(resultado.pasos);
    expect(serializada).not.toContain('martin@ejemplo.com');
    expect(serializada).not.toContain('Reporte semanal');
    // La firma declara los tres datos con los marcadores del extractor determinista.
    expect(resultado.firmaObjetivo).toContain('<destinatario>');
    expect(resultado.firmaObjetivo).toContain('<asunto>');
    expect(resultado.firmaObjetivo).toContain('<cuerpo>');
  });

  it('prioriza el atributo estable derivado del selector por encima del xpath', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria()]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const destinatario = resultado.pasos.find(
      (p) => p.accion === 'escribir' && p.valor?.tipo === 'parametro' && p.valor.parametro === 'destinatario',
    );
    expect(destinatario?.estrategias[0]).toEqual({ tipo: 'atributo', atributo: 'aria-label', valor: 'Para' });
    expect(destinatario?.estrategias[destinatario.estrategias.length - 1]?.tipo).toBe('xpath');
    const enviar = resultado.pasos[resultado.pasos.length - 1];
    expect(enviar?.estrategias[0]).toEqual({ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' });
  });

  it('conserva la verificacion como paso verificar (el objetivo pide una accion irreversible)', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria()]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const verificar = resultado.pasos.findIndex((p) => p.accion === 'verificar');
    // La verificacion queda JUSTO antes del click que compromete, como en la corrida real.
    expect(verificar).toBe(resultado.pasos.length - 2);
  });

  it('rechaza cuando la ultima trayectoria no fue exitosa', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria({ estado: 'fallida' })]);
    expect(resultado.guardable).toBe(false);
  });

  it('rechaza una tarea que cruzo varios sitios (el registro no conserva el sitio de cada paso)', () => {
    const resultado = convertirTrayectoriaPersistida([
      trayectoria({ id: 'tray-a', dominio: 'tienda.ejemplo.com', estado: 'pausada' }),
      trayectoria({ id: 'tray-b' }),
    ]);
    expect(resultado.guardable).toBe(false);
  });

  it('rechaza si un valor censurado no corresponde a ningun parametro del objetivo', () => {
    const pasos = pasosGmail().map((p) =>
      p.accion !== null && (p.accion as { tipo: string }).tipo === 'act' && p.idx === 7
        ? {
            ...p,
            accion: { tipo: 'act', instruccion: null, metodo: 'fill', argumentos: [VALOR_CENSURADO] },
            valorCensurado: VALOR_CENSURADO,
          }
        : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
  });

  it('un click sin selector pero con descripcion se promueve con las estrategias derivadas de ella', () => {
    const pasos = pasosGmail().map((p) => (p.idx === 15 ? { ...p, selector: null } : p));
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const enviar = resultado.pasos[resultado.pasos.length - 1];
    expect(enviar?.estrategias).toEqual([
      { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
      { tipo: 'texto', texto: 'Enviar' },
    ]);
  });

  it('rechaza un paso con efecto sin selector NI descripcion de la que derivar estrategias', () => {
    const pasos = pasosGmail().map((p) =>
      p.idx === 15
        ? { ...p, selector: null, accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] } }
        : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
  });

  it('un paso que solo tiene xpath se conserva y queda reportado en pasosSoloXpath', () => {
    // El click de Redactar pierde la instruccion: su selector posicional puro es lo unico que queda.
    const pasos = pasosGmail().map((p) =>
      p.idx === 3
        ? { ...p, accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] } }
        : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    expect(resultado.pasos[1]?.estrategias).toEqual([
      { tipo: 'xpath', xpath: '/html[1]/body[1]/div[7]/div[3]/div[1]/div[2]/div[1]/div[1]' },
    ]);
    expect(resultado.pasosSoloXpath).toEqual(['paso 1 (click)']);
  });
});

/**
 * La trayectoria REAL del primer envio exitoso en produccion (jul 2026): identica a la fixture Gmail
 * salvo dos pasos. El paso 4 es un FILLFORMVISION (llenado por vision de Stagehand: sin selector, sin
 * metodo y sin argumentos persistidos), seguido de los act que rellenaron Para, Asunto y Cuerpo CON
 * selector. Y el paso 6 es el act REAL "press Tab key to confirm the recipient" (metodo 'press' con
 * la tecla en argumentos y el selector del campo Para), no el paso sintetico 'keys'. Antes de los
 * fixes, el primero abortaba la conversion con "paso fillFormVision sin ninguna estrategia de
 * localizacion" y el segundo con "metodo no re-ejecutable: press".
 */
function pasosGmailConFillFormVision(): PasoTrayectoria[] {
  return pasosGmail().map((p) => {
    if (p.idx === 4) {
      return {
        ...p,
        accion: {
          tipo: 'fillFormVision',
          instruccion: 'llenar los campos del correo',
          metodo: null,
          argumentos: [],
        },
        selector: null,
      };
    }
    if (p.idx === 6) {
      return {
        ...p,
        accion: {
          tipo: 'act',
          instruccion: 'press Tab key to confirm the recipient',
          metodo: 'press',
          argumentos: ['Tab'],
        },
        selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
      };
    }
    return p;
  });
}

describe('convertirTrayectoriaPersistida (fixture real: fillFormVision en el paso 4 y press Tab en el 6)', () => {
  it('convierte la trayectoria COMPLETA: fillFormVision descompuesto, press Tab, acts y clic final', () => {
    const resultado = convertirTrayectoriaPersistida([
      trayectoria({ pasos: pasosGmailConFillFormVision() }),
    ]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    // La cabecera del llenado por vision se omite porque Para, Asunto y Cuerpo quedaron cubiertos
    // con selector, y el press Tab se promueve como paso 'teclas' EN SU POSICION.
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'click',
      'verificar',
      'click',
    ]);
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    expect(escritos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
  });

  it('el press Tab conserva la tecla y la localizacion del campo sobre el que se pulso', () => {
    const resultado = convertirTrayectoriaPersistida([
      trayectoria({ pasos: pasosGmailConFillFormVision() }),
    ]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const teclas = resultado.pasos.find((p) => p.accion === 'teclas');
    expect(teclas?.teclas).toBe('Tab');
    // El selector del act se conserva como estrategias: el ejecutor pulsa sobre ese elemento (el
    // mismo gesto con el que las recetas grabadas confirman un chip de destinatario).
    expect(teclas?.estrategias[0]).toEqual({ tipo: 'atributo', atributo: 'aria-label', valor: 'Para' });
  });

  it('un press sin tecla registrada rechaza con motivo especifico', () => {
    const pasos = pasosGmailConFillFormVision().map((p) =>
      p.idx === 6
        ? { ...p, accion: { tipo: 'act', instruccion: null, metodo: 'press', argumentos: [] } }
        : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
    if (resultado.guardable) return;
    expect(resultado.motivo).toContain('pulsacion sin teclas registradas');
  });

  it('si un dato del objetivo queda sin cubrir por otro paso, falla con motivo especifico', () => {
    // Sin el act del asunto (idx 7), el dato 'asunto' que el fillFormVision pudo haber llenado no
    // queda cubierto: la conversion debe fallar diciendo el paso y el dato, no con el motivo generico.
    const pasos = pasosGmailConFillFormVision().map((p) =>
      p.idx === 7 ? { ...p, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] }, selector: null, valorCensurado: null } : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
    if (resultado.guardable) return;
    expect(resultado.motivo).toContain('fillFormVision');
    expect(resultado.motivo).toContain('asunto');
  });

  it('un fillFormVision con el campo registrado (metodo, valor y selector) se descompone en escritura', () => {
    // Futuro-compatible: si el registro trae la escritura del campo con localizacion, se promueve
    // como paso escribir en vez de descartarse.
    const pasos = pasosGmailConFillFormVision().map((p) =>
      p.idx === 7
        ? {
            ...p,
            accion: { tipo: 'fillFormVision', instruccion: null, metodo: 'fill', argumentos: ['Reporte semanal'] },
            selector: `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`,
            valorCensurado: 'Reporte semanal',
          }
        : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    expect(escritos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
  });

  it('sin datos declarados en el objetivo, un fillFormVision sin registro falla con motivo especifico', () => {
    const resultado = convertirTrayectoriaPersistida([
      trayectoria({
        objetivo: 'archiva el primer mensaje de la bandeja',
        pasos: pasosGmailConFillFormVision(),
      }),
    ]);
    expect(resultado.guardable).toBe(false);
    if (resultado.guardable) return;
    expect(resultado.motivo).toContain('fillFormVision');
    expect(resultado.motivo).toContain('cobertura');
  });
});

/**
 * La trayectoria REAL de 19 pasos del 27 jul 2026 (el otro caso de produccion que la promocion
 * rechazaba con "paso act sin ninguna estrategia de localizacion"): el TYPE del cuerpo llego CON el
 * dato pero SIN selector (paso 13), seguido del click del MISMO campo CON selector (paso 14). La
 * derivacion cruzada (FIX A) debe hacer que el paso de escritura del cuerpo adopte el localizador
 * del click del paso 14.
 */
function pasosGmailReal19(): PasoTrayectoria[] {
  siguienteId = 0;
  return [
    paso(0, { tipo: 'goto', instruccion: 'abrir el correo' }, { url: `https://${DOMINIO}/` }),
    paso(1, { tipo: 'screenshot' }),
    paso(2, { tipo: 'ariaTree' }),
    paso(3, { tipo: 'act', instruccion: 'click en Redactar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Redactar']`,
    }),
    paso(4, { tipo: 'screenshot' }),
    paso(5, { tipo: 'act', instruccion: 'escribir el destinatario', metodo: 'fill', argumentos: ['martin@ejemplo.com'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
      valorCensurado: 'martin@ejemplo.com',
    }),
    paso(6, { tipo: 'act', instruccion: 'press Tab key to confirm the recipient', metodo: 'press', argumentos: ['Tab'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
    }),
    paso(7, { tipo: 'act', instruccion: 'escribir el asunto', metodo: 'fill', argumentos: ['Reporte semanal'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`,
      valorCensurado: 'Reporte semanal',
    }),
    paso(8, { tipo: 'screenshot' }),
    paso(9, { tipo: 'extract', instruccion: 'leer los campos del formulario' }),
    paso(10, { tipo: 'scroll' }),
    paso(11, { tipo: 'screenshot' }),
    paso(12, { tipo: 'think' }),
    // El paso culpable del caso real: el type del cuerpo trae el dato pero llego SIN selector.
    paso(13, { tipo: 'act', instruccion: 'type the message into the body', metodo: 'type', argumentos: ['Adjunto el resumen de la semana'] }, {
      valorCensurado: 'Adjunto el resumen de la semana',
    }),
    // Y el click del MISMO campo con selector propio, inmediatamente despues.
    paso(14, { tipo: 'act', instruccion: 'click the textbox Cuerpo del mensaje', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Cuerpo del mensaje']`,
    }),
    paso(15, { tipo: 'verificacion', instruccion: 'verificacion previa: los datos coinciden con lo pedido' }),
    paso(16, { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`,
    }),
    paso(17, { tipo: 'extract', instruccion: 'confirmar que el mensaje se envio' }),
    paso(18, { tipo: 'done' }),
  ];
}

describe('convertirTrayectoriaPersistida (fixture real de 19 pasos: type del cuerpo sin selector)', () => {
  it('la fixture reproduce el caso real: 19 pasos, con el type del cuerpo sin selector en el 13', () => {
    const pasos = pasosGmailReal19();
    expect(pasos).toHaveLength(19);
    const culpable = pasos[13];
    expect((culpable?.accion as { metodo: string | null }).metodo).toBe('type');
    expect(culpable?.selector).toBeNull();
    expect(culpable?.valorCensurado).not.toBeNull();
    expect(pasos[14]?.selector).not.toBeNull();
  });

  it('convierte la trayectoria COMPLETA: el cuerpo se escribe con el localizador del click del 14', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos: pasosGmailReal19() })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    // La receta queda en el rango esperado (6 a 10 pasos) con el flujo esencial completo.
    expect(resultado.pasos.length).toBeGreaterThanOrEqual(6);
    expect(resultado.pasos.length).toBeLessThanOrEqual(10);
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'click',
      'verificar',
      'click',
    ]);
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    expect(escritos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
    // FIX A: la escritura del cuerpo adopta las estrategias derivadas del selector del paso 14.
    const cuerpo = escritos[escritos.length - 1];
    expect(cuerpo?.estrategias[0]).toEqual({
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Cuerpo del mensaje',
    });
    // Ningun valor concreto queda persistido en ningun paso.
    const serializada = JSON.stringify(resultado.pasos);
    expect(serializada).not.toContain('martin@ejemplo.com');
    expect(serializada).not.toContain('Adjunto el resumen de la semana');
  });

  it('sin adyacente que cubra el campo NI descripcion, rechaza nombrando el paso 13 (FIX B)', () => {
    // El click del 14 apunta a OTRO campo y el type del 13 pierde su instruccion: ni la derivacion
    // cruzada ni la derivacion por descripcion tienen de donde sacar un localizador.
    const pasos = pasosGmailReal19().map((p) => {
      if (p.idx === 13) {
        return {
          ...p,
          accion: { tipo: 'act', instruccion: null, metodo: 'type', argumentos: ['Adjunto el resumen de la semana'] },
        };
      }
      if (p.idx === 14) {
        return {
          ...p,
          accion: { tipo: 'act', instruccion: 'click the subject field', metodo: 'click', argumentos: [] },
          selector: `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`,
        };
      }
      return p;
    });
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
    if (resultado.guardable) return;
    expect(resultado.motivo).toContain('paso 13');
    expect(resultado.motivo).toContain('sin estrategia y sin paso adyacente que cubra el campo');
  });

  it('Para, Asunto, Cuerpo y Enviar llevan al menos una estrategia que no es xpath', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos: pasosGmailReal19() })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    const enviar = resultado.pasos[resultado.pasos.length - 1];
    expect(escritos).toHaveLength(3);
    for (const paso of [...escritos, enviar]) {
      expect(paso?.estrategias.some((e) => e.tipo !== 'xpath')).toBe(true);
    }
    expect(resultado.pasosSoloXpath).toEqual([]);
  });
});

/**
 * La trayectoria REAL del segundo caso de produccion (28 jul 2026): el envio exitoso de 44 pasos que
 * la promocion rechazaba con "paso act sin ninguna estrategia de localizacion". Los pasos culpables
 * son acts de CLICK sin selector y sin dato: clicks de FOCO sobre el campo que un fill posterior con
 * selector propio vuelve a enfocar ("click the textbox Cuerpo del mensaje", "click the message body
 * area") y DESVIOS de la corrida (expandir el compose, pantalla completa) que ninguna receta debe
 * repetir. La escritura de cada campo SI tiene selector, y el clic final de Enviar tambien.
 *
 * FIEL A LA BASE (correccion del 28 jul): esos acts se resolvieron POR VISION, o sea SIN
 * playwrightArguments, y la fila persistida no trae NI metodo NI selector (trayectoria.ts,
 * accionDeFila). La regla del PR 258 exigia metodo 'click' y por eso en produccion seguian
 * bloqueando la conversion con el motivo generico.
 */
function pasosGmailReal44(): PasoTrayectoria[] {
  siguienteId = 0;
  return [
    paso(0, { tipo: 'goto', instruccion: 'abrir el correo' }, { url: `https://${DOMINIO}/` }),
    paso(1, { tipo: 'screenshot' }),
    paso(2, { tipo: 'ariaTree' }),
    paso(3, { tipo: 'think', instruccion: 'planear los pasos del envio' }),
    paso(4, { tipo: 'act', instruccion: 'click en Redactar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Redactar']`,
    }),
    paso(5, { tipo: 'screenshot' }),
    paso(6, { tipo: 'ariaTree' }),
    // Click de FOCO sin selector: el fill del destinatario (paso 8) enfoca su propio localizador.
    paso(7, { tipo: 'act', instruccion: 'click the recipients field' }),
    paso(8, { tipo: 'act', instruccion: 'escribir el destinatario', metodo: 'fill', argumentos: ['martin@ejemplo.com'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
      valorCensurado: 'martin@ejemplo.com',
    }),
    paso(9, { tipo: 'act', instruccion: 'press Tab key to confirm the recipient', metodo: 'press', argumentos: ['Tab'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
    }),
    paso(10, { tipo: 'screenshot' }),
    paso(11, { tipo: 'act', instruccion: 'click the subject field' }),
    paso(12, { tipo: 'act', instruccion: 'escribir el asunto', metodo: 'fill', argumentos: ['Reporte semanal'] }, {
      selector: `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`,
      valorCensurado: 'Reporte semanal',
    }),
    paso(13, { tipo: 'screenshot' }),
    paso(14, { tipo: 'extract', instruccion: 'leer los campos del formulario' }),
    // DESVIOS sin selector: agrandar el compose y ponerlo en pantalla completa. No aportan dato y
    // el flujo que importa (escribir el cuerpo) queda cubierto por el fill del paso 21.
    paso(15, { tipo: 'act', instruccion: 'click to expand the compose window' }),
    paso(16, { tipo: 'screenshot' }),
    paso(17, { tipo: 'act', instruccion: 'toggle full screen mode for the compose window' }),
    paso(18, { tipo: 'screenshot' }),
    // Los dos clicks de FOCO del caso real, sobre el cuerpo del mensaje, sin selector ninguno.
    paso(19, { tipo: 'act', instruccion: 'click the textbox Cuerpo del mensaje' }),
    paso(20, { tipo: 'act', instruccion: 'click the message body area' }),
    paso(21, { tipo: 'act', instruccion: 'escribir el cuerpo', metodo: 'fill', argumentos: ['Adjunto el resumen de la semana'] }, {
      selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[2]/div[1]/div[2]',
      valorCensurado: 'Adjunto el resumen de la semana',
    }),
    paso(22, { tipo: 'extract' }),
    paso(23, { tipo: 'scroll' }),
    paso(24, { tipo: 'screenshot' }),
    paso(25, { tipo: 'ariaTree' }),
    paso(26, { tipo: 'think' }),
    paso(27, { tipo: 'screenshot' }),
    paso(28, { tipo: 'extract', instruccion: 'confirmar que los campos quedaron llenos' }),
    paso(29, { tipo: 'think' }),
    paso(30, { tipo: 'screenshot' }),
    paso(31, { tipo: 'ariaTree' }),
    paso(32, { tipo: 'scroll' }),
    paso(33, { tipo: 'screenshot' }),
    paso(34, { tipo: 'verificacion', instruccion: 'verificacion previa: los datos coinciden con lo pedido' }),
    paso(35, { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`,
    }),
    paso(36, { tipo: 'screenshot' }),
    paso(37, { tipo: 'extract', instruccion: 'confirmar que el mensaje se envio' }),
    paso(38, { tipo: 'screenshot' }),
    paso(39, { tipo: 'extract' }),
    paso(40, { tipo: 'think' }),
    paso(41, { tipo: 'screenshot' }),
    paso(42, { tipo: 'extract' }),
    paso(43, { tipo: 'done' }),
  ];
}

describe('convertirTrayectoriaPersistida (fixture real de 44 pasos: clicks de foco y desvios sin selector)', () => {
  it('la fixture reproduce el caso real: 44 pasos, con los clicks culpables sin metodo ni selector', () => {
    const pasos = pasosGmailReal44();
    expect(pasos).toHaveLength(44);
    // Fieles a la fila persistida: un act resuelto por vision no trae playwrightArguments, asi que
    // queda sin metodo Y sin selector (fue lo que la regla del PR 258, que exigia metodo 'click',
    // nunca descarto en produccion).
    const sinSelector = pasos.filter(
      (p) =>
        (p.accion as { tipo: string; metodo: string | null }).tipo === 'act' &&
        (p.accion as { metodo: string | null }).metodo === null &&
        p.selector === null,
    );
    expect(sinSelector.map((p) => p.idx)).toEqual([7, 11, 15, 17, 19, 20]);
  });

  it('convierte la trayectoria COMPLETA descartando los clicks de foco y los desvios', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos: pasosGmailReal44() })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    // La receta queda en el rango esperado (6 a 10 pasos) con el flujo esencial y nada mas.
    expect(resultado.pasos.length).toBeGreaterThanOrEqual(6);
    expect(resultado.pasos.length).toBeLessThanOrEqual(10);
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'verificar',
      'click',
    ]);
    // Los tres parametros del objetivo viajan como marcadores.
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    expect(escritos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
    // El clic final de Enviar conserva su selector como estrategias.
    const enviar = resultado.pasos[resultado.pasos.length - 1];
    expect(enviar?.accion).toBe('click');
    expect(enviar?.estrategias[0]).toEqual({ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' });
    // Ningun paso de la receta referencia los desvios (pantalla completa, expandir el compose).
    const serializada = JSON.stringify(resultado.pasos).toLowerCase();
    expect(serializada).not.toContain('expand');
    expect(serializada).not.toContain('full screen');
    expect(serializada).not.toContain('pantalla');
  });

  it('Para, Asunto, Cuerpo y Enviar llevan al menos una estrategia que no es xpath', () => {
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos: pasosGmailReal44() })]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    const enviar = resultado.pasos[resultado.pasos.length - 1];
    expect(escritos).toHaveLength(3);
    for (const paso of [...escritos, enviar]) {
      expect(paso?.estrategias.some((e) => e.tipo !== 'xpath')).toBe(true);
    }
    // El cuerpo, cuyo selector es un xpath posicional puro (el caso que rompio la receta e62b0791),
    // deriva su rol de la descripcion del ACT y deja el xpath como ultimo recurso.
    const cuerpo = escritos[escritos.length - 1];
    expect(cuerpo?.estrategias[0]).toEqual({ tipo: 'rol', rol: 'textbox', nombre: 'cuerpo' });
    expect(cuerpo?.estrategias[cuerpo.estrategias.length - 1]?.tipo).toBe('xpath');
    expect(resultado.pasosSoloXpath).toEqual([]);
  });

  it('si el clic final pierde selector y descripcion, falla nombrando el paso exacto', () => {
    const pasos = pasosGmailReal44().map((p) =>
      p.idx === 35
        ? { ...p, selector: null, accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] } }
        : p,
    );
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
    if (resultado.guardable) return;
    // Ninguna escritura sigue a ese click, asi que no es un click de foco descartable: la conversion
    // se rechaza y el motivo dice el paso; la consola lo clasifica por la frase estable.
    expect(resultado.motivo).toContain('paso 35');
    expect(resultado.motivo).toContain('sin ninguna estrategia de localizacion');
  });
});

/**
 * La trayectoria que produjo la receta REAL de 21 pasos (79622fdb, 28 jul 2026): a diferencia de la
 * fixture de 44 pasos, aqui los desvios SI traen selector (el motor los resolvio por DOM, no por
 * vision), asi que la regla del click de foco sin localizacion no los descartaba y cada uno se
 * promovia como paso 'click', mas las escrituras repetidas de los campos redescubiertos. Con la
 * DESTILACION ESTRICTA, la receta conserva solo el ultimo camino continuo y exitoso: 8 pasos.
 */
function pasosGmailDesviosConSelector(): PasoTrayectoria[] {
  siguienteId = 0;
  const SEL_PARA = `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`;
  const SEL_ASUNTO = `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`;
  const SEL_CUERPO = `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Cuerpo del mensaje']`;
  return [
    paso(0, { tipo: 'goto', instruccion: 'abrir el correo' }, { url: `https://${DOMINIO}/` }),
    paso(1, { tipo: 'screenshot' }),
    paso(2, { tipo: 'act', instruccion: 'click en Redactar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Redactar']`,
    }),
    // Desvio: click redundante sobre el campo Para, que el fill siguiente vuelve a enfocar.
    paso(3, { tipo: 'act', instruccion: 'click the recipients field', metodo: 'click' }, {
      selector: SEL_PARA,
    }),
    paso(4, { tipo: 'act', instruccion: 'escribir el destinatario', metodo: 'fill', argumentos: ['martin@ejemplo.com'] }, {
      selector: SEL_PARA,
      valorCensurado: 'martin@ejemplo.com',
    }),
    paso(5, { tipo: 'act', instruccion: 'press Tab key to confirm the recipient', metodo: 'press', argumentos: ['Tab'] }, {
      selector: SEL_PARA,
    }),
    paso(6, { tipo: 'act', instruccion: 'click the subject field', metodo: 'click' }, {
      selector: SEL_ASUNTO,
    }),
    // Primer intento del asunto, anulado por el desvio de la cabecera: se reescribe en el paso 16.
    paso(7, { tipo: 'act', instruccion: 'escribir el asunto', metodo: 'fill', argumentos: ['Reporte semanal'] }, {
      selector: SEL_ASUNTO,
      valorCensurado: 'Reporte semanal',
    }),
    // Desvios sobre los CONTROLES DE LA CABECERA del compose, con selector propio cada uno.
    paso(8, { tipo: 'act', instruccion: 'click to expand the compose window', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//img[@aria-label='Expandir']`,
    }),
    paso(9, { tipo: 'act', instruccion: 'toggle full screen mode for the compose window', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//img[@aria-label='Pantalla completa']`,
    }),
    paso(10, { tipo: 'act', instruccion: 'click the textbox Cuerpo del mensaje', metodo: 'click' }, {
      selector: SEL_CUERPO,
    }),
    paso(11, { tipo: 'act', instruccion: 'click the message body area', metodo: 'click' }, {
      selector: SEL_CUERPO,
    }),
    // Primer intento del cuerpo, anulado: el compose se minimiza y hay que redescubrir los campos.
    paso(12, { tipo: 'act', instruccion: 'escribir el cuerpo', metodo: 'fill', argumentos: ['Adjunto el resumen de la semana'] }, {
      selector: SEL_CUERPO,
      valorCensurado: 'Adjunto el resumen de la semana',
    }),
    paso(13, { tipo: 'act', instruccion: 'click Minimizar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//img[@aria-label='Minimizar']`,
    }),
    paso(14, { tipo: 'act', instruccion: 'click to expand the minimized compose window', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//img[@aria-label='Expandir']`,
    }),
    // Redescubrimiento de campos: re-click y re-escritura del asunto y del cuerpo.
    paso(15, { tipo: 'act', instruccion: 'click the subject field', metodo: 'click' }, {
      selector: SEL_ASUNTO,
    }),
    paso(16, { tipo: 'act', instruccion: 'escribir el asunto', metodo: 'fill', argumentos: ['Reporte semanal'] }, {
      selector: SEL_ASUNTO,
      valorCensurado: 'Reporte semanal',
    }),
    paso(17, { tipo: 'act', instruccion: 'click the textbox Cuerpo del mensaje', metodo: 'click' }, {
      selector: SEL_CUERPO,
    }),
    paso(18, { tipo: 'act', instruccion: 'escribir el cuerpo', metodo: 'fill', argumentos: ['Adjunto el resumen de la semana'] }, {
      selector: SEL_CUERPO,
      valorCensurado: 'Adjunto el resumen de la semana',
    }),
    paso(19, { tipo: 'act', instruccion: 'click to exit full screen', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//img[@aria-label='Salir de pantalla completa']`,
    }),
    paso(20, { tipo: 'verificacion', instruccion: 'verificacion previa: los datos coinciden con lo pedido' }),
    paso(21, { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click' }, {
      selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`,
    }),
    paso(22, { tipo: 'extract', instruccion: 'confirmar que el mensaje se envio' }),
    paso(23, { tipo: 'done' }),
  ];
}

describe('convertirTrayectoriaPersistida (fixture de la receta de 21 pasos: desvios CON selector)', () => {
  it('la fixture reproduce la receta real: 21 pasos con efecto que la destilacion vieja conservaba', () => {
    const pasos = pasosGmailDesviosConSelector();
    // goto + verificacion + los 19 act con selector: los 21 pasos que la receta 79622fdb guardo.
    const conEfecto = pasos.filter((p) => {
      const tipo = (p.accion as { tipo: string }).tipo;
      return tipo === 'goto' || tipo === 'verificacion' || (tipo === 'act' && p.selector !== null);
    });
    expect(conEfecto).toHaveLength(21);
  });

  it('la destilacion estricta conserva solo el ultimo camino continuo: 8 pasos, sin desvios', () => {
    const resultado = convertirTrayectoriaPersistida([
      trayectoria({ pasos: pasosGmailDesviosConSelector() }),
    ]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    expect(resultado.pasos.length).toBeGreaterThanOrEqual(6);
    expect(resultado.pasos.length).toBeLessThanOrEqual(10);
    expect(resultado.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'verificar',
      'click',
    ]);
    // Cada dato queda escrito UNA sola vez (la re-escritura del camino final, no el intento previo).
    const escritos = resultado.pasos.filter((p) => p.accion === 'escribir');
    expect(escritos.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
    // Ningun rastro de los controles de la cabecera del compose.
    const serializada = JSON.stringify(resultado.pasos).toLowerCase();
    expect(serializada).not.toContain('expandir');
    expect(serializada).not.toContain('pantalla');
    expect(serializada).not.toContain('minimizar');
    // El clic final de Enviar sobrevive con su localizador.
    const enviar = resultado.pasos[resultado.pasos.length - 1];
    expect(enviar?.estrategias[0]).toEqual({ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' });
  });
});

describe('procesarJobDePromoverTrayectoria', () => {
  const PAYLOAD = { kind: 'promover_trayectoria', jobId: JOB_ORIGEN };

  function makeDeps(overrides: {
    trayectorias?: TrayectoriaConPasos[];
    yaGuardada?: string | null;
  } = {}) {
    const promovidas: NuevaRecetaWeb[] = [];
    const resultados: unknown[] = [];
    const deps: PromocionTrayectoriaDeps = {
      trayectorias: {
        listarPorJobConPasos: vi.fn(async () => overrides.trayectorias ?? [trayectoria()]),
      },
      recetas: {
        promover: vi.fn(async (input: NuevaRecetaWeb) => {
          promovidas.push(input);
          return { id: 'receta-1' } as unknown as RecetaWeb;
        }),
        buscarPorTrayectorias: vi.fn(async () => overrides.yaGuardada ?? null),
      },
      guardarResultado: vi.fn(async (_jobId: string, resultado: unknown) => {
        resultados.push(resultado);
      }),
      logger: makeLogger(),
    };
    return { deps, promovidas, resultados };
  }

  it('convierte, estampa el vinculo de auditoria y guarda el resultado del job', async () => {
    const { deps, promovidas, resultados } = makeDeps();
    await procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD));

    const promovida = promovidas[0];
    expect(promovida).toBeDefined();
    expect(promovida?.ownerId).toBe(OWNER);
    expect(promovida?.dominio).toBe(DOMINIO);
    expect(promovida?.creadaDesdeTrayectoria).toBe('tray-1');
    // FIX seleccion (28 jul 2026): la descripcion se guarda GENERALIZADA, con los valores de la
    // corrida origen sustituidos por sus nombres de parametro. Con los valores literales dentro,
    // el selector de tareas descartaba el match ante una peticion con datos distintos.
    expect(promovida?.descripcion).toBe(
      'envia un correo a <destinatario> con asunto "<asunto>" y cuerpo "<cuerpo>"',
    );
    expect(promovida?.descripcion).not.toContain('martin@ejemplo.com');
    expect(promovida?.descripcion).not.toContain('Reporte semanal');
    expect(promovida?.descripcion).not.toContain('Adjunto el resumen');
    expect(promovida?.pasos).toHaveLength(9);
    expect(resultados[0]).toMatchObject({ estado: 'ok', via: 'trayectoria', recetaId: 'receta-1' });
  });

  it('es idempotente: con una receta ya creada desde la trayectoria, termina ok sin promover', async () => {
    const { deps, promovidas, resultados } = makeDeps({ yaGuardada: 'receta-previa' });
    await procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD));

    expect(promovidas).toHaveLength(0);
    expect(resultados[0]).toMatchObject({ estado: 'ok', recetaId: 'receta-previa', yaGuardada: true });
  });

  it('falla permanente con mensaje claro si el job no tiene trayectorias', async () => {
    const { deps } = makeDeps({ trayectorias: [] });
    await expect(procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD))).rejects.toThrow(
      /no tiene registro/,
    );
  });

  it('falla permanente con el prefijo estable y el motivo especifico si no se puede convertir', async () => {
    const { deps } = makeDeps({ trayectorias: [trayectoria({ estado: 'fallida' })] });
    const error = await procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) return;
    // El prefijo estable viaja en el NAME del error: describeError (execution.ts) arma el
    // last_error como `${name}: ${message}`, asi que el job persistido EMPIEZA con el prefijo que
    // la consola detecta (startsWith). Con el prefijo dentro del message no alcanzaba: el name
    // PermanentExecutionError quedaba delante y la UI caia al mensaje generico de reintento.
    expect(`${error.name}: ${error.message}`).toMatch(
      /^PROMOCION_NO_REPETIBLE: la ultima trayectoria termino fallida/,
    );
  });

  it('reporta en el resultado del job los pasos que quedaron solo con xpath', async () => {
    const pasos = pasosGmail().map((p) =>
      p.idx === 3
        ? { ...p, accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] } }
        : p,
    );
    const { deps, resultados } = makeDeps({ trayectorias: [trayectoria({ pasos })] });
    await procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD));
    expect(resultados[0]).toMatchObject({ estado: 'ok', pasosSoloXpath: ['paso 1 (click)'] });
  });

  it('el caso real de produccion (press Tab) convierte y guarda en vez de fallar', async () => {
    const { deps, promovidas } = makeDeps({
      trayectorias: [trayectoria({ pasos: pasosGmailConFillFormVision() })],
    });
    await procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD));
    expect(promovidas).toHaveLength(1);
    expect(promovidas[0]?.pasos.some((p) => p.accion === 'teclas' && p.teclas === 'Tab')).toBe(true);
  });

  it('rechaza un payload invalido sin tocar la base', async () => {
    const { deps } = makeDeps();
    await expect(
      procesarJobDePromoverTrayectoria(deps, makeJob({ kind: 'promover_trayectoria' })),
    ).rejects.toThrow(/payload/);
    expect(deps.trayectorias.listarPorJobConPasos).not.toHaveBeenCalled();
  });
});
