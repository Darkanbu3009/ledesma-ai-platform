import { describe, it, expect } from 'vitest';
import type { EstrategiaLocalizacion, PasoDeReceta } from '@ledesma-platform/shared';
import {
  bloqueDelMapa,
  claseDeElemento,
  claveDelAtlas,
  entradaDeAtlas,
  entradasDeCorridaLibre,
  entradasDeCorridaPorReceta,
  entradasServibles,
  esServible,
  estrategiasParaElAtlas,
  hashDeOrigen,
  MAX_LINEAS_MAPA,
  MAX_NOMBRE_ATLAS,
  parsearEntradaDelAtlas,
  pasosConEstrategiasPercibidas,
  pistasParaPaso,
  PREFIJO_MAPA,
  valoresTecleadosDeLaCorrida,
  type EntradaConocida,
} from '../src/atlas-sitios.js';
import type { PasoCensurado } from '../src/trayectoria.js';

/**
 * ATLAS DE SITIOS (V040), parte PURA. Estos tests fijan los cuatro invariantes innegociables del
 * aprendizaje colectivo, que son la razon por la que la funcionalidad puede estar activa sin flags:
 *
 *  1. ANONIMATO: lo que sale del agregador son tres campos (dominio, clase, estrategias) y ninguno
 *     puede llevar un valor del usuario ni nada que apunte a el.
 *  2. PISTA Y NO RECETA: lo probado aqui es que el atlas produce localizadores; nada de este modulo
 *     decide si una accion se ejecuta.
 *  3. CORROBORACION: una entrada de un solo origen se sirve a ese origen y a nadie mas.
 *  4. PARANOIA DE VALORES: una estrategia que coincide, total o parcialmente, con algo que se tecleo
 *     en la corrida no llega al atlas; y los nombres accesibles se truncan a 60.
 */

const CLAVE = claveDelAtlas({ vaultSecret: 'x'.repeat(32) });
const MIO = hashDeOrigen('owner-1', CLAVE);
const AJENO = hashDeOrigen('owner-2', CLAVE);

const ROL_ENVIAR: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Enviar' };
const ARIA_ENVIAR: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Enviar',
};
const ID_DINAMICO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'id', valor: ':u3' };
const XPATH: EstrategiaLocalizacion = { tipo: 'xpath', xpath: '/html[1]/body[1]/div[31]/button[1]' };

function pasoReceta(overrides: Partial<PasoDeReceta> = {}): PasoDeReceta {
  return {
    idx: 0,
    accion: 'click',
    dominio: null,
    estrategias: [ID_DINAMICO, ROL_ENVIAR, XPATH],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...overrides,
  };
}

function pasoTraza(overrides: Partial<PasoCensurado> = {}): PasoCensurado {
  return {
    idx: 0,
    accion: { tipo: 'act', instruccion: 'click en Enviar', metodo: 'click', argumentos: [] },
    selector: '/html[1]/body[1]/button[1]',
    valorCensurado: null,
    estrategias: [ROL_ENVIAR],
    url: null,
    exito: true,
    ...overrides,
  };
}

function conocida(overrides: Partial<EntradaConocida> = {}): EntradaConocida {
  return {
    claseDeElemento: 'click|rol:button|enviar',
    estrategias: [ROL_ENVIAR],
    corroboraciones: 1,
    origenesHash: [MIO],
    ...overrides,
  };
}

// -------------------------------------------------------------------------------------------------
// INVARIANTE 1: ANONIMATO ESTRUCTURAL
// -------------------------------------------------------------------------------------------------

