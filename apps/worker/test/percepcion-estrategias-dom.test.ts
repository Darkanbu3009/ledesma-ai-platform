import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  EXPRESION_LEER_CAMPOS,
  EXPRESION_PERCEPCION,
  expresionPercepcionConEstrategias,
} from '../src/browserbase.js';
import {
  construirExpresionPercepcion,
  parsearPercepcion,
  type ObjetivoDeLectura,
  type PercepcionDePagina,
} from '../src/percepcion.js';

/**
 * LA LECTURA FUSIONADA, CORRIENDO DE VERDAD sobre un DOM (ATLAS DESDE LA PERCEPCION). La misma
 * evaluacion que la percepcion ya hacia despues de cada paso devuelve ahora, ademas, las estrategias
 * de localizacion del elemento que el paso toco.
 *
 * Lo que estos tests fijan y no debe poder cambiar en silencio:
 *  - la parte de la percepcion que ve el modelo (url, titulo, nodos, foco, campos) es IDENTICA con y
 *    sin la lectura fusionada, sobre el mismo DOM;
 *  - el elemento leido es el correcto en los tres caminos (campo donde aterrizo, selector resuelto,
 *    elemento enfocado), y sale del DOM real, jamas de texto del modelo;
 *  - un fallo dentro del bloque fusionado degrada a la percepcion de hoy.
 */

/** Compose de Gmail con la barra de busqueda al lado: el fixture del caso real del 27 jul 2026. */
const COMPOSE = `
  <input type="text" name="q" aria-label="Buscar correo" value="">
  <div role="button" aria-label="Redactar">Redactar</div>
  <div role="listbox" aria-label="Area de destinatarios">
    <input type="text" name="to" aria-label="Destinatarios en Para" value="">
  </div>
  <input type="text" name="subjectbox" aria-label="Asunto" value="">
  <div role="textbox" aria-label="Cuerpo del mensaje" contenteditable="true"></div>
  <div role="button" aria-label="Enviar ‪(Ctrl+Intro)‬">Enviar</div>
`;

