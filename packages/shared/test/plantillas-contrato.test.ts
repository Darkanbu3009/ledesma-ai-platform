import { describe, it, expect } from 'vitest';
import {
  dominiosClave,
  esPublicable,
  marcadorDeRanura,
  marcadoresClave,
  marcadoresDePasosPublicables,
  parsearPasosPublicables,
  CODIGOS_DE_INTENCION,
  esCodigoDeIntencion,
  type EstrategiaLocalizacion,
  type PasoParaPublicar,
} from '../src/index.js';

/**
 * CONTRATO DE PLANTILLAS COMPARTIDAS (V041): la puerta de publicacion y el parser.
 *
 * Lo que estos tests protegen es UNA cosa: que nada de una persona pueda salir de aqui hacia una tabla
 * global. Los siete motivos de rechazo tienen cada uno su fixture, y el rechazo es siempre de la
 * plantilla COMPLETA (nunca "se salta el paso raro"), porque una plantilla a la que le falta un paso
 * ejecuta un procedimiento distinto del que alguien corroboro, y lo ejecuta en el navegador de un
 * tercero.
 *
 * Las CLASES de los fixtures son las derivadas de la evidencia de produccion de mail.google.com que el
 * propio repo documenta (aria-label "Redactar", "Para", "Cuerpo del mensaje", "Enviar"), no clases
 * inventadas: si el mapeo clase -> marcador se probara solo contra nombres imaginarios, no habria
 * ninguna garantia de que funcione con los que la plataforma ve de verdad.
 */

const DOMINIO = 'mail.ejemplo.com';

const CLASE_REDACTAR = 'click|atributo:aria-label|redactar';
const CLASE_PARA = 'escribir|atributo:aria-label|para';
const CLASE_ASUNTO = 'escribir|rol:textbox|asunto';
const CLASE_CUERPO = 'escribir|rol:textbox|cuerpo del mensaje';
const CLASE_ENVIAR = 'click|atributo:aria-label|enviar';
/** Clase perfectamente corroborada cuyo nombre NO corresponde a ningun marcador conocido. */
const CLASE_SIN_MARCADOR = 'escribir|rol:textbox|etiqueta interna';

const CORROBORADAS = new Set([
  CLASE_REDACTAR,
  CLASE_PARA,
  CLASE_ASUNTO,
  CLASE_CUERPO,
  CLASE_ENVIAR,
  CLASE_SIN_MARCADOR,
]);

const ARIA_REDACTAR: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Redactar',
};
const ARIA_PARA: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Para' };
const ROL_CUERPO: EstrategiaLocalizacion = {
  tipo: 'rol',
  rol: 'textbox',
  nombre: 'Cuerpo del mensaje',
};
const ARIA_ENVIAR: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Enviar',
};

function paso(parcial: Partial<PasoParaPublicar> & { idx: number }): PasoParaPublicar {
  return {
    accion: 'click',
    dominio: null,
    claseDeElemento: null,
    estrategias: [],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...parcial,
  };
}

/** El correo de Gmail completo: abrir, destinatario, asunto, cuerpo, verificar y enviar. */
function pasosDeUnCorreo(): PasoParaPublicar[] {
  return [
    paso({ idx: 0, accion: 'click', estrategias: [ARIA_REDACTAR], claseDeElemento: CLASE_REDACTAR }),
    paso({
      idx: 1,
      accion: 'escribir',
      estrategias: [ARIA_PARA],
      claseDeElemento: CLASE_PARA,
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    }),
    paso({ idx: 2, accion: 'teclas', teclas: 'Tab' }),
    paso({
      idx: 3,
      accion: 'escribir',
      estrategias: [{ tipo: 'rol', rol: 'textbox', nombre: 'Asunto' }],
      claseDeElemento: CLASE_ASUNTO,
      // El caso REAL: el objetivo no declaro el asunto con rotulo y comillas, asi que la receta lo
      // guardo como literal. Publicarse tiene que convertirlo en ranura.
      valor: { tipo: 'literal', texto: 'Reporte semanal' },
    }),
    paso({
      idx: 4,
      accion: 'escribir',
      estrategias: [ROL_CUERPO],
      claseDeElemento: CLASE_CUERPO,
      valor: { tipo: 'literal', texto: 'Adjunto el resumen de la semana' },
    }),
    paso({ idx: 5, accion: 'verificar' }),
    paso({ idx: 6, accion: 'click', estrategias: [ARIA_ENVIAR], claseDeElemento: CLASE_ENVIAR }),
  ];
}

