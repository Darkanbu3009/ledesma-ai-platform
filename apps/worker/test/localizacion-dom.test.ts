import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import {
  expresionLeerEstrategias,
  expresionResolverElemento,
  leerElementoResuelto,
  nombreCoincidePorPrefijo,
} from '../src/localizacion.js';
import {
  expresionLocalizarBotonPorAriaLabel,
  expresionPercepcionConEstrategias,
} from '../src/browserbase.js';
import { GUION_GRABADOR } from '../src/guion-grabador.js';

/**
 * EL RESOLUTOR DE ESTRATEGIAS, CORRIENDO DE VERDAD sobre un DOM (FIX estrategias multiples, 28 jul
 * 2026). Fija el matcheo POR PREFIJO del nombre accesible en la estrategia 'rol': una receta
 * destilada de una trayectoria persistida solo conoce el nombre que el modelo cito en la
 * descripcion del ACT ("Enviar", "destinatario"), y el nombre real del elemento puede llevar mas
 * texto y marcas invisibles de direccion (el boton Enviar de Gmail: "Enviar ‪(Ctrl+Intro)‬").
 */

/** Ejecuta la expresion del resolutor sobre una pagina y devuelve el elemento resuelto (o null). */
function resolver(cuerpoHtml: string, estrategias: EstrategiaLocalizacion[]) {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: 'https://correo.ejemplo.com/redactar',
    runScripts: 'outside-only',
  });
  try {
    // jsdom no calcula layout: toda caja mide 0 y el resolutor descartaria todo por invisible. Se
    // le da a cada elemento una caja fija; scrollIntoView tampoco existe y se define vacio.
    dom.window.eval(`
      Element.prototype.getBoundingClientRect = function () {
        return { left: 10, top: 10, width: 100, height: 20, right: 110, bottom: 30 };
      };
      Element.prototype.scrollIntoView = function () {};
    `);
    const crudo = dom.window.eval(expresionResolverElemento(estrategias));
    if (typeof crudo !== 'string') throw new Error('el resolutor no devolvio texto');
    return crudo === '' ? null : leerElementoResuelto(crudo);
  } finally {
    dom.window.close();
  }
}

