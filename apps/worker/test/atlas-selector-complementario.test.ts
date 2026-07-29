import { describe, it, expect } from 'vitest';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import {
  entradasDeCorridaLibre,
  estrategiasDelSelectorParaElAtlas,
  pasosConEstrategiasPercibidas,
  valoresTecleadosDeLaCorrida,
} from '../src/atlas-sitios.js';
import {
  crearControlDePercepcion,
  MAX_LINEAS_POR_TURNO,
  PREFIJO_PERCEPCION,
  type EventoDePasoPercibido,
  type ObjetivoDeLectura,
  type PercepcionDePagina,
} from '../src/percepcion.js';
import { promoverTrayectoria } from '../src/receta-web.js';
import { construirOpcionesDeEjecucion } from '../src/stagehand.js';
import { extraerPasosCensurados, type AccionCrudaDeMotor, type PasoCensurado } from '../src/trayectoria.js';
import type { MensajeDeModelo } from '../src/costo-modelo.js';

/**
 * EL SELECTOR COMO FUENTE COMPLEMENTARIA DEL ATLAS.
 *
 * EL HUECO QUE CIERRA: la lectura de percepcion corre DESPUES de la accion, y las ACCIONES FINALES
 * destruyen su propio contexto. Al enviar, Gmail desmonta el compose: para cuando la percepcion
 * mira, ni el xpath del boton Enviar resuelve ni el foco apunta a el, asi que ninguna lectura
 * posterior puede alcanzarlo. Es estructural, no un fallo de la lectura.
 *
 * LA FUENTE QUE SI LO ALCANZA: los predicados de atributo embebidos en el propio selector que el
 * motor resolvio. Extraerlos es parsear un string, no tocar el DOM, asi que funciona con el elemento
 * ya desaparecido, y el valor es LITERAL del sitio.
 *
 * Todo con fakes: cero navegador, cero modelo. Se corre la trayectoria REAL de 44 pasos (la misma
 * del envio exitoso del 28 jul 2026 que fija promover-trayectoria.test.ts) por el bucle del motor.
 */

const DOMINIO = 'mail.google.com';

/** Los valores que la corrida tecleo, contra los que corre la paranoia del invariante 4. */
const DESTINATARIO = 'martin@ejemplo.com';
const ASUNTO = 'Reporte semanal';
const CUERPO = 'Adjunto el resumen de la semana';

/** Un paso de la trayectoria real, en la forma en la que el motor lo emite. */
interface PasoDeLaCorrida {
  tipo: string;
  instruccion?: string;
  metodo?: string;
  argumentos?: string[];
  selector?: string;
}

/**
 * LA TRAYECTORIA REAL, paso a paso, tal como el motor la ejecuto: 43 tools mas la VERIFICACION
 * previa (paso 34), que es sintetica y la intercala el handler, no el motor. Los 44 pasos y sus idx
 * coinciden uno a uno con la fixture persistida de promover-trayectoria.test.ts.
 *
 * Los acts SIN metodo ni selector son los que el motor resolvio POR VISION: los clicks de foco
 * (7, 11, 19, 20) y los desvios de la corrida (15, 17).
 */
