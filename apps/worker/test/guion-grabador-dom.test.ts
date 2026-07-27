import { describe, it, expect } from 'vitest';
import { JSDOM, type ElementoJsdom, type VentanaJsdom } from 'jsdom';
import type { PasoGrabado } from '@ledesma-platform/shared';
import { ENLACE_DE_GRABACION, GUION_GRABADOR } from '../src/guion-grabador.js';
import { AcumuladorDeGrabacion, parsearEventoCapturado } from '../src/grabacion.js';

/**
 * EL GUION QUE GRABA, CORRIENDO DE VERDAD sobre un DOM (CAMBIO 1 y 2). Los otros tests del guion fijan
 * invariantes del TEXTO que se inyecta; estos ejecutan el guion en una pagina real y comprueban QUE
 * PASOS produce, que es lo que en produccion salio mal:
 *
 *  - el destinatario de un correo NUNCA quedo como escritura. El campo "Para" es un combobox y el
 *    sitio lo VACIA al aceptar la sugerencia, asi que leer su valor al cerrarlo devolvia una cadena
 *    vacia. Lo unico que quedaba era un clic sobre la sugerencia, localizado por el texto del correo:
 *    al repetir la tarea con otro destinatario esa sugerencia no existe y el paso falla;
 *  - el paso que escribia el cuerpo del mensaje conservaba una estrategia de texto con el cuerpo
 *    entero, que es justo el dato que el usuario marca como variable.
 *
 * Se ejecuta el guion tal cual (misma cadena que se inyecta en el navegador) y sus eventos se pasan
 * por el MISMO parseo y el MISMO acumulador que en produccion: lo que se comprueba son los pasos
 * finales, no un intermedio.
 */

const DOMINIO = 'correo.ejemplo.com';
const CORREO = 'martin@ejemplo.com';

interface PaginaDePrueba {
  ventana: VentanaJsdom;
  pasos: () => PasoGrabado[];
  /** El motivo de corte que el handler de produccion registraria ('contrasena'), o null. */
  corte: () => string | null;
  cerrar: () => void;
}

/** Abre una pagina con el grabador YA instalado y acumulando, igual que en una grabacion real. */
function abrirPaginaGrabada(cuerpoHtml: string): PaginaDePrueba {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: `https://${DOMINIO}/redactar`,
    runScripts: 'outside-only',
  });
  const ventana = dom.window;
  const global = ventana as unknown as Record<string, unknown>;
  // jsdom no implementa CSS.escape, que en cualquier navegador existe y que el ayudante de nombre
  // accesible usa para buscar el <label for>. Se le da la equivalente para ids simples: sin ella el
  // ayudante lanzaria por una carencia del entorno de prueba, no por el codigo que se esta probando.
  global.CSS = { escape: (valor: string) => valor };

  const acumulador = new AcumuladorDeGrabacion(DOMINIO);
  // Mismo criterio que el handler real (grabarTarea): el primer 'contrasena' fija el corte y todo lo
  // posterior se ignora.
  let corte: string | null = null;
  global[ENLACE_DE_GRABACION] = (crudo: string): void => {
    if (corte !== null) return;
    const evento = parsearEventoCapturado(crudo);
    if (evento === null) return;
    if (acumulador.agregar(evento) === 'contrasena') corte = 'contrasena';
  };
  ventana.eval(GUION_GRABADOR);

  return {
    ventana,
    pasos: () => acumulador.pasos(),
    corte: () => corte,
    cerrar: () => ventana.close(),
  };
}

function elemento(pagina: PaginaDePrueba, id: string): ElementoJsdom {
  const el = pagina.ventana.document.getElementById(id);
  if (el === null) throw new Error(`el fixture no tiene el elemento ${id}`);
  return el;
}

function disparar(pagina: PaginaDePrueba, el: ElementoJsdom, tipo: string): void {
  el.dispatchEvent(new pagina.ventana.Event(tipo, { bubbles: true }));
}

function clicar(pagina: PaginaDePrueba, el: ElementoJsdom): void {
  el.dispatchEvent(new pagina.ventana.MouseEvent('click', { bubbles: true }));
}

function pulsar(pagina: PaginaDePrueba, el: ElementoJsdom, key: string): void {
  el.dispatchEvent(new pagina.ventana.KeyboardEvent('keydown', { key, bubbles: true }));
}

/** Todo el texto que las estrategias de un paso exponen (para comprobar que no llevan el dato). */
function textoDeLasEstrategias(paso: PasoGrabado): string {
  return paso.estrategias
    .map((estrategia) => {
      switch (estrategia.tipo) {
        case 'atributo':
          return estrategia.valor;
        case 'rol':
          return estrategia.nombre;
        case 'texto':
          return estrategia.texto;
        case 'xpath':
          return estrategia.xpath;
      }
    })
    .join(' | ');
}

