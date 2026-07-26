import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { EXPRESION_LEER_CAMPOS } from '../src/browserbase.js';

/**
 * EL LECTOR DE CAMPOS, CORRIENDO DE VERDAD sobre un DOM (CAMBIO 1 y 2). Los tests de verificacion
 * fijan que hace el veredicto con los campos ya leidos; estos ejecutan la MISMA expresion que se
 * inyecta en el navegador y comprueban QUE campos produce, que es lo que en produccion salio mal:
 * Gmail convierte el destinatario confirmado en un CHIP, el input queda vacio y el lector devolvia
 * cadena vacia donde el usuario veia el correo. De ahi salieron un falso positivo del confirmador,
 * una grabacion sin el dato y el falso negativo que bloqueo la ejecucion.
 */

interface CampoLeido {
  contexto: string;
  valor: string;
  noLeible?: boolean;
}

/** Ejecuta la expresion del lector tal cual sobre una pagina y devuelve los campos que produce. */
function leerCampos(cuerpoHtml: string): CampoLeido[] {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: 'https://correo.ejemplo.com/redactar',
    runScripts: 'outside-only',
  });
  try {
    const crudo = dom.window.eval(EXPRESION_LEER_CAMPOS);
    if (typeof crudo !== 'string') throw new Error('el lector no devolvio texto');
    return JSON.parse(crudo) as CampoLeido[];
  } finally {
    dom.window.close();
  }
}

/** El campo cuyo contexto contiene el texto dado (o lanza: el fixture debe producirlo). */
function campo(campos: CampoLeido[], contexto: string): CampoLeido {
  const encontrado = campos.find((c) => c.contexto.toLowerCase().includes(contexto));
  if (encontrado === undefined) {
    throw new Error(`ningun campo con contexto "${contexto}" en ${JSON.stringify(campos)}`);
  }
  return encontrado;
}

