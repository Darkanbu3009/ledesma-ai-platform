import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { esPublicable } from '@ledesma-platform/shared';
import { claseDeElemento, estrategiasParaElAtlas } from '../src/atlas-sitios.js';
import { AYUDANTES_DOM, sanearEstrategias } from '../src/localizacion.js';
import { plantillaAplicable } from '../src/plantillas-compartidas.js';

/**
 * DOS CONTROLES DISTINTOS NO PUEDEN COMPARTIR CLASE, Y NINGUNA CLASE PUEDE DERIVARSE DEL DATO DE LA
 * TAREA. Los tres defectos que estos tests fijan se MIDIERON sobre fixtures antes del fix, y ninguno
 * estaba ocurriendo en produccion todavia: son riesgos latentes del modelo de identidad que cualquier
 * arquitectura futura heredaria.
 *
 *  1. DESEMPATE. `claseDeElemento` devolvia en el PRIMER eje de rol que encontraba, asi que dos
 *     botones "Eliminar ambiente" (pruebas y produccion) producian la MISMA clase aunque cada uno
 *     llevara su data-testid propio y ese atributo estuviera leido y presente en las estrategias.
 *     Medido: `plantillaAplicable` acepto una plantilla cuyas estrategias apuntan a produccion contra
 *     un consumidor que solo tenia corroborada la clase de pruebas.
 *  2. PRIVACIDAD. El eje de texto visible metia contenido de pagina ajeno a la tarea dentro de la
 *     clase (medido: el importe de la factura de un tercero), y la clase viaja a la tabla GLOBAL
 *     `aprendizaje_sitios` y al nombre de las ranuras de `plantillas_compartidas`.
 *  3. EL DATO NO ES LA IDENTIDAD. Un dia de calendario producia `click|rol:button|12`: el nombre del
 *     control ERA el valor que la tarea eligio.
 *
 * SE MIDE DE PUNTA A PUNTA y sobre un DOM de verdad (jsdom), porque la mitad de la correccion vive en
 * la LECTURA (que es la unica que sabe cuantos controles homonimos hay en la pagina) y la otra mitad
 * en la derivacion: probar solo la funcion pura no demostraria nada de lo primero.
 */

/** Caja fija para todos los elementos: jsdom no calcula layout y sin caja nada resuelve. */
const SHIM_CAJAS = `
  Element.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 10, width: 100, height: 20, right: 110, bottom: 30 };
  };
`;

/** Las estrategias que la LECTURA del DOM produce para un elemento, ya saneadas como en produccion. */
function estrategiasLeidas(html: string, selector: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://app.ejemplo.com/',
    runScripts: 'outside-only',
  });
  try {
    dom.window.eval(SHIM_CAJAS);
    const crudo: unknown = dom.window.eval(`(() => {
${AYUDANTES_DOM}
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return '';
  return JSON.stringify(estrategiasDe(el));
})()`);
    if (typeof crudo !== 'string' || crudo === '') throw new Error('la lectura no devolvio nada');
    return sanearEstrategias(crudo);
  } finally {
    dom.window.close();
  }
}

/** La clase de elemento que el atlas derivaria de lo que se leyo del DOM. */
function claseLeida(html: string, selector: string, accion: 'click' | 'escribir' = 'click') {
  return claseDeElemento(accion, estrategiasLeidas(html, selector));
}

/** Dos controles con el MISMO nombre accesible y su propio data-testid, ambos a la vista. */
const DOS_ELIMINAR = `
  <div class="fila">
    <button data-testid="eliminar-ambiente-pruebas" aria-label="Eliminar ambiente">Eliminar ambiente</button>
  </div>
  <div class="fila">
    <button data-testid="eliminar-ambiente-produccion" aria-label="Eliminar ambiente">Eliminar ambiente</button>
  </div>`;