const CORRIDA: PasoDeLaCorrida[] = [
  { tipo: 'goto', instruccion: 'abrir el correo' },
  { tipo: 'screenshot' },
  { tipo: 'ariaTree' },
  { tipo: 'think', instruccion: 'planear los pasos del envio' },
  {
    tipo: 'act',
    instruccion: 'click en Redactar',
    metodo: 'click',
    selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Redactar']`,
  },
  { tipo: 'screenshot' },
  { tipo: 'ariaTree' },
  { tipo: 'act', instruccion: 'click the recipients field' },
  {
    tipo: 'act',
    instruccion: 'escribir el destinatario',
    metodo: 'fill',
    argumentos: [DESTINATARIO],
    selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
  },
  {
    tipo: 'act',
    instruccion: 'press Tab key to confirm the recipient',
    metodo: 'press',
    argumentos: ['Tab'],
    selector: `xpath=/html[1]/body[1]/div[7]//input[@aria-label='Para']`,
  },
  { tipo: 'screenshot' },
  { tipo: 'act', instruccion: 'click the subject field' },
  {
    tipo: 'act',
    instruccion: 'escribir el asunto',
    metodo: 'fill',
    argumentos: [ASUNTO],
    selector: `xpath=/html[1]/body[1]/div[7]//input[@name='subjectbox']`,
  },
  { tipo: 'screenshot' },
  { tipo: 'extract', instruccion: 'leer los campos del formulario' },
  { tipo: 'act', instruccion: 'click to expand the compose window' },
  { tipo: 'screenshot' },
  { tipo: 'act', instruccion: 'toggle full screen mode for the compose window' },
  { tipo: 'screenshot' },
  { tipo: 'act', instruccion: 'click the textbox Cuerpo del mensaje' },
  { tipo: 'act', instruccion: 'click the message body area' },
  {
    tipo: 'act',
    instruccion: 'escribir el cuerpo',
    metodo: 'fill',
    argumentos: [CUERPO],
    // Xpath POSICIONAL PURO: sin un solo predicado de atributo, no hay nada literal que aprender.
    selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[2]/div[1]/div[2]',
  },
  { tipo: 'extract' },
  { tipo: 'scroll' },
  { tipo: 'screenshot' },
  { tipo: 'ariaTree' },
  { tipo: 'think' },
  { tipo: 'screenshot' },
  { tipo: 'extract', instruccion: 'confirmar que los campos quedaron llenos' },
  { tipo: 'think' },
  { tipo: 'screenshot' },
  { tipo: 'ariaTree' },
  { tipo: 'scroll' },
  { tipo: 'screenshot' },
  {
    tipo: 'act',
    instruccion: 'click en Enviar',
    metodo: 'click',
    selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`,
  },
  { tipo: 'screenshot' },
  { tipo: 'extract', instruccion: 'confirmar que el mensaje se envio' },
  { tipo: 'screenshot' },
  { tipo: 'extract' },
  { tipo: 'think' },
  { tipo: 'screenshot' },
  { tipo: 'extract' },
  { tipo: 'done' },
];

/** Donde el handler intercala la verificacion previa (queda como paso 34 de los 44). */
const POSICION_DE_LA_VERIFICACION = 34;

/** Idx (sobre los 44 pasos) de los CINCO controles utiles del envio. */
const IDX_REDACTAR = 4;
const IDX_PARA = 8;
const IDX_ASUNTO = 12;
const IDX_CUERPO = 21;
const IDX_ENVIAR = 35;

/**
 * De un idx de los 44 pasos al indice de la ACCION del motor: lo que se emite para el atlas va una
 * entrada por accion, y la verificacion previa no es una accion del motor (la intercala el handler),
 * asi que a partir de ella las dos numeraciones se corren en uno.
 */
function accionDelIdx(idx: number): number {
  return idx < POSICION_DE_LA_VERIFICACION ? idx : idx - 1;
}

function eventoDelPaso(paso: PasoDeLaCorrida): EventoDePasoPercibido {
  return {
    actionName: paso.tipo,
    actionArgs: { action: paso.instruccion ?? '' },
    toolOutput: {
      result:
        paso.metodo === undefined
          ? {}
          : {
              playwrightArguments: {
                selector: paso.selector,
                method: paso.metodo,
                arguments: paso.argumentos ?? [],
              },
            },
    },
  };
}

function accionCrudaDelPaso(paso: PasoDeLaCorrida): AccionCrudaDeMotor {
  return {
    type: paso.tipo,
    action: paso.instruccion ?? null,
    pageUrl: `https://${DOMINIO}/mail/u/0/`,
    ...(paso.metodo === undefined
      ? {}
      : {
          playwrightArguments: {
            selector: paso.selector,
            method: paso.metodo,
            arguments: paso.argumentos ?? [],
          },
        }),
  };
}

const EVENTOS = CORRIDA.map(eventoDelPaso);

/**
 * LO QUE LA PERCEPCION LEE DEL DOM en esta corrida, por control. Los nombres son deliberadamente
 * DISTINTOS de los literales del selector ("Redactar mensaje" contra el `aria-label='Redactar'` del
 * xpath): asi, mirando una entrada del atlas se sabe cual de las dos fuentes la produjo.
 */