describe('esPublicable: los SIETE motivos de rechazo, cada uno con su fixture', () => {
  it('1. literal_sin_marcador: un literal cuya clase no corresponde a ningun marcador', () => {
    const pasos = pasosDeUnCorreo();
    pasos[3] = paso({
      idx: 3,
      accion: 'escribir',
      estrategias: [{ tipo: 'rol', rol: 'textbox', nombre: 'Etiqueta interna' }],
      claseDeElemento: CLASE_SIN_MARCADOR,
      valor: { tipo: 'literal', texto: 'Reporte semanal' },
    });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto).toEqual({ publicable: false, motivo: 'literal_sin_marcador', idx: 3 });
  });

  it('2. localizador_de_sesion: un paso que SOLO se sabe encontrar por su xpath', () => {
    const pasos = pasosDeUnCorreo();
    pasos[6] = paso({
      idx: 6,
      accion: 'click',
      estrategias: [{ tipo: 'xpath', xpath: '/html[1]/body[1]/div[7]/div[3]' }],
      claseDeElemento: CLASE_ENVIAR,
    });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto).toEqual({ publicable: false, motivo: 'localizador_de_sesion', idx: 6 });
  });

  it('3. atributo_no_estructural: un paso que SOLO se sabe encontrar por su id o su name', () => {
    for (const atributo of ['id', 'name']) {
      const pasos = pasosDeUnCorreo();
      pasos[0] = paso({
        idx: 0,
        accion: 'click',
        estrategias: [{ tipo: 'atributo', atributo, valor: ':u3' }],
        claseDeElemento: CLASE_REDACTAR,
      });
      expect(esPublicable(pasos, DOMINIO, CORROBORADAS), atributo).toEqual({
        publicable: false,
        motivo: 'atributo_no_estructural',
        idx: 0,
      });
    }
  });

  it('4. sin_identidad_estructural: un paso que actua sobre un elemento y no declara clase', () => {
    const pasos = pasosDeUnCorreo();
    pasos[6] = paso({ idx: 6, accion: 'click', estrategias: [ARIA_ENVIAR], claseDeElemento: null });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto).toEqual({ publicable: false, motivo: 'sin_identidad_estructural', idx: 6 });
  });

  it('5. clase_no_corroborada: la clase existe pero el dominio no la tiene avalada', () => {
    const sinEnviar = new Set([...CORROBORADAS].filter((clase) => clase !== CLASE_ENVIAR));
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, sinEnviar);
    expect(veredicto).toEqual({ publicable: false, motivo: 'clase_no_corroborada', idx: 6 });
  });

  it('6. ruta_con_identificador: una navegacion que no sea el punto de entrada del sitio', () => {
    const conRuta = [
      ...pasosDeUnCorreo(),
      paso({ idx: 7, accion: 'navegar', ruta: '/mail/u/0/#inbox/FMfcgzQb1234567890' }),
    ];
    expect(esPublicable(conRuta, DOMINIO, CORROBORADAS)).toEqual({
      publicable: false,
      motivo: 'ruta_con_identificador',
      idx: 7,
    });
  });

  it('7. ranura_sin_marcador: una ranura ya armada cuya clase no mapea a ningun marcador', () => {
    const pasos = pasosDeUnCorreo();
    pasos[3] = paso({
      idx: 3,
      accion: 'escribir',
      estrategias: [{ tipo: 'rol', rol: 'textbox', nombre: 'Etiqueta interna' }],
      claseDeElemento: CLASE_SIN_MARCADOR,
      valor: { tipo: 'ranura', clase: 'escribir|rol:textbox|etiqueta interna' },
    });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto).toEqual({ publicable: false, motivo: 'ranura_sin_marcador', idx: 3 });
  });

  it('el rechazo es de la plantilla ENTERA: nunca devuelve los pasos que si pasaban', () => {
    const pasos = pasosDeUnCorreo();
    pasos[6] = paso({
      idx: 6,
      accion: 'click',
      estrategias: [{ tipo: 'xpath', xpath: '/html[1]/body[1]' }],
      claseDeElemento: CLASE_ENVIAR,
    });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(false);
    expect(veredicto).not.toHaveProperty('pasos');
  });
});

