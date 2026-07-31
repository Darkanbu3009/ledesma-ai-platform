import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { EXPRESION_LEER_CAMPOS, expresionLocalizarBotonPorAriaLabel } from '../src/browserbase.js';
import { claseDeElemento } from '../src/atlas-sitios.js';
import { expresionLeerEstrategias } from '../src/localizacion.js';
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
/** Un control localizado, tal como lo devuelve la expresion. */
type ControlLocalizado = { ariaLabel: string; rol: string } | null;

/**
 * jsdom no trae `CSS` (el navegador real si, desde hace una decada) y la resolucion del nombre por
 * label asociado escapa el id con `CSS.escape`. Se define el minimo para que el guion corra igual que
 * en el navegador, con el mismo criterio con el que otros tests de DOM suplen `getBoundingClientRect`.
 */
const SHIM_CSS = `window.CSS = window.CSS || { escape: (valor) => String(valor).replace(/["\\\\]/g, '\\\\$&') };`;

/** Ejecuta el localizador REAL sobre una pagina y devuelve lo que devolveria en el navegador. */
function localizar(
  cuerpoHtml: string,
  prefijos: string[],
): { localizado: ControlLocalizado; candidatos: number } {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: 'https://mail.google.com/mail/u/0/',
    runScripts: 'outside-only',
  });
  try {
    dom.window.eval(SHIM_CSS);
    const crudo = dom.window.eval(expresionLocalizarBotonPorAriaLabel(prefijos));
    if (typeof crudo !== 'string') throw new Error('el localizador no devolvio texto');
    return JSON.parse(crudo) as { localizado: ControlLocalizado; candidatos: number };
  } finally {
    dom.window.close();
  }
}

/** Las estrategias que la PERCEPCION lee de ese elemento (la otra expresion sobre el mismo DOM). */
function leerEstrategias(cuerpoHtml: string, xpath: string): EstrategiaLocalizacion[] {
  const dom = new JSDOM(`<!doctype html><html><body>${cuerpoHtml}</body></html>`, {
    url: 'https://tienda.ejemplo.com/carrito',
    runScripts: 'outside-only',
  });
  try {
    dom.window.eval(SHIM_CSS);
    const crudo = dom.window.eval(expresionLeerEstrategias({ tipo: 'xpath', xpath }));
    if (typeof crudo !== 'string' || crudo === '') throw new Error('la lectura no devolvio nada');
    return JSON.parse(crudo) as EstrategiaLocalizacion[];
  } finally {
    dom.window.close();
  }
}

/** La CLASE DE ELEMENTO que el atlas guardaria del control localizado (la del eje rol). */
function claseDelControl(localizado: ControlLocalizado): string | null {
  if (localizado === null) return null;
  return claseDeElemento('click', [
    { tipo: 'rol', rol: localizado.rol, nombre: localizado.ariaLabel },
  ]);
}

const BOTON_ENVIAR =
  '<div role="button" aria-label="Enviar ‪(Ctrl-Enter)‬" data-tooltip="Enviar">Enviar</div>';

describe('expresionLocalizarBotonPorAriaLabel (FASE 3)', () => {
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

  it('el aria-label REAL con marcas bidi da la MISMA clase que el limpio', () => {
    const conMarcas = localizar(BOTON_ENVIAR, ['Enviar', 'Send']);
    const limpio = localizar(
      '<div role="button" aria-label="Enviar (Ctrl-Enter)">Enviar</div>',
      ['Enviar', 'Send'],
    );
    expect(claseDelControl(conMarcas.localizado)).toBe(claseDelControl(limpio.localizado));
    expect(claseDelControl(conMarcas.localizado)).toBe('click|rol:button|enviar (ctrl-enter)');
  });
});

/**
 * LAS CUATRO FORMAS DE NOMBRE ACCESIBLE (FIX D). El localizador resolvia SOLO aria-label, que es la
 * que usa Gmail: el caso de prueba tapaba el hueco entero. Ahora resuelve con la MISMA cadena que
 * `nombreDe` usa para la percepcion y para el grabador, asi que un control que se llama por su texto
 * interno, por aria-labelledby o por un label asociado tambien se encuentra.
 *
 * Cada fixture comprueba las tres cosas que hacen falta para que la clase llegue al atlas: que el
 * control se localice, que el rol sea el accesible (rolDe) y que la clase de elemento resultante sea
 * la que `claseDeElemento` produce, que es la que el atlas guarda y la barrera compara.
 *
 * NADA DE ESTO ES DE GMAIL: la tienda de abajo no comparte marcado con el correo, y el mecanismo es
 * el mismo porque se resuelve por el verbo del objetivo y por el marcado del sitio.
 */