describe('R1: dos controles distintos jamas comparten clase', () => {
  it('dos botones homonimos producen clases DISTINTAS, con el atributo que los distingue', () => {
    const pruebas = claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-pruebas"]');
    const produccion = claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-produccion"]');
    expect(pruebas).toBe(
      'click|rol:button@data-testid=eliminar-ambiente-pruebas|eliminar ambiente',
    );
    expect(produccion).toBe(
      'click|rol:button@data-testid=eliminar-ambiente-produccion|eliminar ambiente',
    );
    expect(pruebas).not.toBe(produccion);
  });

  it('el NOMBRE de la clase sigue siendo el nombre accesible, que es lo que compara la barrera', () => {
    // El segundo eje va DENTRO del eje y no pegado al nombre justamente para esto: si fuera parte del
    // nombre, la barrera de identidad compararia "eliminar ambiente@..." contra el nombre del DOM y
    // bloquearia siempre un control legitimo.
    const clase = claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-pruebas"]') ?? '';
    expect(clase.slice(clase.indexOf('|', clase.indexOf('|') + 1) + 1)).toBe('eliminar ambiente');
  });

  it('sin ningun atributo que los distinga NINGUNO de los dos tiene clase (falla cerrada)', () => {
    const gemelos = `
      <button aria-label="Eliminar ambiente">Eliminar ambiente</button>
      <button aria-label="Eliminar ambiente">Eliminar ambiente</button>`;
    expect(claseLeida(gemelos, 'button')).toBeNull();
  });

  it('un control UNICO no cambia de clase: el segundo eje solo aparece cuando hace falta', () => {
    const uno = `<button data-testid="eliminar-ambiente-produccion" aria-label="Eliminar ambiente">Eliminar ambiente</button>`;
    expect(claseLeida(uno, 'button')).toBe('click|rol:button|eliminar ambiente');
  });

  it('plantillaAplicable ya no confunde un control con su homonimo', () => {
    // El consumidor solo tiene CORROBORADA la clase del boton de PRUEBAS. La plantilla lleva las
    // estrategias del de PRODUCCION. Antes del fix las dos derivaban la misma clase y el veredicto
    // era {"aplica":true,"pasos":2}; ahora la clase declarada no esta entre las corroboradas.
    const declarada = claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-produccion"]');
    const estrategias = estrategiasLeidas(
      DOS_ELIMINAR,
      '[data-testid="eliminar-ambiente-produccion"]',
    ).filter((estrategia) => estrategia.tipo !== 'xpath');
    const veredicto = plantillaAplicable({
      pasos: [
        {
          idx: 0,
          accion: 'verificar',
          dominio: 'app.ejemplo.com',
          claseDeElemento: null,
          estrategias: [],
          valor: null,
          teclas: null,
          esperaMs: null,
        },
        {
          idx: 1,
          accion: 'click',
          dominio: 'app.ejemplo.com',
          claseDeElemento: declarada,
          estrategias,
          valor: null,
          teclas: null,
          esperaMs: null,
        },
      ],
      dominio: 'app.ejemplo.com',
      valores: {},
      verboBloqueado: 'borrar',
      clasesCorroboradas: new Set([
        claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-pruebas"]') ?? '',
      ]),
    });
    expect(veredicto).toEqual({ aplica: false, motivo: 'clase_no_corroborada', idx: 1 });
  });
});

describe('R2: ninguna clase publicable lleva un dato de la tarea ni contenido de pagina', () => {
  const FILA_DE_FACTURA = `
    <div role="row" data-row-key="fac-2026-000441">
      <span>Distribuidora Andina SRL</span><span>$ 12.500,00</span><span>Vencida</span>
    </div>`;

  it('el texto visible de una fila con un importe NO forma clase', () => {
    // Antes: click|texto|distribuidora andina srl $ 12.500,00 vencida, con el importe de la factura
    // de un tercero dentro de una tabla GLOBAL.
    expect(claseLeida(FILA_DE_FACTURA, '[role="row"]')).toBeNull();
  });

  it('tampoco entra por la OTRA puerta: las estrategias que guardan las dos tablas globales', () => {
    // La clase no es lo unico global de una fila del atlas: su columna `estrategias` lo es igual, y
    // los pasos de una plantilla tambien. Las dos puertas usan la misma regla de admision.
    const leidas = estrategiasLeidas(FILA_DE_FACTURA, '[role="row"]');
    expect(JSON.stringify(estrategiasParaElAtlas(leidas, []))).not.toContain('12.500');
    const publicable = esPublicable(
      [
        {
          idx: 0,
          accion: 'click',
          claseDeElemento: 'click|texto|distribuidora andina srl $ 12.500,00 vencida',
          estrategias: leidas,
          valor: null,
          teclas: null,
          esperaMs: null,
        },
      ],
      'app.ejemplo.com',
      new Set(['click|texto|distribuidora andina srl $ 12.500,00 vencida']),
    );
    expect(publicable.publicable).toBe(false);
  });

  it('un aria-label con el numero de un registro dentro no forma clase', () => {
    const conDato = `<button aria-label="Eliminar factura 4471">Eliminar factura 4471</button>`;
    expect(claseLeida(conDato, 'button')).toBeNull();
  });

  it('si otro eje limpio queda disponible, la clase sale de ese y sin el dato', () => {
    // La derivacion NO se detiene en el eje sucio: lo salta. Lo que no puede es llevarse el dato.
    const conDato = `<button data-testid="eliminar-factura" aria-label="Eliminar factura 4471">x</button>`;
    expect(claseLeida(conDato, 'button')).toBe('click|atributo:data-testid|eliminar-factura');
  });
});

describe('R3: la identidad no puede ser el dato que la tarea eligio', () => {
  it('el numero del dia de un calendario no es la identidad del control', () => {
    const calendario = `
      <button role="button" data-testid="dia" data-date="2026-09-11">11</button>
      <button role="button" data-testid="dia" data-date="2026-09-12">12</button>
      <button role="button" data-testid="dia" data-date="2026-09-13">13</button>`;
    expect(claseLeida(calendario, '[data-date="2026-09-12"]')).toBeNull();
  });

  it('y el data-testid compartido por los 31 dias tampoco puede sustituirlo', () => {
    // Es el fallo que abriria la regla anterior si el eje de texto cayera al de atributo sin mirar
    // si ese atributo distingue: los 31 dias compartirian una sola clase.
    const calendario = `
      <button role="button" data-testid="dia">11</button>
      <button role="button" data-testid="dia">12</button>`;
    expect(claseLeida(calendario, 'button')).toBeNull();
  });
});