describe('esPublicable: los localizadores que no se publican pero no rechazan', () => {
  /**
   * El caso que MIDE por que la regla no puede ser "rechazar ante la sola presencia": la lectura del
   * DOM que alimenta toda receta AGREGA SIEMPRE un xpath y lee ademas id y name
   * (ATRIBUTOS_A_LEER y el push final de apps/worker/src/localizacion.ts). Con la regla estricta, TODO
   * paso de TODA receta traeria un xpath y no se publicaria jamas una sola plantilla.
   */
  function conLocalizadoresDeSesion() {
    const pasos = pasosDeUnCorreo();
    pasos[0] = paso({
      idx: 0,
      accion: 'click',
      claseDeElemento: CLASE_REDACTAR,
      estrategias: [
        ARIA_REDACTAR,
        { tipo: 'atributo', atributo: 'id', valor: ':u3' },
        { tipo: 'atributo', atributo: 'name', valor: 'compose-btn' },
        { tipo: 'texto', texto: 'Redactar' },
        { tipo: 'xpath', xpath: '/html[1]/body[1]/div[7]/div[3]' },
      ],
    });
    return pasos;
  }

  it('un paso con aria-label Y con xpath, id y name se publica: solo sobreviven los estructurales', () => {
    const veredicto = esPublicable(conLocalizadoresDeSesion(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.pasos[0]?.estrategias).toEqual([ARIA_REDACTAR, { tipo: 'texto', texto: 'Redactar' }]);
  });

  it('descartar una ESTRATEGIA no descarta el PASO: el procedimiento queda identico', () => {
    const conBasura = esPublicable(conLocalizadoresDeSesion(), DOMINIO, CORROBORADAS);
    const limpio = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(conBasura.publicable && limpio.publicable).toBe(true);
    if (!conBasura.publicable || !limpio.publicable) return;
    expect(conBasura.pasos.map((p) => [p.idx, p.accion, p.claseDeElemento, p.valor])).toEqual(
      limpio.pasos.map((p) => [p.idx, p.accion, p.claseDeElemento, p.valor]),
    );
  });

  it('el xpath, el id y el name NO aparecen en lo publicado, ni una vez', () => {
    const veredicto = esPublicable(conLocalizadoresDeSesion(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    const serializado = JSON.stringify(veredicto.pasos);
    expect(serializado).not.toContain('xpath');
    expect(serializado).not.toContain(':u3');
    expect(serializado).not.toContain('compose-btn');
    expect(serializado).not.toContain('"id"');
    expect(serializado).not.toContain('"name"');
  });

  it('un paso que no actua sobre un elemento se publica SIN localizadores', () => {
    const pasos = pasosDeUnCorreo();
    // Una pulsacion HEREDA en la receta las estrategias de la escritura anterior; publicarlas seria
    // compartir datos que el ejecutor no necesita (pulsa sobre el foco).
    pasos[2] = paso({ idx: 2, accion: 'teclas', teclas: 'Tab', estrategias: [ARIA_PARA] });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.pasos[2]).toMatchObject({ accion: 'teclas', teclas: 'Tab', estrategias: [] });
  });
});

describe('esPublicable: la RANURA, que es lo que hace viable el diseno', () => {
  it('un literal con clase corroborada se publica como ranura nombrada por la CLASE', () => {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    const escrituras = veredicto.pasos.filter((p) => p.accion === 'escribir');
    expect(escrituras.map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'ranura', clase: CLASE_ASUNTO },
      { tipo: 'ranura', clase: CLASE_CUERPO },
    ]);
  });

  it('la ranura NO lleva el valor: solo el nombre de la clase del campo', () => {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    const serializado = JSON.stringify(veredicto.pasos);
    expect(serializado).not.toContain('Reporte semanal');
    expect(serializado).not.toContain('Adjunto el resumen de la semana');
  });

  it('cada clase de produccion mapea al marcador que le corresponde', () => {
    expect(marcadorDeRanura(CLASE_ASUNTO)).toBe('asunto');
    expect(marcadorDeRanura(CLASE_CUERPO)).toBe('cuerpo');
    expect(marcadorDeRanura(CLASE_PARA)).toBe('destinatario');
    // El nombre real del campo Para de Gmail, con su sufijo: la comparacion es por PREFIJO.
    expect(marcadorDeRanura('escribir|atributo:aria-label|destinatarios en para')).toBe(
      'destinatario',
    );
    expect(marcadorDeRanura('escribir|rol:textbox|message body')).toBe('cuerpo');
    expect(marcadorDeRanura('escribir|rol:textbox|subject')).toBe('asunto');
  });

  it('FALLA CERRADA: una clase que no mapea a nada devuelve null, no una ranura anonima', () => {
    expect(marcadorDeRanura(CLASE_SIN_MARCADOR)).toBeNull();
    expect(marcadorDeRanura('sin separadores')).toBeNull();
    expect(marcadorDeRanura('click|rol:button|enviar')).toBeNull();
  });

  it('la tabla de ranuras es cerrada: los nombres mas especificos ganan', () => {
    // "cantidad a pagar" es dinero, no un numero de unidades.
    expect(marcadorDeRanura('escribir|rol:textbox|cantidad a pagar')).toBe('monto');
    expect(marcadorDeRanura('escribir|rol:textbox|cantidad')).toBe('cantidad');
  });
});

