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
