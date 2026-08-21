import { describe, it, expect } from 'vitest';
import type { CodigoDeIntencion, EstrategiaLocalizacion, PasoDeReceta } from '@ledesma-platform/shared';
import { claveDelAtlas, claseDeElemento, hashDeOrigen } from '../src/atlas-sitios.js';
import {
  MAX_CLAVES_DE_MARCADORES,
  clavePlantillas,
  clavesDeMarcadoresContenidos,
  codigoDeIntencion,
  hashDeOrigenDePlantilla,
  identidadDeConsumo,
  plantillaDeLaCorrida,
} from '../src/plantillas-compartidas.js';
import { VERBOS_ACCION_BLOQUEADA } from '../src/prompt-tarea-web.js';

/**
 * PLANTILLAS COMPARTIDAS (V041), parte pura del worker.
 *
 * Tres cosas se fijan aqui y no deben poder cambiar en silencio:
 *  - el CODIGO DE INTENCION sale de la familia del verbo que el usuario escribio, y las tres copias de
 *    la lista de ocho (worker, shared y el CHECK de V041) siguen siendo la misma lista;
 *  - una tarea REVERSIBLE no produce plantilla, y no por convencion sino porque no hay codigo para
 *    ella;
 *  - el HASH de origen de plantillas es INCOMPARABLE con el del atlas para el mismo owner, que es lo
 *    que impide unir las dos tablas globales y reconstruir un patron de uso.
 */

const DOMINIO = 'mail.ejemplo.com';
const VAULT = 'a'.repeat(64);
const OWNER = 'user-1';

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
const XPATH: EstrategiaLocalizacion = { tipo: 'xpath', xpath: '/html[1]/body[1]/div[7]/div[3]' };

function paso(parcial: Partial<PasoDeReceta> & { idx: number }): PasoDeReceta {
  return {
    accion: 'click',
    dominio: null,
    estrategias: [],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...parcial,
  };
}

/** La receta de un envio de correo, con el cuerpo como LITERAL (el caso real: sin rotulo ni comillas). */
function recetaDeEnvio(): PasoDeReceta[] {
  return [
    paso({
      idx: 0,
      accion: 'escribir',
      estrategias: [ARIA_PARA],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    }),
    paso({
      idx: 1,
      accion: 'escribir',
      estrategias: [ROL_CUERPO],
      valor: { tipo: 'literal', texto: 'Adjunto el resumen de la semana' },
    }),
    paso({ idx: 2, accion: 'verificar' }),
    paso({ idx: 3, accion: 'click', estrategias: [ARIA_ENVIAR] }),
  ];
}

/** Las clases que el atlas tendria corroboradas para ese dominio, calculadas como las calcula el atlas. */
function clasesDeLaReceta(pasos: PasoDeReceta[]): Set<string> {
  const clases = new Set<string>();
  for (const p of pasos) {
    const clase = claseDeElemento(p.accion, p.estrategias);
    if (clase !== null) clases.add(clase);
  }
  return clases;
}

describe('codigoDeIntencion (la familia del verbo que escribio el usuario)', () => {
  it('mapea la forma canonica a su familia, en los dos idiomas', () => {
    expect(codigoDeIntencion('enviar')).toBe('enviar');
    expect(codigoDeIntencion('send')).toBe('enviar');
    expect(codigoDeIntencion('eliminar')).toBe('borrar');
    expect(codigoDeIntencion('delete')).toBe('borrar');
    expect(codigoDeIntencion('checkout')).toBe('comprar');
    expect(codigoDeIntencion('cancelar suscripcion')).toBe('cancelarSuscripcion');
  });

  it('sin verbo bloqueado NO hay codigo: una tarea reversible no tiene plantilla', () => {
    expect(codigoDeIntencion(null)).toBeNull();
  });

  it('un verbo que no esta en la tabla devuelve null (falla cerrada)', () => {
    expect(codigoDeIntencion('archivar')).toBeNull();
    expect(codigoDeIntencion('')).toBeNull();
  });

  it('TODA forma canonica de la tabla tiene su codigo: las tres listas no divergen', () => {
    for (const { verbo } of VERBOS_ACCION_BLOQUEADA) {
      expect(codigoDeIntencion(verbo), verbo).not.toBeNull();
    }
    // Y las ocho familias distintas estan todas cubiertas.
    const familias = new Set(VERBOS_ACCION_BLOQUEADA.map((v) => v.accion));
    expect(familias.size).toBe(8);
    const codigos = new Set(
      VERBOS_ACCION_BLOQUEADA.map((v) => codigoDeIntencion(v.verbo)).filter(
        (c): c is CodigoDeIntencion => c !== null,
      ),
    );
    expect(codigos.size).toBe(8);
  });
});

