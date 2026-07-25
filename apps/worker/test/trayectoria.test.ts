import { describe, it, expect } from 'vitest';
import { VALOR_CENSURADO } from '../src/censura.js';
import { extraerPasosCensurados, type AccionCrudaDeMotor } from '../src/trayectoria.js';

/**
 * Mapeo de acciones crudas del motor (AgentResult.actions de Stagehand v3) a pasos censurados de
 * pasos_trayectoria (V030). Las acciones sinteticas imitan las formas reales: 'act' con
 * playwrightArguments { selector, method, arguments }, tools sin elemento (goto/extract/scroll) y
 * shapes rotos (el mapeo jamas lanza).
 */
describe('extraerPasosCensurados', () => {
  it('mapea un act de click: selector, url, instruccion; sin valor tecleado', () => {
    const acciones: AccionCrudaDeMotor[] = [
      {
        type: 'act',
        action: 'click the Search button',
        pageUrl: 'https://en.wikipedia.org/',
        playwrightArguments: {
          selector: 'xpath=/html/body/div[1]/form/button',
          description: 'the search button',
          method: 'click',
          arguments: [],
        },
      },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(paso).toEqual({
      idx: 0,
      accion: {
        tipo: 'act',
        instruccion: 'click the Search button',
        metodo: 'click',
        argumentos: [],
      },
      selector: 'xpath=/html/body/div[1]/form/button',
      valorCensurado: null,
      // Sin observaciones no hay estrategias: la traza es la de siempre y esa corrida no se promueve.
      estrategias: [],
      url: 'https://en.wikipedia.org/',
      exito: true,
    });
  });

  it('un fill en un campo password: el argumento y el valor quedan CENSURADOS y la instruccion no filtra el secreto', () => {
    const acciones: AccionCrudaDeMotor[] = [
      {
        type: 'act',
        action: 'type hunter2 into the password field',
        pageUrl: 'https://example.com/login',
        playwrightArguments: {
          selector: 'xpath=//input[@type="password"]',
          description: 'the password input',
          method: 'fill',
          arguments: ['hunter2'],
        },
      },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(paso?.valorCensurado).toBe(VALOR_CENSURADO);
    expect(paso?.accion.argumentos).toEqual([VALOR_CENSURADO]);
    // La instruccion embebia el secreto: queda reemplazado, el resto del texto sobrevive.
    expect(paso?.accion.instruccion).toBe(`type ${VALOR_CENSURADO} into the password field`);
    expect(JSON.stringify(paso)).not.toContain('hunter2');
  });

  it('un numero de tarjeta tecleado en un campo generico queda censurado por su forma', () => {
    const acciones: AccionCrudaDeMotor[] = [
      {
        type: 'act',
        action: 'type 4111 1111 1111 1111 into the gift card field',
        playwrightArguments: {
          selector: 'xpath=//input[@id="gift"]',
          method: 'fill',
          arguments: ['4111 1111 1111 1111'],
        },
      },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(paso?.valorCensurado).toBe(VALOR_CENSURADO);
    expect(JSON.stringify(paso)).not.toContain('4111');
  });

  it('un valor inocente tecleado se conserva (sirve para promover a receta)', () => {
    const acciones: AccionCrudaDeMotor[] = [
      {
        type: 'act',
        action: 'type mexico city into the search box',
        playwrightArguments: {
          selector: 'xpath=//input[@name="search"]',
          method: 'fill',
          arguments: ['mexico city'],
        },
      },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(paso?.valorCensurado).toBe('mexico city');
    expect(paso?.accion.argumentos).toEqual(['mexico city']);
  });

  it('tools sin elemento (goto, extract) quedan sin selector ni valor, con su tipo e instruccion', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'goto', instruction: 'https://en.wikipedia.org/wiki/Mexico', pageUrl: 'https://en.wikipedia.org/' },
      { type: 'extract', pageUrl: 'https://en.wikipedia.org/wiki/Mexico' },
    ];
    const pasos = extraerPasosCensurados(acciones);
    expect(pasos[0]).toMatchObject({ idx: 0, selector: null, valorCensurado: null, accion: { tipo: 'goto' } });
    expect(pasos[1]).toMatchObject({ idx: 1, accion: { tipo: 'extract', instruccion: null } });
  });

  it('paso sintetico de fillForm SIN descripcion ni instruccion: el valor se censura entero (no se puede juzgar el campo)', () => {
    // mapFillFormToolResult de Stagehand emite acts sinteticos SOLO con playwrightArguments; el
    // selector xpath es estructural (cero semantica). Sin senal textual, criterio asimetrico.
    const acciones: AccionCrudaDeMotor[] = [
      {
        type: 'act',
        playwrightArguments: {
          selector: 'xpath=/html/body/div[2]/form/input[2]',
          method: 'fill',
          arguments: ['hunter2'],
        },
      },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(paso?.valorCensurado).toBe(VALOR_CENSURADO);
    expect(JSON.stringify(paso)).not.toContain('hunter2');
  });

  it('el scrub de la instruccion no distingue mayusculas (el modelo puede parafrasear la capitalizacion)', () => {
    const acciones: AccionCrudaDeMotor[] = [
      {
        type: 'act',
        action: 'type Hunter2 into the password field',
        playwrightArguments: {
          selector: 'xpath=//input[@type="password"]',
          description: 'the password input',
          method: 'fill',
          arguments: ['hunter2'],
        },
      },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(JSON.stringify(paso).toLowerCase()).not.toContain('hunter2');
  });

  it('la url del paso pierde query string y fragment (tokens y codigos viajan ahi)', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'act', action: 'click continue', pageUrl: 'https://example.com/reset?token=abc123#done' },
    ];
    const [paso] = extraerPasosCensurados(acciones);
    expect(paso?.url).toBe('https://example.com/reset');
    expect(JSON.stringify(paso)).not.toContain('abc123');
  });

  it('success false explicito marca el paso fallido; ausencia de success es exito', () => {
    const pasos = extraerPasosCensurados([
      { type: 'act', success: false },
      { type: 'act' },
    ]);
    expect(pasos[0]?.exito).toBe(false);
    expect(pasos[1]?.exito).toBe(true);
  });

  it('tolera shapes rotos sin lanzar (campos de tipos inesperados)', () => {
    const pasos = extraerPasosCensurados([
      { type: 42, action: { no: 'texto' }, playwrightArguments: 'no-es-objeto', pageUrl: null },
      {},
    ] as AccionCrudaDeMotor[]);
    expect(pasos).toHaveLength(2);
    expect(pasos[0]).toMatchObject({ accion: { tipo: 'desconocida' }, selector: null, url: null });
    expect(pasos[1]).toMatchObject({ idx: 1, accion: { tipo: 'desconocida' } });
  });
});