describe('esPublicable: una plantilla publicada no contiene NADA de una persona', () => {
  it('ni un valor, ni un xpath, ni una ruta, ni id o name como atributo', () => {
    const pasos = pasosDeUnCorreo();
    // La receta origen trae de todo: el xpath del compose de esa sesion, el id dinamico de Gmail y
    // los valores tecleados. Nada de eso puede sobrevivir a la puerta.
    pasos[1] = paso({
      idx: 1,
      accion: 'escribir',
      estrategias: [ARIA_PARA, { tipo: 'rol', rol: 'combobox', nombre: 'Destinatarios en Para' }],
      claseDeElemento: CLASE_PARA,
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    });
    const veredicto = esPublicable(pasos, DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    const serializado = JSON.stringify(veredicto.pasos);
    for (const prohibido of [
      'xpath',
      'ruta',
      'literal',
      '"id"',
      '"name"',
      ':u3',
      'Reporte semanal',
      'Adjunto el resumen de la semana',
      'martin@ejemplo.com',
      'owner',
      'firma',
      'descripcion',
    ]) {
      expect(serializado).not.toContain(prohibido);
    }
  });

  it('ningun paso publicado conserva el campo ruta ni una estrategia xpath', () => {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    for (const publicado of veredicto.pasos) {
      expect(publicado).not.toHaveProperty('ruta');
      // El TIPO ya excluye el xpath; lo que se comprueba aqui es que tampoco quede en el jsonb.
      expect(JSON.stringify(publicado)).not.toContain('xpath');
    }
  });

  it('la clase es obligatoria donde hay elemento y NULA donde no lo hay', () => {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    for (const publicado of veredicto.pasos) {
      if (publicado.accion === 'click' || publicado.accion === 'escribir') {
        expect(typeof publicado.claseDeElemento).toBe('string');
      } else {
        expect(publicado.claseDeElemento).toBeNull();
      }
    }
  });

  it('cada paso publicado dice en que dominio corre, sin depender de ninguna columna externa', () => {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.pasos.every((publicado) => publicado.dominio === DOMINIO)).toBe(true);
  });
});