describe('el HASH de origen de plantillas es incomparable con el del atlas', () => {
  it('el MISMO owner produce hashes DISTINTOS en las dos tablas globales', () => {
    const delAtlas = hashDeOrigen(OWNER, claveDelAtlas({ vaultSecret: VAULT }));
    const dePlantillas = hashDeOrigenDePlantilla(OWNER, clavePlantillas({ vaultSecret: VAULT }));
    expect(dePlantillas).not.toBe(delAtlas);
    // Y no es que uno sea prefijo del otro ni una variante: son dos HMAC de 32 bytes sin relacion.
    expect(dePlantillas).toMatch(/^[0-9a-f]{64}$/);
    expect(delAtlas).toMatch(/^[0-9a-f]{64}$/);
    expect(dePlantillas.slice(0, 8)).not.toBe(delAtlas.slice(0, 8));
  });

  it('las dos CLAVES derivadas del mismo secreto tambien son distintas', () => {
    expect(clavePlantillas({ vaultSecret: VAULT })).not.toBe(claveDelAtlas({ vaultSecret: VAULT }));
  });

  it('un secreto dedicado del atlas no puede acercar los dos hashes', () => {
    const delAtlas = hashDeOrigen(
      OWNER,
      claveDelAtlas({ secretoDedicado: 'b'.repeat(64), vaultSecret: VAULT }),
    );
    expect(hashDeOrigenDePlantilla(OWNER, clavePlantillas({ vaultSecret: VAULT }))).not.toBe(delAtlas);
  });

  it('es estable para el mismo owner y distinto entre owners (cuenta DISTINTOS, no identifica)', () => {
    const clave = clavePlantillas({ vaultSecret: VAULT });
    expect(hashDeOrigenDePlantilla(OWNER, clave)).toBe(hashDeOrigenDePlantilla(OWNER, clave));
    expect(hashDeOrigenDePlantilla('user-2', clave)).not.toBe(hashDeOrigenDePlantilla(OWNER, clave));
    // Y de una sola via: el owner no aparece por ninguna parte dentro del hash.
    expect(hashDeOrigenDePlantilla(OWNER, clave)).not.toContain(OWNER);
  });
});

describe('plantillaDeLaCorrida', () => {
  const pasos = recetaDeEnvio();
  const clases = clasesDeLaReceta(pasos);

  it('arma la identidad completa de la plantilla a partir de lo que ya existe', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.dominiosClave).toBe(DOMINIO);
    expect(veredicto.plantilla.codigoDeIntencion).toBe('enviar');
    // El cuerpo viaja como RANURA, asi que no entra en la clave; el destinatario si.
    expect(veredicto.plantilla.marcadoresClave).toBe('destinatario');
    expect(veredicto.plantilla.pasos).toHaveLength(4);
  });

  it('calcula la clase de cada paso con la MISMA funcion que alimenta el atlas', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.pasos.map((p) => p.claseDeElemento)).toEqual([
      'escribir|atributo:aria-label|para',
      'escribir|rol:textbox|cuerpo del mensaje',
      null,
      'click|atributo:aria-label|enviar',
    ]);
  });

  it('el literal del cuerpo se publica como RANURA y el valor no viaja', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.pasos[1]?.valor).toEqual({
      tipo: 'ranura',
      clase: 'escribir|rol:textbox|cuerpo del mensaje',
    });
    expect(JSON.stringify(veredicto.plantilla)).not.toContain('Adjunto el resumen de la semana');
  });

  it('SIN verbo bloqueado no se produce ninguna plantilla', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: null,
      clasesCorroboradas: clases,
    });
    expect(veredicto).toEqual({
      publicable: false,
      motivo: 'sin_intencion_irreversible',
      idx: -1,
    });
  });

  it('sin ninguna clase corroborada no se publica nada (falla cerrada)', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: new Set<string>(),
    });
    expect(veredicto).toEqual({ publicable: false, motivo: 'clase_no_corroborada', idx: 0 });
  });

  it('el xpath que toda lectura del DOM agrega se DESCARTA, no rechaza la plantilla', () => {
    // La lectura real siempre agrega un xpath al final (localizacion.ts), asi que este es el caso
    // normal y no el raro: la plantilla se publica con la estrategia estructural y sin el xpath.
    const conXpath = recetaDeEnvio();
    conXpath[3] = paso({ idx: 3, accion: 'click', estrategias: [ARIA_ENVIAR, XPATH] });
    const veredicto = plantillaDeLaCorrida({
      pasos: conXpath,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clasesDeLaReceta(conXpath),
    });
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.pasos[3]?.estrategias).toEqual([ARIA_ENVIAR]);
    expect(JSON.stringify(veredicto.plantilla)).not.toContain('xpath');
  });

  it('un paso que SOLO se sabe encontrar por su xpath SI rechaza la plantilla entera', () => {
    const soloXpath = recetaDeEnvio();
    soloXpath[3] = paso({ idx: 3, accion: 'click', estrategias: [XPATH] });
    const veredicto = plantillaDeLaCorrida({
      pasos: soloXpath,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      // La clase la aporta el atlas: el paso la tiene, lo que no tiene es como encontrarse.
      clasesCorroboradas: new Set([...clasesDeLaReceta(recetaDeEnvio())]),
    });
    expect(veredicto).toEqual({ publicable: false, motivo: 'sin_identidad_estructural', idx: 3 });
  });

  it('el conjunto de dominios es ordenado y deduplicado, como la firma multisitio', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: ['tienda.ejemplo.com', DOMINIO, 'TIENDA.ejemplo.com'],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.dominiosClave).toBe('mail.ejemplo.com+tienda.ejemplo.com');
  });

  it('sin ningun dominio no hay identidad que publicar', () => {
    const veredicto = plantillaDeLaCorrida({
      pasos,
      dominio: DOMINIO,
      dominios: [],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
    expect(veredicto).toEqual({ publicable: false, motivo: 'sin_identidad_estructural', idx: -1 });
  });
});