describe('anonimato: lo que el agregador produce', () => {
  it('una entrada son EXACTAMENTE tres campos: dominio, clase y estrategias', () => {
    const entrada = entradaDeAtlas(
      { dominio: 'mail.ejemplo.com', accion: 'click', estrategias: [ROL_ENVIAR] },
      [],
    );
    expect(entrada).not.toBeNull();
    expect(Object.keys(entrada ?? {}).sort()).toEqual(['claseDeElemento', 'dominio', 'estrategias']);
  });

  it('nada de lo serializado contiene el owner, el job ni la trayectoria de origen', () => {
    const entradas = entradasDeCorridaPorReceta({
      dominio: 'mail.ejemplo.com',
      pasos: [pasoReceta()],
      ganadoras: [{ paso: 0, indice: 1 }],
      valores: [],
    });
    const serializado = JSON.stringify(entradas);
    expect(serializado).not.toContain('owner');
    expect(serializado).not.toContain('job');
    expect(serializado).not.toContain('trayectoria');
    expect(serializado).not.toContain('receta');
  });

  it('el xpath NUNCA entra: describe el DOM de una sesion, no la estructura del sitio', () => {
    const limpias = estrategiasParaElAtlas([XPATH, ROL_ENVIAR], []);
    expect(limpias).toEqual([ROL_ENVIAR]);
  });

  it('id y name quedan fuera aunque el contrato de recetas los admita (llevan valores por sesion)', () => {
    const limpias = estrategiasParaElAtlas(
      [ID_DINAMICO, { tipo: 'atributo', atributo: 'name', valor: 'to' }, ARIA_ENVIAR],
      [],
    );
    expect(limpias).toEqual([ARIA_ENVIAR]);
  });

  it('el hash de origen no es reversible ni comparable sin la clave, y es estable por owner', () => {
    expect(MIO).toMatch(/^[0-9a-f]{64}$/);
    expect(MIO).not.toContain('owner-1');
    expect(hashDeOrigen('owner-1', CLAVE)).toBe(MIO);
    expect(hashDeOrigen('owner-1', claveDelAtlas({ vaultSecret: 'y'.repeat(32) }))).not.toBe(MIO);
    expect(AJENO).not.toBe(MIO);
  });

  it('la clave derivada de la boveda no expone el secreto de la boveda', () => {
    const vaultSecret = 'z'.repeat(40);
    const clave = claveDelAtlas({ vaultSecret });
    expect(clave).not.toContain(vaultSecret);
    expect(clave).toMatch(/^[0-9a-f]{64}$/);
    // Un secreto dedicado manda sobre la derivacion.
    expect(claveDelAtlas({ secretoDedicado: 'dedicado', vaultSecret })).toBe('dedicado');
  });
});

// -------------------------------------------------------------------------------------------------
// INVARIANTE 4: PARANOIA DE VALORES Y TRUNCADO
// -------------------------------------------------------------------------------------------------