describe('enriquecimiento con observaciones del DOM (CAMBIO 1)', () => {
  const ATRIBUTO = { tipo: 'atributo', atributo: 'id', valor: 'enviar' } as const;
  const XPATH_OBSERVADO = { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' } as const;

  it('empareja por POSICION cuando hay una observacion por accion', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'goto', pageUrl: 'https://app.ejemplo.com/' },
      {
        type: 'act',
        action: 'click Enviar',
        playwrightArguments: { selector: 'xpath=/html/body/button', method: 'click', arguments: [] },
      },
    ];
    const pasos = extraerPasosCensurados(acciones, [
      { selector: null, estrategias: [] },
      { selector: 'xpath=/html/body/button', estrategias: [ATRIBUTO, XPATH_OBSERVADO] },
    ]);
    expect(pasos[0]?.estrategias).toEqual([]);
    expect(pasos[1]?.estrategias).toEqual([ATRIBUTO, XPATH_OBSERVADO]);
  });

  it('un paso por COORDENADAS (click sin playwrightArguments) recibe selector y metodo (CAMBIO 2)', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'click', describe: 'el boton azul de enviar', coordinates: [120, 340] },
    ];
    const pasos = extraerPasosCensurados(acciones, [
      { selector: XPATH_OBSERVADO.xpath, estrategias: [ATRIBUTO, XPATH_OBSERVADO] },
    ]);
    // Antes de este PR: selector null, metodo null -> paso irrepetible.
    expect(pasos[0]?.selector).toBe(XPATH_OBSERVADO.xpath);
    expect(pasos[0]?.accion.metodo).toBe('click');
    expect(pasos[0]?.estrategias).toEqual([ATRIBUTO, XPATH_OBSERVADO]);
  });

  it('un TYPE por coordenadas registra el texto tecleado, CENSURADO segun su descripcion', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'type', describe: 'campo de destinatario', text: 'ana@ejemplo.com', coordinates: [1, 2] },
      { type: 'type', describe: 'el campo de contrasena', text: 'hunter2', coordinates: [3, 4] },
    ];
    const pasos = extraerPasosCensurados(acciones, [
      { selector: null, estrategias: [] },
      { selector: null, estrategias: [] },
    ]);
    expect(pasos[0]?.valorCensurado).toBe('ana@ejemplo.com');
    // El contexto delata el campo sensible: el valor jamas se persiste.
    expect(pasos[1]?.valorCensurado).toBe(VALOR_CENSURADO);
  });

  it('con cantidades distintas empareja SOLO por selector inequivoco', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'fillForm' },
      { type: 'act', playwrightArguments: { selector: 'xpath=/a', method: 'fill', arguments: ['x'] } },
      { type: 'act', playwrightArguments: { selector: 'xpath=/b', method: 'fill', arguments: ['y'] } },
    ];
    const pasos = extraerPasosCensurados(acciones, [
      { selector: 'xpath=/b', estrategias: [ATRIBUTO] },
    ]);
    expect(pasos[1]?.estrategias).toEqual([]);
    expect(pasos[2]?.estrategias).toEqual([ATRIBUTO]);
  });

  it('un selector REPETIDO entre acciones no empareja: mejor sin estrategias que con las de otro', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'fillForm' },
      { type: 'act', playwrightArguments: { selector: 'xpath=/a', method: 'click', arguments: [] } },
      { type: 'act', playwrightArguments: { selector: 'xpath=/a', method: 'click', arguments: [] } },
    ];
    const pasos = extraerPasosCensurados(acciones, [{ selector: 'xpath=/a', estrategias: [ATRIBUTO] }]);
    expect(pasos.every((paso) => paso.estrategias.length === 0)).toBe(true);
  });

  it('sin observaciones la traza es EXACTAMENTE la de antes (nada cambia para quien no promueve)', () => {
    const acciones: AccionCrudaDeMotor[] = [
      { type: 'act', playwrightArguments: { selector: 'xpath=/a', method: 'click', arguments: [] } },
    ];
    expect(extraerPasosCensurados(acciones)[0]?.estrategias).toEqual([]);
  });
});
