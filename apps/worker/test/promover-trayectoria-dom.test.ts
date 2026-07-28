import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import type { PasoTrayectoria, TrayectoriaConPasos } from '@ledesma-platform/backend/trayectorias';
import {
  ejecutarReceta,
  type EscaladorDePaso,
  type InstruccionDePaso,
  type NavegadorDeterminista,
  type ResultadoPasoDeterminista,
} from '../src/ejecutor-receta.js';
import { convertirTrayectoriaPersistida } from '../src/promover-trayectoria.js';
import type { ValoresDeParametros } from '../src/receta-web.js';

/**
 * LA RECETA DERIVADA DE UNA TRAYECTORIA PERSISTIDA, EJECUTADA POR EL EJECUTOR EXISTENTE sobre un DOM
 * simulado (jsdom). Cierra el circuito completo de "guardar como tarea aprendida":
 *  1. una trayectoria persistida estilo Gmail se convierte en receta (conversion pura);
 *  2. `ejecutarReceta` (el ejecutor real, sin tocar) la corre con parametros de OTRA corrida;
 *  3. el DOM termina con los valores nuevos tecleados, el boton de enviar clickeado UNA vez y la
 *     verificacion determinista consultada ANTES del click irreversible, sin llamadas al modelo.
 *
 * El navegador determinista de este test resuelve las estrategias DENTRO de la pagina (atributo,
 * texto y xpath sobre el DOM real de jsdom) y aplica el paso; el ejecutor no sabe que no hay CDP.
 */

const DOMINIO = 'mail.google.com';
const OBJETIVO_APRENDIDO =
  'envia un correo a martin@ejemplo.com con asunto "Reporte semanal" y cuerpo "Adjunto el resumen de la semana"';

const PAGINA = `<!doctype html><html><body>
  <div id="menu"><button id="redactar">Redactar</button></div>
  <div id="composer">
    <input aria-label="Para">
    <input name="subjectbox">
    <div aria-label="Cuerpo del mensaje"></div>
    <div role="button" aria-label="Enviar">Enviar</div>
  </div>
</body></html>`;

let siguienteId = 0;
function paso(
  idx: number,
  accion: { tipo: string; instruccion?: string | null; metodo?: string | null; argumentos?: string[] },
  extras: Partial<Pick<PasoTrayectoria, 'selector' | 'valorCensurado' | 'url' | 'exito'>> = {},
): PasoTrayectoria {
  siguienteId += 1;
  return {
    id: `paso-${siguienteId}`,
    idx,
    accion: {
      tipo: accion.tipo,
      instruccion: accion.instruccion ?? null,
      metodo: accion.metodo ?? null,
      argumentos: accion.argumentos ?? [],
    },
    selector: extras.selector ?? null,
    valorCensurado: extras.valorCensurado ?? null,
    url: extras.url ?? `https://${DOMINIO}/mail/u/0/`,
    exito: extras.exito ?? true,
    creadoEn: '2026-07-26T18:00:00.000Z',
  };
}

/** La trayectoria persistida cuyos selectores corresponden a la pagina simulada de arriba. */
function trayectoriaSobreLaPagina(): TrayectoriaConPasos {
  siguienteId = 0;
  return {
    id: 'tray-dom-1',
    ownerId: 'user-1',
    jobId: 'job-origen-1',
    connectionId: 'conn-1',
    dominio: DOMINIO,
    objetivo: OBJETIVO_APRENDIDO,
    estado: 'exitosa',
    iniciadaEn: '2026-07-26T18:00:00.000Z',
    terminadaEn: '2026-07-26T18:05:00.000Z',
    duracionMs: 300_000,
    tokensIn: 1000,
    tokensOut: 100,
    creadaEn: '2026-07-26T18:00:00.000Z',
    pasos: [
      paso(0, { tipo: 'goto' }, { url: `https://${DOMINIO}/` }),
      paso(1, { tipo: 'screenshot' }),
      // Xpath POSICIONAL puro (sin atributos): se resuelve con document.evaluate.
      paso(2, { tipo: 'act', instruccion: 'click en Redactar', metodo: 'click' }, {
        selector: 'xpath=/html[1]/body[1]/div[1]/button[1]',
      }),
      paso(3, { tipo: 'act', instruccion: 'escribir el destinatario', metodo: 'fill', argumentos: ['martin@ejemplo.com'] }, {
        selector: `xpath=/html[1]/body[1]/div[2]//input[@aria-label='Para']`,
        valorCensurado: 'martin@ejemplo.com',
      }),
      paso(4, { tipo: 'act', instruccion: 'escribir el asunto', metodo: 'fill', argumentos: ['Reporte semanal'] }, {
        selector: `xpath=/html[1]/body[1]/div[2]//input[@name='subjectbox']`,
        valorCensurado: 'Reporte semanal',
      }),
      paso(5, { tipo: 'act', instruccion: 'escribir el cuerpo', metodo: 'fill', argumentos: ['Adjunto el resumen de la semana'] }, {
        selector: `xpath=/html[1]/body[1]/div[2]//div[@aria-label='Cuerpo del mensaje']`,
        valorCensurado: 'Adjunto el resumen de la semana',
      }),
      paso(6, { tipo: 'verificacion', instruccion: 'verificacion previa: los datos coinciden' }),
      paso(7, { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click' }, {
        selector: `xpath=/html[1]/body[1]/div[2]//div[@aria-label='Enviar']`,
      }),
      paso(8, { tipo: 'done' }),
    ],
  };
}

