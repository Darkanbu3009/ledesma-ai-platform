import { describe, it, expect } from 'vitest';
import { VALOR_CENSURADO } from '../src/censura.js';
import {
  expresionLeerEstrategias,
  expresionResolverElemento,
  leerElementoResuelto,
  parsearCombinacionDeTeclas,
  sanearEstrategias,
} from '../src/localizacion.js';

/**
 * LOCALIZACION de elementos sin modelo (CAMBIO 1 y 4). Lo que se testea aqui es la mitad que corre
 * en NUESTRO proceso: el saneado de lo que vuelve del navegador y la traduccion de teclas. La mitad
 * que corre dentro de la pagina se verifica por construccion (que la expresion lleve lo que debe).
 */

describe('sanearEstrategias (lo que vuelve del navegador no se cree a ciegas)', () => {
  it('acepta las estrategias validas, las deduplica y las ORDENA por el criterio de D1', () => {
    const saneadas = sanearEstrategias(
      JSON.stringify([
        { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
        { tipo: 'texto', texto: 'Enviar' },
        { tipo: 'atributo', atributo: 'id', valor: 'enviar' },
        { tipo: 'atributo', atributo: 'id', valor: 'enviar' },
      ]),
    );
    expect(saneadas.map((e) => e.tipo)).toEqual(['atributo', 'texto', 'xpath']);
  });

  it('descarta las estrategias que la censura toca (un dato sensible no se guarda como localizador)', () => {
    const saneadas = sanearEstrategias(
      JSON.stringify([
        { tipo: 'atributo', atributo: 'aria-label', valor: 'Numero de tarjeta 4111 1111 1111 1111' },
        { tipo: 'texto', texto: '4111111111111111' },
        { tipo: 'atributo', atributo: 'id', valor: 'campo-tarjeta' },
        { tipo: 'xpath', xpath: '/html[1]/body[1]/input[3]' },
      ]),
    );
    // El id sobrevive (es el nombre del campo, no su contenido); los que llevan el numero, no.
    expect(saneadas.map((e) => e.tipo)).toEqual(['xpath']);
    expect(JSON.stringify(saneadas)).not.toContain('4111');
  });

  it('descarta una estrategia cuyo valor ya venia con el marcador de censura', () => {
    expect(sanearEstrategias(JSON.stringify([{ tipo: 'texto', texto: VALOR_CENSURADO }]))).toEqual([]);
  });

  it('descarta atributos fuera de la lista cerrada y tipos desconocidos', () => {
    expect(
      sanearEstrategias(
        JSON.stringify([
          { tipo: 'atributo', atributo: 'onclick', valor: 'alert(1)' },
          { tipo: 'css', selector: 'div' },
        ]),
      ),
    ).toEqual([]);
  });

  it('nunca lanza: basura devuelve lista vacia', () => {
    expect(sanearEstrategias('no soy json')).toEqual([]);
    expect(sanearEstrategias('')).toEqual([]);
    expect(sanearEstrategias('{"tipo":"xpath"}')).toEqual([]);
  });
});

describe('leerElementoResuelto', () => {
  it('lee el punto, la estrategia que funciono y las estrategias actuales', () => {
    const resuelto = leerElementoResuelto(
      JSON.stringify({
        x: 120,
        y: 340,
        usada: 'atributo',
        estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      }),
    );
    expect(resuelto).toMatchObject({ x: 120, y: 340, usada: 'atributo' });
    expect(resuelto?.estrategias).toHaveLength(1);
  });

  it('devuelve null ante un JSON incompleto o con una estrategia inventada', () => {
    expect(leerElementoResuelto('')).toBeNull();
    expect(leerElementoResuelto(JSON.stringify({ x: 1, y: 2 }))).toBeNull();
    expect(leerElementoResuelto(JSON.stringify({ x: 1, y: 2, usada: 'magia' }))).toBeNull();
    expect(leerElementoResuelto(JSON.stringify({ x: 'a', y: 2, usada: 'xpath' }))).toBeNull();
  });
});

describe('expresiones que corren dentro de la pagina', () => {
  it('la lectura por xpath embebe el xpath ESCAPADO como literal, no concatenado', () => {
    const expresion = expresionLeerEstrategias({ tipo: 'xpath', xpath: `/html[1]/a"); alert(1);//` });
    expect(expresion).toContain(JSON.stringify(`/html[1]/a"); alert(1);//`));
    // La comilla cruda jamas queda suelta en el codigo que se evalua.
    expect(expresion).not.toContain(`porXpath("/html[1]/a");`);
  });

  it('la lectura por punto redondea las coordenadas (nunca inyecta texto)', () => {
    const expresion = expresionLeerEstrategias({ tipo: 'punto', x: 10.7, y: 20.2 });
    expect(expresion).toContain('document.elementFromPoint(11, 20)');
  });

  it('la resolucion embebe las estrategias como JSON EN EL ORDEN RECIBIDO (el orden persistido manda)', () => {
    const expresion = expresionResolverElemento([
      { tipo: 'rol', rol: 'button', nombre: 'Redactar' },
      { tipo: 'atributo', atributo: 'id', valor: ':u3' },
    ]);
    expect(expresion).toContain('JSON.parse(');
    // SIN reordenar: una promocion de la auto reparacion (el rol puesto de primaria) se respeta, y
    // el indice que devuelve la resolucion refiere a la lista tal como la guarda el paso.
    const especificacion = expresion.slice(expresion.indexOf('JSON.parse('));
    expect(especificacion.indexOf('rol')).toBeLessThan(especificacion.indexOf('atributo'));
    expect(expresion).toContain('porAtributo');
    expect(expresion).toContain('porRol');
    expect(expresion).toContain('porTexto');
    expect(expresion).toContain('porXpath');
    // La estrategia ganadora vuelve con su indice, insumo del registro de ganadoras.
    expect(expresion).toContain('indice: indice');
  });

  it('un elemento sin caja no cuenta como resuelto (no se hace click a ciegas)', () => {
    expect(expresionResolverElemento([])).toContain('caja.width > 0 && caja.height > 0');
  });
});

describe('parsearCombinacionDeTeclas', () => {
  it('traduce las teclas especiales y sus modificadores', () => {
    expect(parsearCombinacionDeTeclas('Enter')).toEqual({
      key: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 0,
      text: null,
    });
    expect(parsearCombinacionDeTeclas('Shift+Tab')).toMatchObject({ key: 'Tab', modifiers: 8 });
  });

  it('un atajo con Control no inserta texto; una letra sola si', () => {
    expect(parsearCombinacionDeTeclas('Control+a')).toMatchObject({ modifiers: 2, text: null });
    expect(parsearCombinacionDeTeclas('a')).toMatchObject({ modifiers: 0, text: 'a' });
  });

  it('devuelve null ante lo que no reconoce (una receta no pulsa cualquier cosa)', () => {
    expect(parsearCombinacionDeTeclas('rm -rf /')).toBeNull();
    expect(parsearCombinacionDeTeclas('Hyper+x')).toBeNull();
    expect(parsearCombinacionDeTeclas('')).toBeNull();
  });
});
