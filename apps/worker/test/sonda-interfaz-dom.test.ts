import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  clasesFaltantes,
  descriptoresDeSonda,
  expresionSondaDeClases,
  parsearLecturaDeSonda,
  type DescriptorDeSonda,
} from '../src/sonda-interfaz.js';

/**
 * LA EXPRESION DE LA SONDA, CORRIENDO DE VERDAD sobre un DOM. Fija tres cosas:
 *
 *  - los candidatos salen de los MISMOS ayudantes (rolDe, nombreDe, textoDe) con los que
 *    claseDeElemento derivo la clase, asi que un control presente siempre se reconoce;
 *  - la sonda tolera un control OCULTO (un menu colapsado sigue existiendo en la estructura) y un
 *    nombre real con sufijos, acentos y marcas invisibles de direccion;
 *  - la expresion NO muta la pagina: es solo lectura de punta a punta.
 */

function sondear(cuerpoHtml: string, descriptores: DescriptorDeSonda[]): string[][] | null {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: 'https://correo.ejemplo.com/',
    runScripts: 'outside-only',
  });
  try {
    const crudo = dom.window.eval(expresionSondaDeClases(descriptores));
    if (typeof crudo !== 'string') throw new Error('la sonda no devolvio texto');
    return parsearLecturaDeSonda(crudo, descriptores.length);
  } finally {
    dom.window.close();
  }
}

const PAGINA_DE_CORREO = `
  <div role="button" aria-label="Redactar mensaje nuevo">Redactar</div>
  <input type="text" aria-label="Buscar en el correo" />
  <div role="textbox" aria-label="Destinatarios en Para (Ctrl+Intro)"></div>
  <button data-accion="descartar">Descartar</button>
  <span>Comprar ahora</span>
`;

describe('la sonda sobre un DOM real', () => {
  it('encuentra un control por su eje de ROL, con el nombre real completo como candidato', () => {
    const descriptores = descriptoresDeSonda(['escribir|rol:textbox|destinatarios en para']);
    const lectura = sondear(PAGINA_DE_CORREO, descriptores);
    expect(lectura).not.toBeNull();
    expect(clasesFaltantes(descriptores, lectura ?? [])).toEqual([]);
  });

  it('encuentra por ATRIBUTO (aria-label y data-*) y por TEXTO visible', () => {
    const descriptores = descriptoresDeSonda([
      'click|atributo:aria-label|redactar mensaje nuevo',
      'click|atributo:data-accion|descartar',
      'click|texto|comprar ahora',
    ]);
    const lectura = sondear(PAGINA_DE_CORREO, descriptores);
    expect(clasesFaltantes(descriptores, lectura ?? [])).toEqual([]);
  });

  it('un control renombrado o con otro rol es un FALTANTE (el desajuste que la sonda existe para ver)', () => {
    // La pagina redisenada: el destinatario ya no es un textbox con ese nombre.
    const redisenada = `
      <div role="button" aria-label="Nueva conversacion">Redactar</div>
      <div role="combobox" aria-label="Agregar contactos"></div>
    `;
    const descriptores = descriptoresDeSonda(['escribir|rol:textbox|destinatarios en para']);
    const lectura = sondear(redisenada, descriptores);
    expect(clasesFaltantes(descriptores, lectura ?? [])).toEqual([
      'escribir|rol:textbox|destinatarios en para',
    ]);
  });

  it('tolera un control OCULTO: existir en la estructura alcanza para no declarar desajuste', () => {
    const conOculto = `<div hidden><div role="button" aria-label="Enviar">Enviar</div></div>`;
    const descriptores = descriptoresDeSonda(['click|rol:button|enviar']);
    const lectura = sondear(conOculto, descriptores);
    expect(clasesFaltantes(descriptores, lectura ?? [])).toEqual([]);
  });

  it('tolera acentos en la pagina contra una clase normalizada sin ellos', () => {
    const descriptores = descriptoresDeSonda(['click|rol:button|configuracion']);
    const lectura = sondear(
      `<button aria-label="Configuración avanzada">abrir</button>`,
      descriptores,
    );
    expect(clasesFaltantes(descriptores, lectura ?? [])).toEqual([]);
  });

  it('NO muta la pagina: el DOM queda identico antes y despues de la sonda', () => {
    const dom = new JSDOM(`<!doctype html><html><body>${PAGINA_DE_CORREO}</body></html>`, {
      url: 'https://correo.ejemplo.com/',
      runScripts: 'outside-only',
    });
    try {
      const antes = dom.window.document.body.innerHTML;
      dom.window.eval(
        expresionSondaDeClases(descriptoresDeSonda(['click|rol:button|redactar mensaje nuevo'])),
      );
      expect(dom.window.document.body.innerHTML).toBe(antes);
    } finally {
      dom.window.close();
    }
  });

  it('una pagina grande se sondea en tiempo de lectura, no de modelo (cota de costo)', () => {
    const filas = Array.from(
      { length: 1500 },
      (_, i) => `<div><button aria-label="Accion ${i}">a</button><span>texto ${i}</span></div>`,
    ).join('');
    const descriptores = descriptoresDeSonda([
      'click|rol:button|enviar',
      'escribir|rol:textbox|destinatarios en para',
    ]);
    const inicio = Date.now();
    const lectura = sondear(`${filas}${PAGINA_DE_CORREO}`, descriptores);
    const ms = Date.now() - inicio;
    expect(lectura).not.toBeNull();
    // Cota holgada para CI: una evaluacion de solo lectura sobre miles de nodos, sin un token.
    expect(ms).toBeLessThan(2000);
  });
});
