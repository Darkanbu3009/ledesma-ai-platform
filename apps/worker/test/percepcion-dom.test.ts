import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { EXPRESION_PERCEPCION } from '../src/browserbase.js';
import { parsearPercepcion, type PercepcionDePagina } from '../src/percepcion.js';

/**
 * LA EXPRESION DE PERCEPCION, CORRIENDO DE VERDAD sobre un DOM (FIX A y B). Igual que
 * lector-campos-dom.test.ts: se ejecuta la MISMA expresion que se inyecta en el navegador y se
 * comprueba lo que produce, que es lo que en produccion salio mal (texto tecleado en la barra de
 * busqueda de Gmail reportado como exito, chip del campo Para leido como campo vacio).
 */

function percibir(cuerpoHtml: string, opciones?: { enfocar?: string }): PercepcionDePagina {
  const dom = new JSDOM(`<!doctype html><html><head><title>Recibidos</title></head><body>${cuerpoHtml}</body></html>`, {
    url: 'https://mail.google.com/mail/u/0/',
    runScripts: 'outside-only',
  });
  try {
    if (opciones?.enfocar !== undefined) {
      const el = dom.window.document.querySelector(opciones.enfocar);
      if (el === null) throw new Error(`no existe ${opciones.enfocar} en el fixture`);
      (el as unknown as { focus(): void }).focus();
    }
    const crudo = dom.window.eval(EXPRESION_PERCEPCION);
    if (typeof crudo !== 'string') throw new Error('la expresion no devolvio texto');
    const percepcion = parsearPercepcion(crudo);
    if (percepcion === null) throw new Error('la percepcion no parseo');
    return percepcion;
  } finally {
    dom.window.close();
  }
}

describe('expresion de percepcion sobre el DOM', () => {
  it('trae la huella (url, titulo, nodos) y los campos con su valor', () => {
    const percepcion = percibir(`
      <input type="text" name="q" aria-label="Buscar correo" value="ana@ejemplo.com">
    `);
    expect(percepcion.url).toContain('mail.google.com');
    expect(percepcion.titulo).toBe('Recibidos');
    expect(percepcion.nodos).toBeGreaterThan(3);
    expect(percepcion.campos).toHaveLength(1);
    expect(percepcion.campos[0]?.contexto).toContain('Buscar correo');
    expect(percepcion.campos[0]?.valor).toBe('ana@ejemplo.com');
    expect(percepcion.campos[0]?.porChips).toBeUndefined();
  });

  it('describe el elemento con FOCO (el caso de la barra de busqueda)', () => {
    const percepcion = percibir(
      `<input type="text" name="q" aria-label="Buscar correo" value="">
       <input type="text" name="to" aria-label="Destinatarios en Para" value="">`,
      { enfocar: 'input[name="q"]' },
    );
    expect(percepcion.foco).toContain('q');
    expect(percepcion.foco).toContain('Buscar correo');
  });

  it('sin foco util (body), foco es null', () => {
    const percepcion = percibir(`<input type="text" name="q" value="">`);
    expect(percepcion.foco).toBeNull();
  });

  it('el chip confirmado del campo Para sale con su valor Y marcado porChips', () => {
    // El caso real de Gmail: el input queda vacio y el destinatario vive en un chip del listbox.
    const percepcion = percibir(`
      <div role="listbox" aria-label="Area de destinatarios">
        <div role="option" data-hovercard-id="juan@ejemplo.com" data-name="Juan Perez">Juan</div>
        <input type="text" aria-label="Destinatarios en Para" value="">
      </div>
    `);
    expect(percepcion.campos).toHaveLength(1);
    expect(percepcion.campos[0]?.valor).toBe('juan@ejemplo.com');
    expect(percepcion.campos[0]?.porChips).toBe(true);
  });

  it('un valor tecleado directo (sin chips) NO va marcado porChips', () => {
    const percepcion = percibir(`
      <input type="text" name="subjectbox" placeholder="Asunto" value="Reporte">
    `);
    expect(percepcion.campos[0]?.porChips).toBeUndefined();
  });
});