describe('paranoia de valores: nada que se haya tecleado llega al atlas', () => {
  it('descarta la estrategia cuyo nombre CONTIENE un valor tecleado de la corrida', () => {
    const sugerencia: EstrategiaLocalizacion = {
      tipo: 'rol',
      rol: 'option',
      nombre: 'martin@ejemplo.com martin@ejemplo.com',
    };
    const limpias = estrategiasParaElAtlas([sugerencia, ROL_ENVIAR], ['martin@ejemplo.com']);
    expect(limpias).toEqual([ROL_ENVIAR]);
  });

  it('descarta tambien la coincidencia PARCIAL en el otro sentido (la pista dentro del valor)', () => {
    const parcial: EstrategiaLocalizacion = { tipo: 'texto', texto: 'Pedido de 40 cajas' };
    expect(estrategiasParaElAtlas([parcial], ['Pedido de 40 cajas de tornillos'])).toEqual([]);
  });

  it('descarta una pista larga que SOLO al truncarla quedaria contenida en el valor tecleado', () => {
    const valor = 'compra doce cajas de tornillos de acero inoxidable para el taller de abajo';
    // El texto completo NO esta dentro del valor (le sobra la coletilla), pero sus primeros 60
    // caracteres SI: sin revisar las dos formas, el recorte colaria el dato del usuario.
    const largo: EstrategiaLocalizacion = {
      tipo: 'texto',
      texto: 'compra doce cajas de tornillos de acero inoxidable para el taller <<coletilla del sitio>>',
    };
    expect(largo.texto.slice(0, MAX_NOMBRE_ATLAS).length).toBe(MAX_NOMBRE_ATLAS);
    expect(estrategiasParaElAtlas([largo], [valor])).toEqual([]);
  });

  // CAMBIO DE COMPORTAMIENTO (fix de clase, desempate y privacidad): un texto que NO CABE en
  // MAX_NOMBRE_ATLAS ya no se RECORTA, se DESCARTA. Recortar guardaba un FRAGMENTO de lo que hubiera
  // en la pagina, que es como un texto visible que concatena las celdas de un registro ajeno a la
  // tarea entraba a una tabla global; un rotulo de control de verdad no necesita 60 caracteres.
  it('lo que no cabe en 60 caracteres NO se recorta: no entra', () => {
    const largo = 'A'.repeat(200);
    expect(
      estrategiasParaElAtlas(
        [
          { tipo: 'rol', rol: 'button', nombre: largo },
          { tipo: 'texto', texto: largo },
          { tipo: 'atributo', atributo: 'data-testid', valor: largo },
        ],
        [],
      ),
    ).toEqual([]);
    // Y lo que cabe entra tal cual, sin tocar: el tope es de admision, no de recorte.
    const justo = 'A'.repeat(MAX_NOMBRE_ATLAS);
    expect(estrategiasParaElAtlas([{ tipo: 'rol', rol: 'button', nombre: justo }], [])).toEqual([
      { tipo: 'rol', rol: 'button', nombre: justo },
    ]);
  });

  it('sin ninguna estrategia utilizable NO se produce entrada (el atlas prefiere no saber)', () => {
    expect(
      entradaDeAtlas({ dominio: 'mail.ejemplo.com', accion: 'click', estrategias: [XPATH] }, []),
    ).toBeNull();
  });

  it('reune los valores de la corrida: los parametros del objetivo Y lo que tecleo la traza', () => {
    const valores = valoresTecleadosDeLaCorrida({ destinatario: 'ana@ejemplo.com' }, [
      pasoTraza({
        accion: { tipo: 'act', instruccion: 'escribe', metodo: 'fill', argumentos: ['Hola Ana'] },
      }),
    ]);
    expect(valores).toEqual(['ana@ejemplo.com', 'Hola Ana']);
  });
});

// -------------------------------------------------------------------------------------------------
// CLASE DE ELEMENTO: la identidad que comparten los dos caminos
// -------------------------------------------------------------------------------------------------

