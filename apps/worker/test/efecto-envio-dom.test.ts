import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { EXPRESION_LEER_CAMPOS, expresionLocalizarBotonPorAriaLabel } from '../src/browserbase.js';
import { extraerParametrosDeclarados } from '../src/parametros-objetivo.js';
import { accionSurtioEfecto, desenlaceDelEfecto, type CampoDeLaPagina } from '../src/verificacion.js';

/**
 * LA HUELLA DE EFECTO CONTRA UN DOM DE GMAIL SIMULADO (FIX B). Los tests de verificacion fijan el
 * criterio con fotos sinteticas; estos ejecutan el MISMO lector de campos que se inyecta en el
 * navegador (EXPRESION_LEER_CAMPOS) sobre un compose realista y comprueban los tres desenlaces de la
 * corrida de produccion del 27 jul 2026:
 *  - el compose se CIERRA al enviar (Gmail retira el formulario del DOM): efecto confirmado;
 *  - el compose queda INTACTO (el click golpeo la cabecera, no el boton Enviar): sin efecto;
 *  - el compose queda MINIMIZADO (los campos siguen en el DOM, colapsados): sin efecto. El lector
 *    incluye los campos ocultos a proposito, asi que un compose colapsado sigue presente en la foto.
 */

const OBJETIVO =
  'envia a juan@ejemplo.com un correo con asunto "Reporte de agosto" y cuerpo "Adjunto el reporte"';
const PARAMETROS = extraerParametrosDeclarados(OBJETIVO);

/** El compose de Gmail con los tres campos verificados (el destinatario ya es un chip). */
const COMPOSE = `
  <div id="compose" role="dialog">
    <div role="listbox" aria-label="Area de destinatarios">
      <div role="option" data-hovercard-id="juan@ejemplo.com" data-name="Juan Perez">Juan Perez</div>
      <input type="text" aria-label="Destinatarios en Para" value="">
    </div>
    <input type="text" name="subjectbox" placeholder="Asunto" value="Reporte de agosto">
    <div contenteditable="true" aria-label="Cuerpo del mensaje">Adjunto el reporte</div>
  </div>
`;

/** La bandeja alrededor del compose: el buscador lleno persiste antes y despues del envio. */
function bandeja(compose: string, extra = ''): string {
  return `
    <input type="text" aria-label="Buscar correo" value="facturas pendientes">
    ${compose}
    ${extra}
  `;
}

/** Ejecuta el lector REAL sobre la pagina y devuelve la foto de campos de la verificacion. */
function leerCampos(cuerpoHtml: string): CampoDeLaPagina[] {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: 'https://mail.google.com/mail/u/0/',
    runScripts: 'outside-only',
  });
  try {
    const crudo = dom.window.eval(EXPRESION_LEER_CAMPOS);
    if (typeof crudo !== 'string') throw new Error('el lector no devolvio texto');
    return JSON.parse(crudo) as CampoDeLaPagina[];
  } finally {
    dom.window.close();
  }
}

describe('efecto del clic de Enviar sobre el DOM de Gmail simulado (FIX B)', () => {
  const antes = { campos: leerCampos(bandeja(COMPOSE)), texto: 'Nuevo mensaje Enviar' };

  it('la foto previa contiene el formulario verificado (chip incluido)', () => {
    const valores = antes.campos.map((campo) => campo.valor);
    expect(valores).toContain('juan@ejemplo.com');
    expect(valores).toContain('Reporte de agosto');
    expect(valores).toContain('Adjunto el reporte');
  });

  it('compose presente antes y AUSENTE despues: efecto confirmado', () => {
    // Gmail cierra el compose al enviar; el hilo muestra el mensaje recien enviado y el buscador
    // sigue lleno. Nada de eso niega el exito: el formulario verificado desaparecio del DOM.
    const despues = {
      campos: leerCampos(bandeja('', '<div>Reporte de agosto  Adjunto el reporte</div>')),
      texto: 'Conversacion  Reporte de agosto  Adjunto el reporte',
    };
    expect(desenlaceDelEfecto({ parametros: PARAMETROS, antes, despues })).toBe('confirmado');
    expect(accionSurtioEfecto({ parametros: PARAMETROS, antes, despues })).toBe(true);
  });

  it('compose INTACTO (el click golpeo la cabecera, no Enviar): sin efecto', () => {
    const despues = { campos: leerCampos(bandeja(COMPOSE)), texto: 'Nuevo mensaje Enviar' };
    expect(desenlaceDelEfecto({ parametros: PARAMETROS, antes, despues })).toBe('formulario_presente');
    expect(accionSurtioEfecto({ parametros: PARAMETROS, antes, despues })).toBe(false);
  });

  it('compose MINIMIZADO (presente pero colapsado): sin efecto', () => {
    // El paso 59 de la corrida de produccion: el compose quedo minimizado. Sus campos siguen en el
    // DOM (ocultos) y el lector los incluye a proposito, asi que el formulario sigue presente.
    const minimizado = `<div style="display:none">${COMPOSE}</div>`;
    const despues = { campos: leerCampos(bandeja(minimizado)), texto: 'Nuevo mensaje (minimizado)' };
    expect(desenlaceDelEfecto({ parametros: PARAMETROS, antes, despues })).toBe('formulario_presente');
    expect(accionSurtioEfecto({ parametros: PARAMETROS, antes, despues })).toBe(false);
  });

  it('el aviso "Mensaje enviado" confirma aunque el compose siga pintado', () => {
    const despues = {
      campos: leerCampos(bandeja(COMPOSE)),
      texto: 'Mensaje enviado. Deshacer',
    };
    expect(desenlaceDelEfecto({ parametros: PARAMETROS, antes, despues })).toBe('confirmado');
  });
});