describe('clavesDeMarcadoresContenidos (la CONTENCION del consumo)', () => {
  it('devuelve el conjunto declarado Y todos sus subconjuntos, sin repetir y ordenados', () => {
    expect(clavesDeMarcadoresContenidos(['cuerpo', 'destinatario'])).toEqual([
      '',
      'cuerpo',
      'cuerpo+destinatario',
      'destinatario',
    ]);
  });

  it('un objetivo sin datos declara solo la clave vacia (nunca una lista vacia)', () => {
    expect(clavesDeMarcadoresContenidos([])).toEqual(['']);
  });

  it('el conjunto declarado esta SIEMPRE dentro: declarar lo exacto sigue encontrando la plantilla', () => {
    const claves = clavesDeMarcadoresContenidos(['asunto', 'cuerpo', 'destinatario']);
    expect(claves).toContain('asunto+cuerpo+destinatario');
  });

  it('un dato de mas NO esconde a la plantilla que pide menos', () => {
    // El caso que rompia la igualdad exacta: el objetivo menciona ademas un monto.
    const claves = clavesDeMarcadoresContenidos(['asunto', 'cuerpo', 'destinatario', 'monto']);
    expect(claves).toContain('asunto+cuerpo+destinatario');
    expect(claves).toHaveLength(16);
  });

  it('el TOPE real es 2^9, y no depende de lo que el llamador mande', () => {
    const todos = clavesDeMarcadoresContenidos([
      'asunto',
      'cantidad',
      'cuerpo',
      'destinatario',
      'monto',
      'producto',
      'fecha',
      'lugar',
      'nombre',
    ]);
    expect(todos).toHaveLength(MAX_CLAVES_DE_MARCADORES);
    expect(MAX_CLAVES_DE_MARCADORES).toBe(512);
    // Un nombre que no es uno de los marcadores no puede hacer crecer la lista: se descarta.
    const conBasura = clavesDeMarcadoresContenidos([
      'destinatario',
      'contrasena',
      'tarjeta',
    ] as never);
    expect(conBasura).toEqual(['', 'destinatario']);
  });

  it('la identidad del consumo lleva la clave exacta Y las claves contenidas mas los omitibles', () => {
    const identidad = identidadDeConsumo({
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      marcadores: ['destinatario', 'cuerpo'],
    });
    expect(identidad).toEqual({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      // La clave exacta se conserva para el diagnostico: es lo que el objetivo declaro.
      marcadoresClave: 'cuerpo+destinatario',
      // D3b: los candidatos incluyen el marcador OMITIBLE 'asunto' aunque no este declarado: una
      // plantilla que ademas pide asunto se encuentra y su paso se omite, no se inventa.
      marcadoresPosibles: [
        '',
        'asunto',
        'asunto+cuerpo',
        'asunto+cuerpo+destinatario',
        'asunto+destinatario',
        'cuerpo',
        'cuerpo+destinatario',
        'destinatario',
      ],
    });
  });
});
