import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { PasoTrayectoria, TrayectoriaConPasos } from '@ledesma-platform/backend/trayectorias';
import type { NuevaRecetaWeb, RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import {
  convertirTrayectoriaPersistida,
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

  it('rechaza un paso con efecto sin selector del que derivar estrategias', () => {
    const pasos = pasosGmail().map((p) => (p.idx === 15 ? { ...p, selector: null } : p));
    const resultado = convertirTrayectoriaPersistida([trayectoria({ pasos })]);
    expect(resultado.guardable).toBe(false);
  });
});

/**
 * La trayectoria REAL del primer envio exitoso en produccion (jul 2026): identica a la fixture Gmail
 * salvo que el paso 4 es un FILLFORMVISION (llenado por vision de Stagehand: sin selector, sin metodo
 * y sin argumentos persistidos), seguido de los act que rellenaron Para, Asunto y Cuerpo CON selector.
 * Antes del fix, este paso abortaba la conversion entera con "paso fillFormVision sin ninguna
 * estrategia de localizacion".
 */
function pasosGmailConFillFormVision(): PasoTrayectoria[] {
  return pasosGmail().map((p) =>
    p.idx === 4
      ? {
          ...p,
          accion: {
            tipo: 'fillFormVision',
            instruccion: 'llenar los campos del correo',
            metodo: null,
            argumentos: [],
          },
          selector: null,
        }
      : p,
  );
}

describe('convertirTrayectoriaPersistida (fixture real con fillFormVision en el paso 4)', () => {
  it('produce receta valida con los tres parametros: los acts posteriores cubren los datos', () => {
    const resultado = convertirTrayectoriaPersistida([
      trayectoria({ pasos: pasosGmailConFillFormVision() }),
    ]);
    expect(resultado.guardable).toBe(true);
    if (!resultado.guardable) return;
    // La receta queda EXACTAMENTE como la de la fixture sin fillFormVision: la cabecera del llenado
    // por vision se omite porque Para, Asunto y Cuerpo quedaron cubiertos con selector.
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
    expect(promovida?.descripcion).toBe(OBJETIVO);
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
    await expect(procesarJobDePromoverTrayectoria(deps, makeJob(PAYLOAD))).rejects.toThrow(
      /^PROMOCION_NO_REPETIBLE: la ultima trayectoria termino fallida/,
    );
  });

  it('rechaza un payload invalido sin tocar la base', async () => {
    const { deps } = makeDeps();
    await expect(
      procesarJobDePromoverTrayectoria(deps, makeJob({ kind: 'promover_trayectoria' })),
    ).rejects.toThrow(/payload/);
    expect(deps.trayectorias.listarPorJobConPasos).not.toHaveBeenCalled();
  });
});