describe('esPublicable: la navegacion', () => {
  it('la navegacion INICIAL a la raiz del sitio se descarta y renumera los pasos', () => {
    const conEntrada = [
      paso({ idx: 0, accion: 'navegar', ruta: '/' }),
      ...pasosDeUnCorreo().map((p, indice) => ({ ...p, idx: indice + 1 })),
    ];
    const veredicto = esPublicable(conEntrada, DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    // Siete pasos y numerados desde 0 sin huecos: la entrada descartada no deja hueco.
    expect(veredicto.pasos.map((p) => p.idx)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(veredicto.pasos)).not.toContain('navegar');
  });

  it('la raiz en CUALQUIER otra posicion SI rechaza: ahi el cambio de pagina es parte del flujo', () => {
    const enMedio = [
      ...pasosDeUnCorreo().slice(0, 3),
      paso({ idx: 3, accion: 'navegar', ruta: '/' }),
      ...pasosDeUnCorreo().slice(3).map((p, indice) => ({ ...p, idx: indice + 4 })),
    ];
    expect(esPublicable(enMedio, DOMINIO, CORROBORADAS)).toEqual({
      publicable: false,
      motivo: 'ruta_con_identificador',
      idx: 3,
    });
  });

  it('una navegacion inicial con ruta que no sea la raiz rechaza la plantilla', () => {
    const conRuta = [
      paso({ idx: 0, accion: 'navegar', ruta: '/mail/u/0' }),
      ...pasosDeUnCorreo().map((p, indice) => ({ ...p, idx: indice + 1 })),
    ];
    expect(esPublicable(conRuta, DOMINIO, CORROBORADAS)).toEqual({
      publicable: false,
      motivo: 'ruta_con_identificador',
      idx: 0,
    });
  });
});

describe('esPublicable: la SEGUNDA vuelta (la del backend) sobre lo ya publicado', () => {
  it('lo que sale de la puerta vuelve a pasar la puerta, con las clases del backend', () => {
    const primera = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(primera.publicable).toBe(true);
    if (!primera.publicable) return;
    const segunda = esPublicable(primera.pasos, DOMINIO, CORROBORADAS);
    expect(segunda.publicable).toBe(true);
    if (!segunda.publicable) return;
    // Idempotente: la segunda vuelta no cambia nada.
    expect(segunda.pasos).toEqual(primera.pasos);
  });

  it('sin ninguna clase corroborada la segunda vuelta rechaza: el estado seguro', () => {
    const primera = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(primera.publicable).toBe(true);
    if (!primera.publicable) return;
    const segunda = esPublicable(primera.pasos, DOMINIO, new Set<string>());
    expect(segunda).toEqual({ publicable: false, motivo: 'clase_no_corroborada', idx: 0 });
  });

  it('una plantilla vacia o con un dominio invalido no tiene identidad que publicar', () => {
    expect(esPublicable([], DOMINIO, CORROBORADAS)).toEqual({
      publicable: false,
      motivo: 'sin_identidad_estructural',
      idx: -1,
    });
    expect(esPublicable(pasosDeUnCorreo(), 'no-es-un-dominio', CORROBORADAS)).toEqual({
      publicable: false,
      motivo: 'sin_identidad_estructural',
      idx: -1,
    });
  });
});

describe('parsearPasosPublicables (lo que se lee del jsonb)', () => {
  function publicados() {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    if (!veredicto.publicable) throw new Error('el fixture tendria que ser publicable');
    return JSON.parse(JSON.stringify(veredicto.pasos)) as unknown[];
  }

  it('lee de vuelta exactamente lo que se escribio', () => {
    expect(parsearPasosPublicables(publicados())).toEqual(
      (esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS) as { pasos: unknown }).pasos,
    );
  });

  it('rechaza la plantilla ENTERA ante un solo paso invalido', () => {
    const casos: Array<[string, (pasos: Record<string, unknown>[]) => void]> = [
      ['un valor literal colado', (p) => void (p[3]!.valor = { tipo: 'literal', texto: 'x' })],
      [
        'una estrategia xpath',
        (p) => void (p[0]!.estrategias = [{ tipo: 'xpath', xpath: '/html[1]' }]),
      ],
      [
        'un atributo id',
        (p) => void (p[0]!.estrategias = [{ tipo: 'atributo', atributo: 'id', valor: ':u3' }]),
      ],
      ['una accion navegar', (p) => void (p[0]!.accion = 'navegar')],
      ['una ruta', (p) => void (p[0]!.ruta = '/mail/u/0')],
      ['una clase ausente donde hay elemento', (p) => void (p[0]!.claseDeElemento = null)],
      ['una clase declarada donde no hay elemento', (p) => void (p[5]!.claseDeElemento = 'x|y|z')],
      ['un dominio que no es un hostname', (p) => void (p[0]!.dominio = 'javascript:alert(1)')],
      ['un idx con hueco', (p) => void (p[2]!.idx = 9)],
      [
        'una ranura sin marcador',
        (p) => void (p[3]!.valor = { tipo: 'ranura', clase: 'escribir|rol:textbox|etiqueta' }),
      ],
    ];
    for (const [nombre, romper] of casos) {
      const pasos = publicados() as Record<string, unknown>[];
      romper(pasos);
      expect(parsearPasosPublicables(pasos), nombre).toBeNull();
    }
  });

  it('rechaza lo que no es un arreglo de pasos', () => {
    expect(parsearPasosPublicables(null)).toBeNull();
    expect(parsearPasosPublicables([])).toBeNull();
    expect(parsearPasosPublicables('[]')).toBeNull();
    expect(parsearPasosPublicables(Array.from({ length: 81 }, (_, idx) => ({ idx })))).toBeNull();
  });
});