const LEIDO_REDACTAR: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Redactar mensaje',
};
const LEIDO_PARA: EstrategiaLocalizacion = { tipo: 'rol', rol: 'textbox', nombre: 'Para' };
const LEIDO_ASUNTO: EstrategiaLocalizacion = { tipo: 'rol', rol: 'textbox', nombre: 'Asunto' };
const LEIDO_CUERPO: EstrategiaLocalizacion = {
  tipo: 'rol',
  rol: 'textbox',
  nombre: 'Cuerpo del mensaje',
};

function bandeja(estrategias?: EstrategiaLocalizacion[]): PercepcionDePagina {
  return {
    url: `https://${DOMINIO}/mail/u/0/#inbox`,
    titulo: 'Recibidos',
    nodos: 3200,
    foco: 'input text q Buscar correo',
    campos: [{ contexto: 'input text q Buscar correo', valor: '' }],
    ...(estrategias === undefined ? {} : { estrategias }),
  };
}

/**
 * EL DOM DE GMAIL tal como responde a cada lectura de esta corrida:
 *  - los campos donde aterrizo texto se leen bien (Para, Asunto, Cuerpo);
 *  - el boton Redactar sigue vivo despues de abrirse el compose y tambien se lee;
 *  - el boton ENVIAR ya NO EXISTE cuando corre su lectura: el compose se desmonto con el envio, el
 *    xpath no resuelve y (por diseno de la lectura) no hay respaldo al foco. Devuelve nada.
 *  - los clicks de foco y los desvios se resolvieron por vision: se lee el foco y no deja nada util.
 */
function domDeLaCorrida(opciones: { cuerpoLegible: boolean }) {
  return (objetivo?: ObjetivoDeLectura | undefined): PercepcionDePagina => {
    if (objetivo === undefined) return bandeja();
    if (objetivo.tipo === 'xpath') {
      return objetivo.xpath.includes('Redactar') ? bandeja([LEIDO_REDACTAR]) : bandeja();
    }
    if (objetivo.tipo === 'campo') {
      if (objetivo.texto === DESTINATARIO) return bandeja([LEIDO_PARA]);
      if (objetivo.texto === ASUNTO) return bandeja([LEIDO_ASUNTO]);
      if (objetivo.texto === CUERPO && opciones.cuerpoLegible) return bandeja([LEIDO_CUERPO]);
    }
    return bandeja();
  };
}

/** Lo que la PERCEPCION SOLA entrega por accion (percepcion.ts, sin tocar). */
async function percepcionSola(
  opciones: { cuerpoLegible: boolean } = { cuerpoLegible: true },
): Promise<EstrategiaLocalizacion[][]> {
  const dom = domDeLaCorrida(opciones);
  const control = crearControlDePercepcion({ percibir: async (objetivo) => dom(objetivo) });
  await control.inicializar();
  const porAccion: EstrategiaLocalizacion[][] = [];
  for (const evento of EVENTOS) porAccion.push(await control.alTerminarPaso(evento));
  return porAccion;
}

/** Lo que llega al atlas por el canal REAL del motor libre (percepcion mas complemento). */
async function corridaDelMotor(
  opciones: { cuerpoLegible: boolean } = { cuerpoLegible: true },
): Promise<{
  porAccion: EstrategiaLocalizacion[][];
  mensajes: string[];
  lecturas: number;
}> {
  const dom = domDeLaCorrida(opciones);
  let lecturas = 0;
  const porAccion: EstrategiaLocalizacion[][] = [];
  const control = crearControlDePercepcion({
    percibir: async (objetivo) => {
      lecturas += 1;
      return dom(objetivo);
    },
  });
  await control.inicializar();
  const ejecucion = construirOpcionesDeEjecucion({
    objetivo: 'enviar un correo',
    maxPasos: 60,
    toolTimeoutMs: 1000,
    historialPasos: 8,
    percepcion: control,
    registrarEstrategias: (lista) => porAccion.push(...lista),
  });
  const mensajes: string[] = [];
  const base: MensajeDeModelo[] = [{ role: 'user', content: 'objetivo' }];
  for (const paso of CORRIDA) {
    const evento = eventoDelPaso(paso);
    await ejecucion.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: evento.actionName,
      actionArgs: evento.actionArgs,
      reasoning: '',
      toolOutput: { ok: true, result: evento.toolOutput.result },
    } as never);
    const preparado = await ejecucion.callbacks?.prepareStep?.({ messages: base } as never);
    for (const mensaje of (preparado as { messages: MensajeDeModelo[] }).messages) {
      mensajes.push(String(mensaje.content));
    }
  }
  return { porAccion, mensajes, lecturas };
}