/**
 * EL LOCALIZADOR DEL BOTON ENVIAR por rol/aria-label (FASE 3, modo simulacro del script de
 * validacion), ejecutando la MISMA expresion que se inyecta en el navegador. El aria-label real de
 * Gmail lleva sufijo ("Enviar (Ctrl-Enter)"), por eso el criterio es POR PREFIJO.
 */
describe('expresionLocalizarBotonPorAriaLabel (FASE 3)', () => {
  function localizar(cuerpoHtml: string, prefijos: string[]) {
    const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
      url: 'https://mail.google.com/mail/u/0/',
      runScripts: 'outside-only',
    });
    try {
      const crudo = dom.window.eval(expresionLocalizarBotonPorAriaLabel(prefijos));
      if (typeof crudo !== 'string') throw new Error('el localizador no devolvio texto');
      return JSON.parse(crudo) as {
        localizado: { ariaLabel: string; rol: string } | null;
        candidatos: number;
      };
    } finally {
      dom.window.close();
    }
  }

  const BOTON_ENVIAR =
    '<div role="button" aria-label="Enviar ‪(Ctrl-Enter)‬" data-tooltip="Enviar">Enviar</div>';

  it('localiza el boton Enviar de Gmail por prefijo de aria-label, con el rol', () => {
    const resultado = localizar(`${COMPOSE}${BOTON_ENVIAR}`, ['Enviar', 'Send']);
    expect(resultado.localizado).toMatchObject({ rol: 'button' });
    expect(resultado.localizado?.ariaLabel.startsWith('Enviar')).toBe(true);
    expect(resultado.candidatos).toBe(1);
  });

  it('un boton dentro de un compose minimizado (display none) NO se localiza', () => {
    const resultado = localizar(`<div style="display: none">${BOTON_ENVIAR}</div>`, ['Enviar', 'Send']);
    expect(resultado.localizado).toBeNull();
    expect(resultado.candidatos).toBe(1);
  });

  it('no confunde el prefijo: "Enviados" en un link de navegacion no es el boton', () => {
    const resultado = localizar(
      '<a role="link" aria-label="Enviados">Enviados</a><button aria-label="Reenviar">x</button>',
      ['Enviar', 'Send'],
    );
    // El link no tiene rol de boton y "Reenviar" no EMPIEZA con "Enviar": cero candidatos.
    expect(resultado.localizado).toBeNull();
    expect(resultado.candidatos).toBe(0);
  });

  // EL CONTROL DE DESCARTAR del script de validacion usa la MISMA tecnica: el aria-label real de
  // Gmail lleva sufijo de atajo, por eso la coincidencia exacta daba no_localizado en las corridas
  // reales (borradores huerfanos). El localizador por prefijo devuelve el aria-label COMPLETO, que
  // es el que el script usa despues como estrategia exacta para el click.
  it('localiza el control de Descartar borrador por prefijo aunque lleve sufijo de atajo (es y en)', () => {
    const es = localizar(
      '<div role="button" aria-label="Descartar borrador ‪(Ctrl-Shift-D)‬">x</div>',
      ['Descartar borrador', 'Discard draft'],
    );
    expect(es.localizado?.ariaLabel.startsWith('Descartar borrador')).toBe(true);
    expect(es.localizado?.rol).toBe('button');

    const en = localizar(
      '<div role="button" aria-label="Discard draft ‪(Ctrl-Shift-D)‬">x</div>',
      ['Descartar borrador', 'Discard draft'],
    );
    expect(en.localizado?.ariaLabel.startsWith('Discard draft')).toBe(true);
  });

  it('no confunde el descarte: "Descartar cambios" no empieza con "Descartar borrador"', () => {
    const resultado = localizar(
      '<button aria-label="Descartar cambios">x</button>',
      ['Descartar borrador', 'Discard draft'],
    );
    expect(resultado.localizado).toBeNull();
    expect(resultado.candidatos).toBe(0);
  });
});