describe('lector de campos sobre el DOM (CAMBIO 1: chips)', () => {
  it('el caso real de Gmail: el destinatario convertido en chip vuelve como valor del campo Para', () => {
    // Tras confirmar el destinatario, Gmail vacia el input y pinta el correo en un chip (role
    // option con data-hovercard-id) dentro del mismo listbox del campo.
    const campos = leerCampos(`
      <div role="listbox" aria-label="Area de destinatarios">
        <div role="option" data-hovercard-id="juan@ejemplo.com" data-name="Juan Perez">
          <span>Juan Perez</span>
          <button aria-label="Quitar a Juan Perez">x</button>
        </div>
        <input type="text" aria-label="Destinatarios en Para" value="">
      </div>
      <input type="text" name="subjectbox" placeholder="Asunto" value="Reporte de agosto">
      <div contenteditable="true" aria-label="Cuerpo del mensaje">Adjunto el reporte</div>
    `);
    // El correo del chip queda ASOCIADO al campo Para, no suelto ni perdido.
    expect(campo(campos, 'para').valor).toBe('juan@ejemplo.com');
    expect(campo(campos, 'para').noLeible).toBeUndefined();
    expect(campo(campos, 'asunto').valor).toBe('Reporte de agosto');
    expect(campo(campos, 'cuerpo').valor).toBe('Adjunto el reporte');
  });

  it('varios chips se juntan como el valor del mismo campo', () => {
    const campos = leerCampos(`
      <div role="listbox" aria-label="Para">
        <div role="option" data-hovercard-id="ana@ejemplo.com">Ana</div>
        <div role="option" data-hovercard-id="luis@ejemplo.com">Luis</div>
        <input type="text" aria-label="Destinatarios" value="">
      </div>
    `);
    expect(campo(campos, 'destinatarios').valor).toBe('ana@ejemplo.com, luis@ejemplo.com');
  });

  it('sin data-*, el valor sale de title/aria-label y al final del texto visible del chip', () => {
    const campos = leerCampos(`
      <div role="list" aria-label="Para">
        <span role="listitem" title="Luis Lara &lt;luis@ejemplo.com&gt;">Luis Lara</span>
        <input type="text" aria-label="Destinatarios" value="">
      </div>
      <div role="group" aria-label="Etiquetas del envio">
        <span role="listitem">urgente</span>
        <input type="text" aria-label="Agregar etiqueta" value="">
      </div>
    `);
    expect(campo(campos, 'destinatarios').valor).toBe('Luis Lara <luis@ejemplo.com>');
    expect(campo(campos, 'etiqueta').valor).toBe('urgente');
  });

  it('un chip de sugerencia FUERA del contenedor del campo NO se lee como su valor', () => {
    // El popup de sugerencias vive en otra parte del documento: leerlo daria por escrito un
    // destinatario que nadie confirmo.
    const campos = leerCampos(`
      <div role="listbox" aria-label="Para">
        <input type="text" aria-label="Destinatarios" value="">
      </div>
      <div role="listbox" class="sugerencias">
        <div role="option" data-hovercard-id="sugerido@ejemplo.com">Sugerido</div>
      </div>
    `);
    expect(campos.some((c) => c.valor.includes('sugerido@ejemplo.com'))).toBe(false);
  });

  it('un combobox NO es contenedor de chips: una SUGERENCIA no es un valor comprometido', () => {
    // Revision adversarial: en el patron ARIA de combobox el envoltorio contiene el popup de
    // sugerencias. Si el lector lo tratara como contenedor de chips, la verificacion pasaria con un
    // destinatario que nadie confirmo (el correo correcto, pintado como sugerencia, con el campo
    // aun vacio) y la accion se ejecutaria sin el dato escrito.
    const campos = leerCampos(`
      <div role="combobox" aria-expanded="true">
        <input type="text" aria-label="Destinatarios en Para" value="">
        <div role="listbox" class="popup-de-sugerencias">
          <div role="option" data-hovercard-id="juan@ejemplo.com">Juan (sugerido)</div>
        </div>
      </div>
    `);
    expect(campos.some((c) => c.valor.includes('juan@ejemplo.com'))).toBe(false);
  });

  it('lo tecleado en el input manda: los chips solo suplen a un campo vacio', () => {
    const campos = leerCampos(`
      <div role="listbox" aria-label="Para">
        <div role="option" data-hovercard-id="chip@ejemplo.com">Chip</div>
        <input type="text" aria-label="Destinatarios" value="tecleado@ejemplo.com">
      </div>
    `);
    expect(campo(campos, 'destinatarios').valor).toBe('tecleado@ejemplo.com');
  });
});

describe('lector de campos sobre el DOM (CAMBIO 2: vacio vs no leible)', () => {
  it('un campo vacio sin chips NO aparece: esta por escribirse, no es un dato perdido', () => {
    const campos = leerCampos(`
      <input type="text" aria-label="Destinatarios en Para" value="">
      <input type="text" name="subjectbox" value="Hola">
    `);
    expect(campos).toHaveLength(1);
    expect(campo(campos, 'subjectbox').valor).toBe('Hola');
  });

  it('un campo con chips de los que no se pudo extraer valor sale marcado noLeible', () => {
    const campos = leerCampos(`
      <div role="listbox" aria-label="Area de destinatarios">
        <div role="option"><img alt=""></div>
        <input type="text" aria-label="Destinatarios en Para" value="">
      </div>
    `);
    const para = campo(campos, 'para');
    expect(para.valor).toBe('');
    expect(para.noLeible).toBe(true);
  });

  it('los campos de contrasena siguen sin leerse jamas', () => {
    const campos = leerCampos(`
      <input type="password" name="clave" value="secreta">
      <input type="text" name="usuario" value="omar">
    `);
    expect(JSON.stringify(campos)).not.toContain('secreta');
    expect(campo(campos, 'usuario').valor).toBe('omar');
  });
});