/** El paso sintetico de la verificacion previa, tal como lo intercala el handler. */
const VERIFICACION: PasoCensurado = {
  idx: 0,
  accion: {
    tipo: 'verificacion',
    instruccion: 'verificacion previa: los datos coinciden con lo pedido',
    metodo: null,
    argumentos: [],
  },
  selector: null,
  valorCensurado: null,
  url: null,
  exito: true,
  estrategias: [],
};

/** Los 44 pasos de la traza, con la verificacion intercalada y los idx renumerados. */
function pasosDeLaTraza(porAccion: EstrategiaLocalizacion[][]): PasoCensurado[] {
  const delMotor = extraerPasosCensurados(CORRIDA.map(accionCrudaDelPaso), [], porAccion);
  return [
    ...delMotor.slice(0, POSICION_DE_LA_VERIFICACION),
    VERIFICACION,
    ...delMotor.slice(POSICION_DE_LA_VERIFICACION),
  ].map((paso, idx) => ({ ...paso, idx, dominio: DOMINIO }));
}

/** Las clases de elemento que la corrida deja en el atlas, por el camino real del handler. */
function clasesEnElAtlas(pasos: PasoCensurado[]): string[] {
  return entradasDeCorridaLibre({
    dominio: DOMINIO,
    pasos: pasosConEstrategiasPercibidas(pasos),
    valores: valoresTecleadosDeLaCorrida({}, pasos),
  }).map((entrada) => entrada.claseDeElemento);
}