/** La MISMA trayectoria, con el Tab que confirma el chip del destinatario tras escribirlo. */
function trayectoriaConTab(): TrayectoriaConPasos {
  const base = trayectoriaSobreLaPagina();
  const conTab = [
    ...base.pasos.slice(0, 4),
    paso(99, { tipo: 'act', instruccion: 'press Tab key to confirm the recipient', metodo: 'press', argumentos: ['Tab'] }, {
      selector: 'xpath=/html[1]/body[1]/div[32]/input[1]',
    }),
    ...base.pasos.slice(4),
  ].map((fila, idx) => ({ ...fila, idx }));
  return { ...base, pasos: conTab };
}

/**
 * Navegador determinista respaldado por la pagina jsdom: resuelve las estrategias en orden DENTRO
 * de la ventana y aplica la accion sobre el elemento resuelto. Nada de esto toca el ejecutor.
 */
function crearNavegadorSobreLaPagina(dom: JSDOM) {
  const navegaciones: string[] = [];
  function evaluarPaso(
    estrategias: EstrategiaLocalizacion[],
    accion: string,
    texto: string | null,
  ): { ok: boolean; indice: number | null } {
    const codigo = `(function () {
      const estrategias = ${JSON.stringify(estrategias)};
      function resolver() {
        for (let i = 0; i < estrategias.length; i++) {
          const e = estrategias[i];
          let el = null;
          if (e.tipo === 'atributo') {
            el = document.querySelector('[' + e.atributo + '="' + e.valor + '"]');
          } else if (e.tipo === 'xpath') {
            el = document.evaluate(e.xpath, document, null, 9, null).singleNodeValue;
          } else if (e.tipo === 'texto') {
            // El mas PROFUNDO con ese texto exacto, como el resolutor real: el ancestro tambien
            // contiene el texto y clicarlo caeria en otra zona.
            for (const c of document.querySelectorAll('*')) {
              if (!c.textContent || c.textContent.trim() !== e.texto) continue;
              let tieneHijoIgual = false;
              for (const h of c.querySelectorAll('*')) {
                if (h.textContent && h.textContent.trim() === e.texto) { tieneHijoIgual = true; break; }
              }
              if (!tieneHijoIgual) { el = c; break; }
            }
          }
          if (el) return { el: el, indice: i };
        }
        return { el: null, indice: null };
      }
      const r = resolver();
      if (!r.el) return JSON.stringify({ ok: false, indice: null });
      const accion = ${JSON.stringify(accion)};
      const texto = ${JSON.stringify(texto)};
      if (accion === 'click') r.el.click();
      if (accion === 'escribir') {
        if (r.el.tagName === 'INPUT' || r.el.tagName === 'TEXTAREA') r.el.value = texto;
        else r.el.textContent = texto;
      }
      return JSON.stringify({ ok: true, indice: r.indice });
    })()`;
    const crudo = dom.window.eval(codigo);
    if (typeof crudo !== 'string') throw new Error('la evaluacion no devolvio texto');
    return JSON.parse(crudo) as { ok: boolean; indice: number | null };
  }

  const pulsaciones: Array<{ teclas: string | null; sobreElFoco: boolean }> = [];
  const navegador: NavegadorDeterminista = {
    ejecutarPasoDeterminista: vi.fn(
      async (_sesion: string, instruccion: InstruccionDePaso): Promise<ResultadoPasoDeterminista> => {
        if (instruccion.accion === 'navegar') {
          navegaciones.push(instruccion.url ?? '');
          return { estado: 'ok', estrategias: [], detalle: null };
        }
        if (instruccion.accion === 'esperar') {
          return { estado: 'ok', estrategias: [], detalle: null };
        }
        // MISMA regla que el navegador real (browserbase.ts): una tecla cae sobre el elemento
        // ENFOCADO cuando el paso sigue a una escritura o no trae estrategias; en cualquier otro
        // caso hay que localizar el elemento antes de pulsar.
        if (instruccion.accion === 'teclas') {
          const sobreElFoco =
            instruccion.sobreElFoco === true || instruccion.estrategias.length === 0;
          if (!sobreElFoco && !evaluarPaso(instruccion.estrategias, 'click', null).ok) {
            return { estado: 'no_localizado', estrategias: [], detalle: 'sin elemento en la pagina' };
          }
          pulsaciones.push({ teclas: instruccion.teclas, sobreElFoco });
          return { estado: 'ok', estrategias: [], detalle: null };
        }
        const resultado = evaluarPaso(instruccion.estrategias, instruccion.accion, instruccion.texto);
        if (!resultado.ok) {
          return { estado: 'no_localizado', estrategias: [], detalle: 'sin elemento en la pagina' };
        }
        return { estado: 'ok', estrategias: [], indiceUsado: resultado.indice, detalle: null };
      },
    ),
    leerEstrategiasDeElemento: vi.fn(async () => []),
  };
  return { navegador, navegaciones, pulsaciones };
}