describe('el grabador captura la escritura en campos que no son input', () => {
  it('escribir en un contenedor contenteditable produce un paso escribir con su valor', () => {
    const pagina = abrirPaginaGrabada(
      '<div id="cuerpo" role="textbox" aria-label="Cuerpo del mensaje" contenteditable="true"></div>',
    );
    try {
      const cuerpo = elemento(pagina, 'cuerpo');
      // jsdom no implementa isContentEditable (si el atributo). En un navegador real la propiedad
      // vale true por el atributo; aqui se declara para que el lector de valores la vea igual.
      Object.defineProperty(cuerpo, 'isContentEditable', { value: true });

      cuerpo.textContent = 'llego el paquete';
      disparar(pagina, cuerpo, 'input');
      disparar(pagina, cuerpo, 'focusout');

      const pasos = pagina.pasos();
      expect(pasos.map((paso) => paso.accion)).toEqual(['navegar', 'escribir']);
      expect(pasos[1]?.valor).toBe('llego el paquete');
      // Y su localizacion NO depende de lo escrito: el texto visible del contenedor ES el valor.
      expect(textoDeLasEstrategias(pasos[1] as PasoGrabado)).not.toContain('llego el paquete');
      expect(pasos[1]?.estrategias.length).toBeGreaterThan(0);
    } finally {
      pagina.cerrar();
    }
  });

  it('teclear y confirmar con Tab produce dos pasos, escribir y tecla, en ese orden', () => {
    const pagina = abrirPaginaGrabada('<input id="para" role="combobox" aria-label="Para">');
    try {
      const para = elemento(pagina, 'para');
      para.value = CORREO;
      disparar(pagina, para, 'input');
      pulsar(pagina, para, 'Tab');

      const pasos = pagina.pasos();
      expect(pasos.map((paso) => paso.accion)).toEqual(['navegar', 'escribir', 'teclas']);
      expect(pasos[1]?.valor).toBe(CORREO);
      expect(pasos[2]?.teclas).toBe('Tab');
    } finally {
      pagina.cerrar();
    }
  });

  it('el caso de produccion: el campo Para deja escritura ANTES del clic en la sugerencia', () => {
    const pagina = abrirPaginaGrabada(
      '<input id="para" role="combobox" aria-label="Para">' +
        `<div id="sugerencias"><div id="sugerencia-1" role="option">${CORREO} ${CORREO}</div></div>`,
    );
    try {
      const para = elemento(pagina, 'para');
      para.value = CORREO;
      disparar(pagina, para, 'input');
      // El sitio ACEPTA la sugerencia y vacia el campo: es lo que hacia perder el paso entero.
      para.value = '';
      clicar(pagina, elemento(pagina, 'sugerencia-1'));

      const pasos = pagina.pasos();
      expect(pasos.map((paso) => paso.accion)).toEqual(['navegar', 'escribir', 'click']);
      expect(pasos[1]?.valor).toBe(CORREO);
      // El clic de confirmacion NO se localiza por el correo: con otro destinatario esa sugerencia
      // no existe. Le queda la posicion en la lista (y el atributo estable de la fila).
      expect(textoDeLasEstrategias(pasos[2] as PasoGrabado)).not.toContain(CORREO);
      expect(pasos[2]?.estrategias.length).toBeGreaterThan(0);
    } finally {
      pagina.cerrar();
    }
  });

  it('la guardia corta igual cuando el input llega por el RELAY DE TECLADO MOVIL', () => {
    // Las teclas del relay entran por CDP (Input.insertText / dispatchKeyEvent) y en la pagina se ven
    // como los MISMOS eventos DOM que el teclado de desktop: insertText dispara 'input' sin keydown
    // previo. La guardia opera sobre el DOM (hay un campo de contrasena o no), NUNCA sobre el origen
    // del input, asi que este flujo tiene que cortarse exactamente igual.
    const pagina = abrirPaginaGrabada('<input id="buscar" aria-label="Buscar">');
    try {
      const buscar = elemento(pagina, 'buscar');
      // Tecleo por relay: solo el evento 'input' (asi se ve un Input.insertText), sin keydown.
      buscar.value = 'factura marzo';
      disparar(pagina, buscar, 'input');
      // Confirmacion con la tecla de control del relay (dispatchKeyEvent -> 'keydown').
      pulsar(pagina, buscar, 'Enter');
      expect(pagina.pasos().map((paso) => paso.accion)).toEqual(['navegar', 'escribir', 'teclas']);
      expect(pagina.corte()).toBeNull();

      // La sesion del sitio expira A MITAD de la grabacion: aparece una pantalla de login.
      const clave = pagina.ventana.document.createElement('input');
      clave.setAttribute('type', 'password');
      pagina.ventana.document.body.appendChild(clave);

      // La siguiente pulsacion por relay dispara la guardia: corte inmediato y nada mas se graba.
      buscar.value = 'otra cosa';
      disparar(pagina, buscar, 'input');
      pulsar(pagina, buscar, 'Enter');

      expect(pagina.corte()).toBe('contrasena');
      const pasos = pagina.pasos();
      expect(pasos.map((paso) => paso.accion)).toEqual(['navegar', 'escribir', 'teclas']);
      expect(JSON.stringify(pasos)).not.toContain('otra cosa');
    } finally {
      pagina.cerrar();
    }
  });

  it('no lee NADA de un campo de contrasena: la grabacion se corta al verlo', () => {
    const pagina = abrirPaginaGrabada('<input id="clave" type="password">');
    try {
      const clave = elemento(pagina, 'clave');
      clave.value = 'hunter2';
      disparar(pagina, clave, 'input');
      disparar(pagina, clave, 'focusout');

      // Ni siquiera la navegacion inicial se acumula: el corte ocurre en el primer guardia, y el
      // acumulador devuelve 'contrasena' (el handler descarta la grabacion entera).
      const pasos = pagina.pasos();
      expect(pasos.some((paso) => paso.valor !== null)).toBe(false);
      expect(JSON.stringify(pasos)).not.toContain('hunter2');
    } finally {
      pagina.cerrar();
    }
  });
});