function correr(
  cuerpoHtml: string,
  expresion: string,
  opciones?: { enfocar?: string; valores?: Record<string, string> },
): PercepcionDePagina {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>Recibidos</title></head><body>${cuerpoHtml}</body></html>`,
    { url: 'https://mail.google.com/mail/u/0/', runScripts: 'outside-only' },
  );
  try {
    for (const [selector, valor] of Object.entries(opciones?.valores ?? {})) {
      const el = dom.window.document.querySelector(selector);
      if (el === null) throw new Error(`no existe ${selector} en el fixture`);
      if ('value' in el) (el as unknown as { value: string }).value = valor;
      else el.textContent = valor;
    }
    if (opciones?.enfocar !== undefined) {
      const el = dom.window.document.querySelector(opciones.enfocar);
      if (el === null) throw new Error(`no existe ${opciones.enfocar} en el fixture`);
      (el as unknown as { focus(): void }).focus();
    }
    const crudo = dom.window.eval(expresion);
    if (typeof crudo !== 'string') throw new Error('la expresion no devolvio texto');
    const percepcion = parsearPercepcion(crudo);
    if (percepcion === null) throw new Error('la percepcion no parseo');
    return percepcion;
  } finally {
    dom.window.close();
  }
}

/** La percepcion sin el dato del atlas: es exactamente lo que el modelo llega a ver. */
function sinEstrategias(percepcion: PercepcionDePagina): Omit<PercepcionDePagina, 'estrategias'> {
  return {
    url: percepcion.url,
    titulo: percepcion.titulo,
    nodos: percepcion.nodos,
    foco: percepcion.foco,
    campos: percepcion.campos,
  };
}

describe('la lectura fusionada NO cambia la percepcion de hoy', () => {
  it('sin objetivo de lectura, la expresion es byte a byte la de siempre', () => {
    expect(construirExpresionPercepcion(EXPRESION_LEER_CAMPOS)).toBe(EXPRESION_PERCEPCION);
  });

  const casos: Array<{ nombre: string; objetivo: ObjetivoDeLectura; enfocar?: string }> = [
    { nombre: 'foco', objetivo: { tipo: 'foco' }, enfocar: 'input[name="to"]' },
    { nombre: 'campo', objetivo: { tipo: 'campo', texto: 'martin@ejemplo.com' } },
    { nombre: 'xpath', objetivo: { tipo: 'xpath', xpath: '/html[1]/body[1]/div[1]' } },
  ];
  for (const caso of casos) {
    it(`url, titulo, nodos, foco y campos son identicos con lectura de tipo ${caso.nombre}`, () => {
      const opciones = {
        ...(caso.enfocar !== undefined ? { enfocar: caso.enfocar } : {}),
        valores: { 'input[name="to"]': 'martin@ejemplo.com' },
      };
      const base = correr(COMPOSE, EXPRESION_PERCEPCION, opciones);
      const fusionada = correr(COMPOSE, expresionPercepcionConEstrategias(caso.objetivo), opciones);
      expect(sinEstrategias(fusionada)).toEqual(sinEstrategias(base));
      expect(base.estrategias).toBeUndefined();
    });
  }

  it('un fallo dentro del bloque fusionado degrada a la percepcion de hoy', () => {
    const rota = construirExpresionPercepcion(EXPRESION_LEER_CAMPOS, {
      ayudantes: `throw new Error('los ayudantes de DOM fallaron');`,
      objetivo: { tipo: 'foco' },
    });
    const base = correr(COMPOSE, EXPRESION_PERCEPCION, { enfocar: 'input[name="to"]' });
    const degradada = correr(COMPOSE, rota, { enfocar: 'input[name="to"]' });
    expect(degradada.estrategias).toBeUndefined();
    expect(sinEstrategias(degradada)).toEqual(sinEstrategias(base));
  });
});

describe('que elemento lee cada objetivo', () => {
  it('ESCRITURA: el campo donde aterrizo el texto, con su rol y su nombre accesible reales', () => {
    const percepcion = correr(
      COMPOSE,
      expresionPercepcionConEstrategias({ tipo: 'campo', texto: 'Reporte semanal' }),
      { valores: { 'input[name="subjectbox"]': 'Reporte semanal' } },
    );
    expect(percepcion.estrategias).toContainEqual({
      tipo: 'rol',
      rol: 'textbox',
      nombre: 'Asunto',
    });
    expect(percepcion.estrategias).toContainEqual({
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Asunto',
    });
  });

  it('ESCRITURA que aterrizo en el campo EQUIVOCADO: lee el campo real, no el declarado', () => {
    // El caso de produccion: el texto termino en la barra de busqueda de Gmail.
    const percepcion = correr(
      COMPOSE,
      expresionPercepcionConEstrategias({ tipo: 'campo', texto: 'martin@ejemplo.com' }),
      { valores: { 'input[name="q"]': 'martin@ejemplo.com' }, enfocar: 'input[name="to"]' },
    );
    expect(percepcion.estrategias).toContainEqual({
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Buscar correo',
    });
    expect(JSON.stringify(percepcion.estrategias)).not.toContain('Destinatarios en Para');
  });

  it('ESCRITURA sin coincidencia (el valor vive en un chip): cae al elemento enfocado', () => {
    const percepcion = correr(
      COMPOSE,
      expresionPercepcionConEstrategias({ tipo: 'campo', texto: 'juan@ejemplo.com' }),
      { enfocar: 'input[name="to"]' },
    );
    expect(percepcion.estrategias).toContainEqual({
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Destinatarios en Para',
    });
  });

  it('CLICK por vision (sin selector): el elemento enfocado', () => {
    const percepcion = correr(COMPOSE, expresionPercepcionConEstrategias({ tipo: 'foco' }), {
      enfocar: '[aria-label="Cuerpo del mensaje"]',
    });
    expect(percepcion.estrategias).toContainEqual({
      tipo: 'rol',
      rol: 'textbox',
      nombre: 'Cuerpo del mensaje',
    });
  });

  it('CLICK con selector resuelto: ESE elemento, aunque el foco haya quedado en otro', () => {
    // Es el caso Redactar: al abrirse el compose, Gmail lleva el foco al campo Para.
    const percepcion = correr(
      COMPOSE,
      expresionPercepcionConEstrategias({ tipo: 'xpath', xpath: '/html[1]/body[1]/div[1]' }),
      { enfocar: 'input[name="to"]' },
    );
    expect(percepcion.estrategias).toContainEqual({
      tipo: 'rol',
      rol: 'button',
      nombre: 'Redactar',
    });
  });

  it('CLICK cuyo elemento ya no esta: sin estrategias y SIN caer al foco', () => {
    // El boton Enviar desaparece con el compose. Atribuirle al paso lo que quedo enfocado seria
    // guardar en el atlas un elemento que ese paso nunca toco.
    const opciones = {
      enfocar: 'input[name="to"]',
      valores: { 'input[name="to"]': 'martin@ejemplo.com' },
    };
    const percepcion = correr(
      COMPOSE,
      expresionPercepcionConEstrategias({ tipo: 'xpath', xpath: '/html[1]/body[1]/div[99]' }),
      opciones,
    );
    expect(percepcion.estrategias).toBeUndefined();
    // Y la percepcion de siempre sigue entera: perder el dato del atlas no cuesta nada mas.
    expect(sinEstrategias(percepcion)).toEqual(
      sinEstrategias(correr(COMPOSE, EXPRESION_PERCEPCION, opciones)),
    );
    expect(percepcion.campos.length).toBeGreaterThan(0);
  });
});