function makeEscalador(): EscaladorDePaso & { ejecutarPasoConModelo: ReturnType<typeof vi.fn> } {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({ ok: false, selector: null, tokensIn: null, tokensOut: null })),
  };
}

/** Lee un dato de la pagina simulada (para las aserciones y para el momento de la verificacion). */
function leer(dom: JSDOM, expresion: string): unknown {
  return dom.window.eval(expresion);
}

describe('la receta derivada corre con el ejecutor existente sobre un DOM simulado', () => {
  it('teclea los parametros de la corrida NUEVA, verifica antes de enviar y no llama al modelo', async () => {
    const conversion = convertirTrayectoriaPersistida([trayectoriaSobreLaPagina()]);
    expect(conversion.guardable).toBe(true);
    if (!conversion.guardable) return;

    const dom = new JSDOM(PAGINA, { url: `https://${DOMINIO}/`, runScripts: 'outside-only' });
    try {
      // Contadores dentro de la pagina: clicks reales sobre Redactar y Enviar.
      dom.window.eval(`
        document.getElementById('redactar').addEventListener('click', function () {
          document.body.setAttribute('data-redactado', '1');
        });
        document.querySelector('[aria-label="Enviar"]').addEventListener('click', function () {
          const previos = Number(document.body.getAttribute('data-enviados') || '0');
          document.body.setAttribute('data-enviados', String(previos + 1));
        });
      `);
      const { navegador, navegaciones } = crearNavegadorSobreLaPagina(dom);
      const escalador = makeEscalador();
      // La verificacion determinista se consulta con el correo YA escrito y ANTES de enviar: se
      // capta el estado de la pagina en ese momento exacto.
      let alVerificar: { para: unknown; enviados: unknown } | null = null;
      const verificar = vi.fn(async () => {
        alVerificar = {
          para: leer(dom, `document.querySelector('[aria-label="Para"]').value`),
          enviados: leer(dom, `document.body.getAttribute('data-enviados')`),
        };
        return { tipo: 'ejecutar' as const };
      });

      // Parametros de OTRA corrida: la receta aprendida con los datos de Martin teclea los nuevos.
      const valores: ValoresDeParametros = {
        destinatario: 'ana@otra.com',
        asunto: 'Cierre de mes',
        cuerpo: 'Adjunto el cierre contable',
      };
      const resultado = await ejecutarReceta(conversion.pasos, valores, {
        navegador,
        escalador,
        verificar,
        sesionExternaId: 'ses-1',
        apiKey: 'sk-owner',
        dominio: DOMINIO,
      });

      expect(resultado.desenlace).toEqual({ tipo: 'completada' });
      expect(escalador.ejecutarPasoConModelo).not.toHaveBeenCalled();
      expect(resultado.tokensIn).toBe(0);
      expect(navegaciones).toEqual([`https://${DOMINIO}/`]);
      expect(leer(dom, `document.body.getAttribute('data-redactado')`)).toBe('1');
      expect(leer(dom, `document.querySelector('[aria-label="Para"]').value`)).toBe('ana@otra.com');
      expect(leer(dom, `document.querySelector('[name="subjectbox"]').value`)).toBe('Cierre de mes');
      expect(leer(dom, `document.querySelector('[aria-label="Cuerpo del mensaje"]').textContent`)).toBe(
        'Adjunto el cierre contable',
      );
      // El envio ocurrio UNA sola vez, y la verificacion corrio con los datos puestos y sin enviar.
      expect(leer(dom, `document.body.getAttribute('data-enviados')`)).toBe('1');
      expect(verificar).toHaveBeenCalledTimes(1);
      expect(alVerificar).toEqual({ para: 'ana@otra.com', enviados: null });
    } finally {
      dom.window.close();
    }
  });

  it('el paso de teclas corre sobre el FOCO aunque su unica estrategia sea un xpath que ya no existe', async () => {
    // El caso de produccion de la receta 2017cfba: el Tab que confirma el destinatario quedo con UNA
    // sola estrategia, el xpath del compose de la corrida origen (div[32]), que en sesion fresca no
    // resuelve. Aqui la receta se fuerza a esa forma exacta y aun asi corre entera.
    const conversion = convertirTrayectoriaPersistida([trayectoriaConTab()]);
    expect(conversion.guardable).toBe(true);
    if (!conversion.guardable) return;
    const soloConXpathViejo = conversion.pasos.map((paso) =>
      paso.accion === 'teclas'
        ? { ...paso, estrategias: [{ tipo: 'xpath' as const, xpath: '/html[1]/body[1]/div[32]/input[1]' }] }
        : paso,
    );

    const dom = new JSDOM(PAGINA, { url: `https://${DOMINIO}/`, runScripts: 'outside-only' });
    try {
      const { navegador, pulsaciones } = crearNavegadorSobreLaPagina(dom);
      const escalador = makeEscalador();
      const resultado = await ejecutarReceta(
        soloConXpathViejo,
        { destinatario: 'ana@otra.com', asunto: 'Cierre de mes', cuerpo: 'Adjunto el cierre contable' },
        {
          navegador,
          escalador,
          verificar: vi.fn(async () => ({ tipo: 'ejecutar' as const })),
          sesionExternaId: 'ses-1',
          apiKey: 'sk-owner',
          dominio: DOMINIO,
        },
      );

      expect(resultado.desenlace).toEqual({ tipo: 'completada' });
      // Ni una escalada al motor: el Tab no necesito localizar nada.
      expect(escalador.ejecutarPasoConModelo).not.toHaveBeenCalled();
      expect(resultado.escalados).toBe(0);
      expect(pulsaciones).toEqual([{ teclas: 'Tab', sobreElFoco: true }]);
      expect(leer(dom, `document.querySelector('[aria-label="Para"]').value`)).toBe('ana@otra.com');
    } finally {
      dom.window.close();
    }
  });

  it('si el objetivo nuevo no declara un dato que la receta teclea, se abandona sin tocar la pagina', async () => {
    const conversion = convertirTrayectoriaPersistida([trayectoriaSobreLaPagina()]);
    expect(conversion.guardable).toBe(true);
    if (!conversion.guardable) return;

    const dom = new JSDOM(PAGINA, { url: `https://${DOMINIO}/`, runScripts: 'outside-only' });
    try {
      const { navegador } = crearNavegadorSobreLaPagina(dom);
      const resultado = await ejecutarReceta(
        conversion.pasos,
        { destinatario: 'ana@otra.com' },
        {
          navegador,
          escalador: makeEscalador(),
          verificar: vi.fn(async () => ({ tipo: 'ejecutar' as const })),
          sesionExternaId: 'ses-1',
          apiKey: 'sk-owner',
          dominio: DOMINIO,
        },
      );
      expect(resultado.desenlace.tipo).toBe('abandonada');
      expect(navegador.ejecutarPasoDeterminista).not.toHaveBeenCalled();
      expect(leer(dom, `document.querySelector('[aria-label="Para"]').value`)).toBe('');
    } finally {
      dom.window.close();
    }
  });
});