describe('clase de elemento', () => {
  it('prefiere el rol accesible con su nombre normalizado', () => {
    expect(claseDeElemento('click', [ROL_ENVIAR])).toBe('click|rol:button|enviar');
    expect(claseDeElemento('escribir', [{ tipo: 'rol', rol: 'textbox', nombre: 'Para' }])).toBe(
      'escribir|rol:textbox|para',
    );
  });

  it('normaliza acentos, mayusculas y espacios para que dos usuarios produzcan la MISMA clase', () => {
    expect(claseDeElemento('click', [{ tipo: 'rol', rol: 'button', nombre: '  Añadir   Más ' }])).toBe(
      claseDeElemento('click', [{ tipo: 'rol', rol: 'button', nombre: 'anadir mas' }]),
    );
  });

  it('cae al atributo del autor y despues al texto visible', () => {
    expect(claseDeElemento('click', [ARIA_ENVIAR])).toBe('click|atributo:aria-label|enviar');
    expect(claseDeElemento('click', [{ tipo: 'texto', texto: 'Redactar' }])).toBe(
      'click|texto|redactar',
    );
  });

  it('sin rol, sin atributo del autor y sin texto NO hay clase', () => {
    expect(claseDeElemento('click', [ID_DINAMICO, XPATH])).toBeNull();
  });

  it('una accion que no toca un elemento no tiene clase', () => {
    expect(claseDeElemento('navegar', [ROL_ENVIAR])).toBeNull();
    expect(claseDeElemento('verificar', [ROL_ENVIAR])).toBeNull();
  });

  /**
   * NO MIGRACION (FIX A). Las clases que el atlas ya tiene escritas son las SEIS de la corrida de
   * referencia de Gmail (plantillas-motor-libre.test.ts). Normalizar las marcas de direccion cambia
   * la forma de una clase SOLO si su nombre las lleva dentro, y ninguna de estas las lleva: se
   * reconstruyen aqui desde sus nombres reales y tienen que dar EXACTAMENTE la misma cadena que hoy.
   */
  it('las SEIS clases que el atlas ya tiene escritas no cambian de forma', () => {
    const yaEscritas: Array<[string, string | null]> = [
      ['click|rol:button|redactar', claseDeElemento('click', [{ tipo: 'rol', rol: 'button', nombre: 'Redactar' }])],
      [
        'click|atributo:aria-label|destinatarios en para',
        claseDeElemento('click', [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Destinatarios en Para' }]),
      ],
      [
        'escribir|atributo:aria-label|destinatarios en para',
        claseDeElemento('escribir', [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Destinatarios en Para' }]),
      ],
      [
        'escribir|atributo:aria-label|asunto',
        claseDeElemento('escribir', [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Asunto' }]),
      ],
      [
        'escribir|atributo:aria-label|cuerpo del mensaje',
        claseDeElemento('escribir', [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Cuerpo del mensaje' }]),
      ],
      [
        'click|atributo:aria-label|enviar',
        claseDeElemento('click', [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' }]),
      ],
    ];
    for (const [escrita, reconstruida] of yaEscritas) {
      expect(reconstruida, escrita).toBe(escrita);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// AGREGADOR: los dos caminos producen entradas comparables
// -------------------------------------------------------------------------------------------------

describe('agregador', () => {
  it('camino por receta: la estrategia GANADORA encabeza la lista rankeada', () => {
    const entradas = entradasDeCorridaPorReceta({
      dominio: 'mail.ejemplo.com',
      pasos: [pasoReceta()],
      ganadoras: [{ paso: 0, indice: 1 }],
      valores: [],
    });
    expect(entradas).toEqual([
      {
        dominio: 'mail.ejemplo.com',
        claseDeElemento: 'click|rol:button|enviar',
        estrategias: [ROL_ENVIAR],
      },
    ]);
  });

  it('camino por receta: un paso sin ganadora (escalado al motor) no aporta nada', () => {
    expect(
      entradasDeCorridaPorReceta({
        dominio: 'mail.ejemplo.com',
        pasos: [pasoReceta()],
        ganadoras: [],
        valores: [],
      }),
    ).toEqual([]);
  });

  it('camino por receta: cada paso aporta al dominio que declara (multisitio)', () => {
    const entradas = entradasDeCorridaPorReceta({
      dominio: 'mail.ejemplo.com',
      pasos: [pasoReceta({ dominio: 'tienda.ejemplo.com' })],
      ganadoras: [{ paso: 0, indice: 1 }],
      valores: [],
    });
    expect(entradas[0]?.dominio).toBe('tienda.ejemplo.com');
  });

  it('camino libre: solo los pasos EXITOSOS con estrategias, con la misma clase que la receta', () => {
    const entradas = entradasDeCorridaLibre({
      dominio: 'mail.ejemplo.com',
      pasos: [
        pasoTraza(),
        pasoTraza({ idx: 1, exito: false }),
        pasoTraza({ idx: 2, estrategias: [] }),
        pasoTraza({
          idx: 3,
          accion: { tipo: 'extract', instruccion: null, metodo: null, argumentos: [] },
        }),
      ],
      valores: [],
    });
    expect(entradas).toEqual([
      {
        dominio: 'mail.ejemplo.com',
        claseDeElemento: 'click|rol:button|enviar',
        estrategias: [ROL_ENVIAR],
      },
    ]);
  });

  it('camino libre: una escritura entra como clase de escritura, no de click', () => {
    const entradas = entradasDeCorridaLibre({
      dominio: 'mail.ejemplo.com',
      pasos: [
        pasoTraza({
          accion: { tipo: 'act', instruccion: 'escribe', metodo: 'fill', argumentos: ['hola'] },
          estrategias: [{ tipo: 'rol', rol: 'textbox', nombre: 'Para' }],
        }),
      ],
      valores: [],
    });
    expect(entradas[0]?.claseDeElemento).toBe('escribir|rol:textbox|para');
  });

  it('no repite la misma estructura dos veces en la misma corrida', () => {
    const entradas = entradasDeCorridaLibre({
      dominio: 'mail.ejemplo.com',
      pasos: [pasoTraza(), pasoTraza({ idx: 1 })],
      valores: [],
    });
    expect(entradas).toHaveLength(1);
  });

  it('las estrategias que leyo la PERCEPCION llegan al agregador sin cambiarle la logica', () => {
    const pasos = [pasoTraza({ estrategias: [], estrategiasPercibidas: [ROL_ENVIAR] })];
    // Tal como llegan (campo aparte), el agregador no ve nada: es lo que garantiza que la promocion
    // a receta tampoco vea nada nuevo.
    expect(entradasDeCorridaLibre({ dominio: 'mail.ejemplo.com', pasos, valores: [] })).toEqual([]);
    expect(
      entradasDeCorridaLibre({
        dominio: 'mail.ejemplo.com',
        pasos: pasosConEstrategiasPercibidas(pasos),
        valores: [],
      }),
    ).toEqual([
      {
        dominio: 'mail.ejemplo.com',
        claseDeElemento: 'click|rol:button|enviar',
        estrategias: [ROL_ENVIAR],
      },
    ]);
  });

  it('un paso que YA traia estrategias (observador encendido) se deja intacto', () => {
    const pasos = [pasoTraza({ estrategias: [ARIA_ENVIAR], estrategiasPercibidas: [ROL_ENVIAR] })];
    expect(pasosConEstrategiasPercibidas(pasos)[0]?.estrategias).toEqual([ARIA_ENVIAR]);
  });

  it('la paranoia de valores se aplica igual a lo que leyo la percepcion', () => {
    const pasos = pasosConEstrategiasPercibidas([
      pasoTraza({
        accion: { tipo: 'act', instruccion: 'escribe', metodo: 'fill', argumentos: ['Enviar todo'] },
        estrategias: [],
        estrategiasPercibidas: [ROL_ENVIAR],
      }),
    ]);
    // 'Enviar' esta CONTENIDO en el valor tecleado: la estrategia se cae y no queda entrada.
    expect(
      entradasDeCorridaLibre({ dominio: 'mail.ejemplo.com', pasos, valores: ['Enviar todo'] }),
    ).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// INVARIANTE 3: UMBRAL DE CORROBORACION
// -------------------------------------------------------------------------------------------------

describe('umbral de corroboracion', () => {
  it('una entrada de UN solo origen se sirve a ese origen y NO a otro', () => {
    const entrada = conocida({ origenesHash: [MIO] });
    expect(esServible(entrada, MIO)).toBe(true);
    expect(esServible(entrada, AJENO)).toBe(false);
  });

  it('con DOS origenes distintos se sirve a cualquiera, tambien a uno que no la produjo', () => {
    const entrada = conocida({ origenesHash: [MIO, AJENO] });
    expect(esServible(entrada, hashDeOrigen('owner-3', CLAVE))).toBe(true);
  });

  it('muchas corridas del MISMO origen no alcanzan el umbral: lo que cuenta son origenes DISTINTOS', () => {
    const entrada = parsearEntradaDelAtlas({
      claseDeElemento: 'click|rol:button|enviar',
      estrategias: [ROL_ENVIAR],
      corroboraciones: 25,
      origenesHash: [MIO, MIO, MIO],
    });
    expect(entrada?.origenesHash).toEqual([MIO]);
    expect(esServible(entrada as EntradaConocida, AJENO)).toBe(false);
  });

  it('entradasServibles filtra por origen y descarta las corruptas sin tumbar el resto', () => {
    const servibles = entradasServibles(
      [
        {
          claseDeElemento: 'click|rol:button|enviar',
          estrategias: [ROL_ENVIAR],
          corroboraciones: 3,
          origenesHash: [MIO, AJENO],
        },
        {
          claseDeElemento: 'click|rol:button|borrar',
          estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Borrar' }],
          corroboraciones: 1,
          origenesHash: [AJENO],
        },
        { claseDeElemento: '', estrategias: 'basura', corroboraciones: 9, origenesHash: null },
      ],
      MIO,
    );
    expect(servibles.map((entrada) => entrada.claseDeElemento)).toEqual(['click|rol:button|enviar']);
  });

  it('al leer se revalidan los tipos admitidos: un xpath guardado a mano no se sirve', () => {
    expect(
      parsearEntradaDelAtlas({
        claseDeElemento: 'click|rol:button|enviar',
        estrategias: [XPATH],
        corroboraciones: 5,
        origenesHash: [MIO, AJENO],
      }),
    ).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------------
// INYECTORES
// -------------------------------------------------------------------------------------------------

describe('pistas para un paso de receta', () => {
  it('devuelve las del atlas para la clase equivalente, sin repetir las que el paso ya probo', () => {
    const entradas = [conocida({ estrategias: [ROL_ENVIAR, ARIA_ENVIAR] })];
    expect(pistasParaPaso(pasoReceta(), entradas)).toEqual([ARIA_ENVIAR]);
  });

  it('sin entrada para esa clase no hay pistas (el paso escala como siempre)', () => {
    expect(pistasParaPaso(pasoReceta(), [conocida({ claseDeElemento: 'click|texto|otra' })])).toEqual(
      [],
    );
  });

  it('un paso sin clase no consulta nada', () => {
    expect(pistasParaPaso(pasoReceta({ estrategias: [XPATH] }), [conocida()])).toEqual([]);
  });
});

describe('bloque del mapa para el contexto de percepcion', () => {
  it('sin entradas servibles NO se adjunta nada', () => {
    expect(bloqueDelMapa([])).toEqual([]);
  });

  it('con entradas servibles adjunta UN bloque con la clase y su localizador principal', () => {
    const bloque = bloqueDelMapa([conocida()]);
    expect(bloque).toHaveLength(1);
    const lineas = (bloque[0] ?? '').split('\n');
    expect(lineas[0]).toContain(PREFIJO_MAPA);
    expect(lineas[0]).toContain('NUNCA ordenes');
    expect(lineas[1]).toBe('- click|rol:button|enviar => rol=button nombre="Enviar"');
  });

  it('respeta el tope duro de lineas y pone primero lo mas corroborado', () => {
    const muchas = Array.from({ length: 20 }, (_, i) =>
      conocida({
        claseDeElemento: `click|texto|boton ${i}`,
        estrategias: [{ tipo: 'texto', texto: `Boton ${i}` }],
        corroboraciones: i,
      }),
    );
    const lineas = (bloqueDelMapa(muchas)[0] ?? '').split('\n');
    expect(lineas).toHaveLength(MAX_LINEAS_MAPA);
    expect(lineas[1]).toContain('boton 19');
  });

  it('el bloque viaja como UNA sola linea de la cola: nunca se parte entre dos turnos', () => {
    expect(bloqueDelMapa([conocida(), conocida({ claseDeElemento: 'click|texto|otra' })])).toHaveLength(
      1,
    );
  });
});