describe('resolutor de estrategias sobre el DOM: matcheo de rol por prefijo', () => {
  it('el caso real del boton Enviar de Gmail: nombre con sufijo y marcas invisibles de direccion', () => {
    const resuelto = resolver(
      `<div role="button" aria-label="Enviar ‪(Ctrl+Intro)‬">Enviar</div>
       <div role="button" aria-label="Descartar borrador">x</div>`,
      [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
    );
    expect(resuelto).not.toBeNull();
    expect(resuelto?.usada).toBe('rol');
    expect(resuelto?.estrategias).toContainEqual({
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Enviar ‪(Ctrl+Intro)‬',
    });
  });

  it('el prefijo tolera el plural: "destinatario" encuentra "Destinatarios en Para"', () => {
    const resuelto = resolver(
      `<input type="text" aria-label="Destinatarios en Para">
       <input type="text" aria-label="Asunto">`,
      [{ tipo: 'rol', rol: 'textbox', nombre: 'destinatario' }],
    );
    expect(resuelto).not.toBeNull();
    expect(resuelto?.usada).toBe('rol');
    expect(resuelto?.estrategias).toContainEqual({
      tipo: 'atributo',
      atributo: 'aria-label',
      valor: 'Destinatarios en Para',
    });
  });

  it('el prefijo exige limite de palabra: "Para" NO encuentra "Parar reproduccion"', () => {
    const resuelto = resolver(`<input type="text" aria-label="Parar reproduccion">`, [
      { tipo: 'rol', rol: 'textbox', nombre: 'Para' },
    ]);
    expect(resuelto).toBeNull();
  });

  it('con varios candidatos por prefijo, la coincidencia exacta desempata', () => {
    const resuelto = resolver(
      `<button aria-label="Enviar">Enviar</button>
       <button aria-label="Enviar mas tarde">Enviar mas tarde</button>`,
      [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
    );
    expect(resuelto).not.toBeNull();
    expect(resuelto?.estrategias).toContainEqual({ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' });
  });

  it('sin candidato unico ni coincidencia exacta, el rol no resuelve y cae a la siguiente', () => {
    const resuelto = resolver(
      `<button aria-label="Enviar ahora">a</button>
       <button aria-label="Enviar despues">b</button>`,
      [
        { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
        { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
      ],
    );
    expect(resuelto).not.toBeNull();
    expect(resuelto?.usada).toBe('xpath');
  });
});

/**
 * EL NORMALIZADOR DEL NOMBRE ACCESIBLE, COMPARTIDO. `claveDeNombre` vivia dentro del resolutor y
 * ahora vive en AYUDANTES_DOM, que es lo que se inyecta ademas en la percepcion, en el localizador de
 * controles y en el guion del grabador. Se movio TAL CUAL: estos tests fijan que se define una sola
 * vez en cada guion inyectado y que el resolutor sigue comportandose exactamente igual.
 */
describe('ayudantes de DOM compartidos: una sola definicion', () => {
  const guiones: Array<[string, string]> = [
    ['resolutor', expresionResolverElemento([{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }])],
    ['lector de estrategias', expresionLeerEstrategias({ tipo: 'punto', x: 1, y: 1 })],
    ['percepcion con estrategias', expresionPercepcionConEstrategias({ tipo: 'campo', texto: 'x' })],
    ['localizador de controles', expresionLocalizarBotonPorAriaLabel(['Enviar'])],
    ['guion del grabador', GUION_GRABADOR],
  ];

  it('cada guion inyectado define claveDeNombre, nombreDe y rolDe UNA sola vez', () => {
    for (const [nombre, guion] of guiones) {
      for (const funcion of ['claveDeNombre', 'nombreDe', 'rolDe']) {
        const definiciones = guion.split(`function ${funcion}(`).length - 1;
        expect(definiciones, `${nombre}: ${funcion}`).toBe(1);
      }
    }
  });

  it('el resolutor sigue ignorando las marcas invisibles con el ayudante compartido', () => {
    const resuelto = resolver(`<div role="button" aria-label="Enviar ‪(Ctrl-Enter)‬">Enviar</div>`, [
      { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
    ]);
    expect(resuelto?.usada).toBe('rol');
  });
});

/**
 * EL MISMO CRITERIO A LOS DOS LADOS (FIX defecto 1). El limite de palabra del matcheo por prefijo
 * vive en DOS runtimes: `nombreCoincide`, que viaja como texto y corre DENTRO de la pagina, y
 * `nombreCoincidePorPrefijo`, que corre en este proceso y es lo que consultan la barrera de
 * identidad y la sonda de reconocimiento. No pueden ser la misma funcion (la de la pagina normaliza
 * con `claveDeNombre`, la de aqui con `normalizarTexto`), asi que este test los corre CASO POR CASO
 * -- el de la pagina de verdad, sobre un DOM -- y exige el mismo veredicto.
 *
 * Los casos NO llevan acentos a proposito: quitarlos es lo unico que `normalizarTexto` hace de mas,
 * y esa diferencia es deliberada (dentro de la pagina se compara contra el DOM tal cual).
 */
describe('el limite de palabra del prefijo: la pagina y el proceso deciden igual', () => {
  const CASOS: Array<[string, string, boolean]> = [
    // [nombre real del elemento, nombre buscado, coincide]
    ['Enviar', 'Enviar', true],
    ['Enviar (Ctrl+Intro)', 'Enviar', true],
    ['Destinatarios en Para', 'destinatario', true],
    ['Eliminar ambiente', 'eliminar', true],
    ['Eliminar TODOS los ambientes', 'eliminar', true],
    ['Eliminars', 'eliminar', true],
    ['Parar reproduccion', 'Para', false],
    ['Eliminares', 'eliminar', false],
    ['Enviarme una copia', 'enviar', false],
    ['Archivar', 'enviar', false],
  ];

  it('la pagina resuelve exactamente cuando el criterio de este proceso dice que si', () => {
    for (const [real, buscado, coincide] of CASOS) {
      const resuelto = resolver(`<div role="button" aria-label="${real}">x</div>`, [
        { tipo: 'rol', rol: 'button', nombre: buscado },
      ]);
      expect(resuelto !== null, `${buscado} contra ${real} (pagina)`).toBe(coincide);
      expect(nombreCoincidePorPrefijo(real, buscado), `${buscado} contra ${real}`).toBe(coincide);
    }
  });

  it('sin nombre a alguno de los dos lados no hay coincidencia', () => {
    expect(nombreCoincidePorPrefijo('', 'enviar')).toBe(false);
    expect(nombreCoincidePorPrefijo('Enviar', '   ')).toBe(false);
  });
});