describe('formas del nombre accesible que el localizador resuelve (FIX D)', () => {
  const COMPRAR = ['comprar', 'ordenar', 'confirmar pedido', 'buy', 'purchase', 'order', 'checkout'];

  it('aria-label: el boton Enviar de Gmail', () => {
    const resultado = localizar(BOTON_ENVIAR, ['Enviar', 'Send']);
    expect(resultado.localizado?.rol).toBe('button');
    expect(claseDelControl(resultado.localizado)).toBe('click|rol:button|enviar (ctrl-enter)');
    expect(resultado.candidatos).toBe(1);
  });

  it('aria-labelledby: el nombre lo pone otro nodo de la pagina', () => {
    const resultado = localizar(
      '<span id="rotulo">Publicar entrada</span><button aria-labelledby="rotulo"></button>',
      ['publicar', 'publish'],
    );
    expect(resultado.localizado?.rol).toBe('button');
    expect(claseDelControl(resultado.localizado)).toBe('click|rol:button|publicar entrada');
  });

  it('label asociado: el nombre lo pone un <label for> del formulario', () => {
    const resultado = localizar(
      '<label for="btn-pagar">Pagar ahora</label><button id="btn-pagar"></button>',
      ['pagar', 'pay'],
    );
    expect(resultado.localizado?.rol).toBe('button');
    expect(claseDelControl(resultado.localizado)).toBe('click|rol:button|pagar ahora');
  });

  it('texto interno: un boton de compra de OTRO sitio, sin un solo aria-*', () => {
    // La tienda no se parece en nada a Gmail y no hay regla por dominio en ninguna parte: lo unico
    // que decide es el verbo del objetivo (la familia 'comprar') contra el marcado del sitio.
    const resultado = localizar('<button>Comprar ahora</button>', COMPRAR);
    expect(resultado.localizado?.rol).toBe('button');
    expect(claseDelControl(resultado.localizado)).toBe('click|rol:button|comprar ahora');
    expect(resultado.candidatos).toBe(1);
  });

  it('input[type=submit]: el boton de un formulario sin JavaScript, con su value por nombre', () => {
    const resultado = localizar('<input type="submit" value="Comprar ahora">', COMPRAR);
    // rolDe mapea submit a 'button', asi que produce la MISMA clase que el <button> de arriba.
    expect(resultado.localizado?.rol).toBe('button');
    expect(claseDelControl(resultado.localizado)).toBe('click|rol:button|comprar ahora');
  });

  it('un enlace de navegacion NO es un control accionable, aunque su nombre empiece igual', () => {
    const resultado = localizar('<a href="/pedidos">Comprar de nuevo</a>', COMPRAR);
    expect(resultado.localizado).toBeNull();
    expect(resultado.candidatos).toBe(0);
  });

  /**
   * CERO LOGICA DUPLICADA: el localizador y la lectura de la percepcion son dos expresiones distintas
   * sobre el mismo elemento, y tienen que producir la MISMA clase. Si divergieran, lo que escribe un
   * camino no lo encontraria el otro y la barrera volveria a pedir una clase que nadie puede
   * corroborar, que es exactamente el circuito cerrado que este cambio abre.
   */
  it('la percepcion lee el MISMO rol y nombre que el localizador, o sea la misma clase', () => {
    const casos = [
      { marcado: BOTON_ENVIAR, xpath: '/html[1]/body[1]/div[1]' },
      { marcado: '<button>Comprar ahora</button>', xpath: '/html[1]/body[1]/button[1]' },
      {
        marcado: '<span id="rotulo">Publicar entrada</span><button aria-labelledby="rotulo"></button>',
        xpath: '/html[1]/body[1]/button[1]',
      },
    ];
    for (const { marcado, xpath } of casos) {
      const porElLocalizador = claseDelControl(
        localizar(marcado, ['enviar', 'comprar', 'publicar']).localizado,
      );
      const rol = leerEstrategias(marcado, xpath).find((estrategia) => estrategia.tipo === 'rol');
      expect(rol, marcado).toBeDefined();
      expect(claseDeElemento('click', rol === undefined ? [] : [rol]), marcado).toBe(porElLocalizador);
    }
  });
});