describe('la IDENTIDAD de una plantilla', () => {
  it('dominios_clave es un CONJUNTO ordenado y deduplicado, no una lista', () => {
    expect(dominiosClave(['tienda.ejemplo.com', 'mail.ejemplo.com'])).toBe(
      'mail.ejemplo.com+tienda.ejemplo.com',
    );
    expect(dominiosClave(['mail.ejemplo.com', 'tienda.ejemplo.com'])).toBe(
      dominiosClave(['tienda.ejemplo.com', 'mail.ejemplo.com']),
    );
    expect(dominiosClave(['MAIL.ejemplo.com', 'mail.ejemplo.com'])).toBe('mail.ejemplo.com');
    // A diferencia de sufijoDeDominios, con UN dominio NO se vacia: aqui es una columna, no un sufijo.
    expect(dominiosClave(['mail.ejemplo.com'])).toBe('mail.ejemplo.com');
    expect(dominiosClave([])).toBe('');
  });

  it('marcadores_clave sale de los pasos y ordena alfabeticamente', () => {
    const veredicto = esPublicable(pasosDeUnCorreo(), DOMINIO, CORROBORADAS);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    // Solo el destinatario es `parametro`: el asunto y el cuerpo viajan como RANURA, y una ranura no
    // entra en la clave porque el consumidor no puede calcularla antes de tener la plantilla.
    expect(marcadoresDePasosPublicables(veredicto.pasos)).toEqual(['destinatario']);
    expect(marcadoresClave(marcadoresDePasosPublicables(veredicto.pasos))).toBe('destinatario');
  });

  it('marcadores_clave es cadena vacia cuando la plantilla no exige ningun dato', () => {
    expect(marcadoresClave([])).toBe('');
    expect(marcadoresClave(['monto', 'destinatario', 'monto'])).toBe('destinatario+monto');
  });

  it('los ocho codigos de intencion son los del CHECK de V041 y nada mas', () => {
    expect([...CODIGOS_DE_INTENCION]).toEqual([
      'enviar',
      'publicar',
      'borrar',
      'pagar',
      'transferir',
      'comprar',
      'firmar',
      'cancelarSuscripcion',
    ]);
    expect(esCodigoDeIntencion('enviar')).toBe(true);
    expect(esCodigoDeIntencion('cancelarSuscripcion')).toBe(true);
    // No existe codigo para una tarea reversible: no existe plantilla reversible.
    expect(esCodigoDeIntencion('leer')).toBe(false);
    expect(esCodigoDeIntencion('reversible')).toBe(false);
    expect(esCodigoDeIntencion(null)).toBe(false);
  });
});