describe('R4: la misma clase entre dos lecturas y entre dos usuarios', () => {
  it('dos lecturas de la misma pagina producen clases identicas', () => {
    expect(claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-pruebas"]')).toBe(
      claseLeida(DOS_ELIMINAR, '[data-testid="eliminar-ambiente-pruebas"]'),
    );
  });

  it('los contadores y los identificadores generados no entran, asi que dos sesiones coinciden', () => {
    // La MISMA pagina en dos sesiones distintas: cambia el contador del rotulo, el id por sesion, el
    // token por impresion y el estado del control. Nada de eso puede mover la identidad.
    const sesion = (n: number) => `
      <div id=":u${n}" data-ved="0ahUKEwi${n}">
        <button aria-label="Redactar" data-session-id="s_01JQ8Z9WQ2K${n}"
          data-state="${n === 1 ? 'idle' : 'hover'}">Redactar</button>
        <a href="/inbox" data-tracking-id="t-${n}0041">Bandeja de entrada (${n})</a>
      </div>`;
    expect(claseLeida(sesion(1), 'button')).toBe('click|rol:button|redactar');
    expect(claseLeida(sesion(2), 'button')).toBe('click|rol:button|redactar');
    // Y el control cuyo PROPIO rotulo lleva el contador se queda sin identidad en las dos sesiones,
    // que es la unica respuesta estable: con el contador dentro serian dos clases distintas para el
    // mismo control, y ninguna de las dos encontraria lo que la otra aprendio.
    expect(claseLeida(sesion(1), 'a')).toBeNull();
    expect(claseLeida(sesion(2), 'a')).toBeNull();
  });
});

/**
 * REGRESION DE PRODUCCION. Las clases reales del atlas son todas de mail.google.com y ninguna de las
 * dos plantillas publicadas es de otro sitio, asi que lo que estos casos fijan es que el fix NO
 * cambia de forma ni una sola de ellas: los controles de Gmail son unicos en su pagina (no hay
 * homonimo que desempatar) y sus nombres no llevan digitos.
 */
describe('regresion: los controles reales de mail.google.com conservan su clase', () => {
  const REDACTAR = `<div id=":qy" role="button" data-tooltip="Redactar" aria-label="Redactar">Redactar</div>`;
  const ENVIAR = `<div role="button" aria-label="Enviar ‪(Ctrl-Intro)‬" data-tooltip="Enviar">Enviar</div>`;
  const CAMPOS = `
    <input type="text" aria-label="Destinatarios en Para">
    <input type="text" aria-label="Asunto">
    <div role="textbox" aria-label="Cuerpo del mensaje"></div>`;

  it('redactar, enviar y los tres campos del redactor', () => {
    expect(claseLeida(REDACTAR, '[role="button"]')).toBe('click|rol:button|redactar');
    expect(claseLeida(ENVIAR, '[role="button"]')).toBe('click|rol:button|enviar (ctrl-intro)');
    expect(claseLeida(CAMPOS, '[aria-label="Destinatarios en Para"]', 'escribir')).toBe(
      'escribir|rol:textbox|destinatarios en para',
    );
    expect(claseLeida(CAMPOS, '[aria-label="Asunto"]', 'escribir')).toBe(
      'escribir|rol:textbox|asunto',
    );
    expect(claseLeida(CAMPOS, '[role="textbox"][aria-label="Cuerpo del mensaje"]', 'escribir')).toBe(
      'escribir|rol:textbox|cuerpo del mensaje',
    );
  });

  it('el eje de texto de la unica clase real que lo usa sigue siendo el mismo', () => {
    // click|texto|redactar: el nombre del control, no un dato de pagina. Sin rol accesible, para que
    // la derivacion caiga al eje de texto igual que cuando se aprendio.
    expect(claseLeida(`<div class="T-I">Redactar</div>`, '.T-I')).toBe('click|texto|redactar');
  });

  it('toda estrategia ya persistida (sin la medicion nueva) da EXACTAMENTE la clase de siempre', () => {
    // Es la razon por la que ninguna fila del atlas queda huerfana: la clase es funcion pura de las
    // estrategias, y las que ya estan guardadas no llevan desempate, o sea "el eje ya distingue".
    expect(claseDeElemento('click', [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }])).toBe(
      'click|rol:button|enviar',
    );
    expect(
      claseDeElemento('escribir', [
        { tipo: 'atributo', atributo: 'aria-label', valor: 'Destinatarios en Para' },
      ]),
    ).toBe('escribir|atributo:aria-label|destinatarios en para');
    expect(claseDeElemento('click', [{ tipo: 'texto', texto: 'Redactar' }])).toBe(
      'click|texto|redactar',
    );
  });
});