describe('estrategiasDelSelectorParaElAtlas', () => {
  it('extrae el aria-label literal de un selector, sin tocar el DOM', () => {
    expect(
      estrategiasDelSelectorParaElAtlas(`xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`),
    ).toEqual([{ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' }]);
  });

  it('un xpath POSICIONAL PURO no deja nada: no hay literal que aprender', () => {
    expect(
      estrategiasDelSelectorParaElAtlas('xpath=/html[1]/body[1]/div[7]/div[3]/div[2]/div[1]/div[2]'),
    ).toEqual([]);
    expect(estrategiasDelSelectorParaElAtlas(null)).toEqual([]);
    expect(estrategiasDelSelectorParaElAtlas('boton de enviar')).toEqual([]);
  });

  it('aplica el filtro del atlas: id y name quedan fuera aunque el contrato de recetas los admita', () => {
    expect(
      estrategiasDelSelectorParaElAtlas(`xpath=/html[1]//input[@name='subjectbox']`),
    ).toEqual([]);
    expect(estrategiasDelSelectorParaElAtlas(`xpath=/html[1]//div[@id=':u3']`)).toEqual([]);
    // data-* si entra: lo escribio quien programo el sitio.
    expect(estrategiasDelSelectorParaElAtlas(`xpath=/html[1]//button[@data-testid='enviar']`)).toEqual(
      [{ tipo: 'atributo', atributo: 'data-testid', valor: 'enviar' }],
    );
  });

  it('pasa el MISMO saneo que la percepcion: un literal sensible no llega a una tabla global', () => {
    // Contexto sensible por el nombre del campo, y numero con pinta de tarjeta: los dos se caen.
    expect(estrategiasDelSelectorParaElAtlas(`xpath=/html[1]//input[@aria-label='Contrasena']`)).toEqual(
      [],
    );
    expect(
      estrategiasDelSelectorParaElAtlas(`xpath=/html[1]//div[@aria-label='Tarjeta 4111 1111 1111 1111']`),
    ).toEqual([]);
  });

  it('el xpath nunca sale de aqui: es la ruta del DOM de UNA sesion', () => {
    const salida = estrategiasDelSelectorParaElAtlas(
      `xpath=/html[1]/body[1]//div[@aria-label='Enviar']`,
    );
    expect(salida.every((estrategia) => estrategia.tipo !== 'xpath')).toBe(true);
  });
});

describe('cobertura del atlas sobre la trayectoria real de 44 pasos', () => {
  it('la corrida reproduce el caso real: 44 pasos y los cinco controles en su sitio', async () => {
    const pasos = pasosDeLaTraza(await percepcionSola());
    expect(pasos).toHaveLength(44);
    expect(pasos[IDX_REDACTAR]?.accion.instruccion).toBe('click en Redactar');
    expect(pasos[IDX_PARA]?.accion.metodo).toBe('fill');
    expect(pasos[IDX_ASUNTO]?.accion.metodo).toBe('fill');
    expect(pasos[IDX_CUERPO]?.accion.metodo).toBe('fill');
    expect(pasos[IDX_ENVIAR]?.accion.instruccion).toBe('click en Enviar');
    expect(pasos[POSICION_DE_LA_VERIFICACION]?.accion.tipo).toBe('verificacion');
  });

  it('SOLO CON PERCEPCION la cobertura es de 4 de 5: el boton Enviar queda fuera', async () => {
    const clases = clasesEnElAtlas(pasosDeLaTraza(await percepcionSola()));
    expect(clases).toContain('click|atributo:aria-label|redactar mensaje');
    expect(clases).toContain('escribir|rol:textbox|para');
    expect(clases).toContain('escribir|rol:textbox|asunto');
    expect(clases).toContain('escribir|rol:textbox|cuerpo del mensaje');
    // El compose ya no existe cuando corre la lectura: ninguna entrada del boton final.
    expect(clases.some((clase) => clase.includes('enviar'))).toBe(false);
  });

  it('CON EL COMPLEMENTO la cobertura es de 5 de 5 y Enviar entra con su aria-label LITERAL', async () => {
    const { porAccion } = await corridaDelMotor();
    const pasos = pasosDeLaTraza(porAccion);
    expect(clasesEnElAtlas(pasos)).toEqual(
      expect.arrayContaining([
        'click|atributo:aria-label|redactar mensaje',
        'escribir|rol:textbox|para',
        'escribir|rol:textbox|asunto',
        'escribir|rol:textbox|cuerpo del mensaje',
        'click|atributo:aria-label|enviar',
      ]),
    );
    // Y la entrada del boton lleva el valor tal cual lo escribio el sitio en su selector.
    const enviar = entradasDeCorridaLibre({
      dominio: DOMINIO,
      pasos: pasosConEstrategiasPercibidas(pasos),
      valores: valoresTecleadosDeLaCorrida({}, pasos),
    }).find((entrada) => entrada.claseDeElemento === 'click|atributo:aria-label|enviar');
    expect(enviar?.estrategias).toEqual([{ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' }]);
    expect(enviar?.dominio).toBe(DOMINIO);
  });

  it('la PERCEPCION es primaria: donde ella leyo algo, el selector no entra ni se mezcla', async () => {
    const sola = await percepcionSola();
    const { porAccion } = await corridaDelMotor();
    expect(porAccion).toHaveLength(sola.length);
    for (const [indice, leidas] of sola.entries()) {
      if (leidas.length === 0) continue;
      expect(porAccion[indice]).toEqual(leidas);
    }
    // El caso que lo demuestra: el selector de Redactar dice aria-label 'Redactar' y el DOM dice
    // 'Redactar mensaje'. Gana el DOM, y el literal del selector no aparece por ningun lado.
    expect(porAccion[accionDelIdx(IDX_REDACTAR)]).toEqual([LEIDO_REDACTAR]);
    const clases = clasesEnElAtlas(pasosDeLaTraza(porAccion));
    expect(clases).not.toContain('click|atributo:aria-label|redactar');
  });

  it('el complemento entra SOLO donde la percepcion no dio nada', async () => {
    const sola = await percepcionSola();
    const { porAccion } = await corridaDelMotor();
    const cambiados = porAccion.flatMap((lista, indice) =>
      JSON.stringify(lista) === JSON.stringify(sola[indice]) ? [] : [indice],
    );
    // Redactar (4), Para (8) y Enviar (35) son los tres selectores con predicado de atributo; los dos
    // primeros ya los cubria la percepcion, asi que lo unico que cambia es el Tab sobre Para (9),
    // que el atlas no clasifica, y el boton Enviar, que es el hueco que este cambio cierra.
    expect(cambiados).toEqual([9, accionDelIdx(IDX_ENVIAR)]);
    expect(porAccion[accionDelIdx(IDX_ENVIAR)]).toEqual([
      { tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' },
    ]);
  });

  it('un selector POSICIONAL PURO no produce entrada aunque la percepcion falle', async () => {
    const { porAccion } = await corridaDelMotor({ cuerpoLegible: false });
    // El cuerpo se escribio con un xpath sin predicados: sin lectura no queda nada que aprender.
    expect(porAccion[accionDelIdx(IDX_CUERPO)]).toEqual([]);
    const clases = clasesEnElAtlas(pasosDeLaTraza(porAccion));
    expect(clases.some((clase) => clase.includes('cuerpo'))).toBe(false);
    // Los otros cuatro controles siguen cubiertos: la degradacion es de ese paso, no de la corrida.
    expect(clases).toEqual(
      expect.arrayContaining([
        'click|atributo:aria-label|redactar mensaje',
        'escribir|rol:textbox|para',
        'escribir|rol:textbox|asunto',
        'click|atributo:aria-label|enviar',
      ]),
    );
  });
});

describe('no regresion del complemento por selector', () => {
  it('la promocion automatica a recetas sigue sin dispararse', async () => {
    const { porAccion } = await corridaDelMotor();
    const pasos = pasosDeLaTraza(porAccion);
    // Lo que la promocion lee es `estrategias`, y ahi no llega nada nuevo: el complemento viaja por
    // el campo aparte que introdujo el PR 267.
    expect(pasos.every((paso) => paso.estrategias.length === 0)).toBe(true);
    expect(pasos.some((paso) => (paso.estrategiasPercibidas ?? []).length > 0)).toBe(true);
    const promocion = promoverTrayectoria({
      pasos,
      dominio: DOMINIO,
      objetivo: 'enviar un correo',
      estado: 'exitosa',
      exigeVerificacion: true,
    });
    expect(promocion.promovida).toBe(false);
    // Y el agregador tampoco ve nada si nadie pasa los pasos por el unico puente que existe.
    expect(
      entradasDeCorridaLibre({ dominio: DOMINIO, pasos, valores: [] }),
    ).toEqual([]);
  });

  it('el texto de percepcion que llega al modelo es IDENTICO con y sin complemento', async () => {
    // Con el cuerpo ilegible cambia lo que la lectura devuelve para el atlas, no lo que ve el modelo.
    const con = await corridaDelMotor();
    const sin = await corridaDelMotor({ cuerpoLegible: false });
    expect(con.mensajes).toEqual(sin.mensajes);
    expect(con.mensajes.some((texto) => texto.includes(PREFIJO_PERCEPCION))).toBe(true);
    // Y ningun literal que solo vive en el atlas se colo por la cola de percepcion.
    expect(con.mensajes.join('\n')).not.toContain('Redactar mensaje');
    for (const mensaje of con.mensajes) {
      expect(mensaje.split('\n').length).toBeLessThanOrEqual(MAX_LINEAS_POR_TURNO);
    }
  });

  it('las conexiones CDP no aumentan: una por huella inicial y una por paso que toca la pagina', async () => {
    const { lecturas } = await corridaDelMotor();
    const sinEfecto = CORRIDA.filter((paso) =>
      ['screenshot', 'extract', 'ariaTree', 'done'].includes(paso.tipo),
    ).length;
    expect(lecturas).toBe(1 + CORRIDA.length - sinEfecto);
  });

  it('la paranoia de valores se aplica igual a lo que sale del selector', async () => {
    const { porAccion } = await corridaDelMotor();
    const pasos = pasosDeLaTraza(porAccion);
    // Si el usuario hubiera tecleado un texto que CONTIENE el literal del boton, la estrategia se
    // cae entera y no queda entrada, exactamente igual que si la hubiera leido la percepcion.
    const clases = entradasDeCorridaLibre({
      dominio: DOMINIO,
      pasos: pasosConEstrategiasPercibidas(pasos),
      valores: [...valoresTecleadosDeLaCorrida({}, pasos), 'Enviar el reporte'],
    }).map((entrada) => entrada.claseDeElemento);
    expect(clases.some((clase) => clase.includes('enviar'))).toBe(false);
    expect(clases).toContain('escribir|rol:textbox|para');
  });
});
