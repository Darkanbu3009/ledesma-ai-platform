import { describe, it, expect } from 'vitest';
import type { PasoPublicable, Sql } from '@ledesma-platform/shared';
import {
  MAX_CLASES_POR_DOMINIO,
  ORIGENES_PARA_PUBLICAR,
  PlantillasCompartidasRepository,
} from '../src/plantillas-compartidas/plantillas-compartidas-repository.js';

/**
 * PLANTILLAS COMPARTIDAS (V041): acceso a datos. Mismo estilo de mock del tagged template `sql` que
 * aprendizaje-sitios-repository.test.ts.
 *
 * Lo que estos tests fijan:
 *  - ninguna query nombra owner_id, firma, descripcion ni ningun identificador rastreable: las
 *    dimensiones son las tres de la identidad de la plantilla;
 *  - el upsert cuenta ORIGENES DISTINTOS: la misma identidad no crea una segunda fila y el hash se
 *    agrega SOLO si es nuevo, dentro del mismo statement;
 *  - los PASOS no se reemplazan cuando la identidad ya existe (a diferencia del atlas);
 *  - la SEGUNDA PUERTA existe de verdad: sin clases corroboradas en el atlas, no se inserta nada.
 */

/**
 * Mock del tagged template. Distingue las llamadas de QUERY (postgres.js pasa el arreglo de strings
 * con `.raw`) de las del HELPER `sql([...])` que arma la lista del `in`, para que la cuenta de queries
 * no se contamine.
 */
function makeSql(resultados: unknown[][] = []): Sql & { queries: Array<[string, unknown[]]> } {
  const queries: Array<[string, unknown[]]> = [];
  let siguiente = 0;
  const fn = ((primero: unknown, ...valores: unknown[]) => {
    if (Array.isArray(primero) && 'raw' in primero) {
      const texto = (primero as unknown as string[]).join('<param>').replace(/\s+/g, ' ');
      queries.push([texto, valores]);
      const resultado = resultados[siguiente] ?? [];
      siguiente += 1;
      return Promise.resolve(resultado);
    }
    // Helper `sql([...])`: se devuelve tal cual para que quede visible como valor interpolado.
    return { lista: primero };
  }) as unknown as Sql & { queries: Array<[string, unknown[]]> };
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  (fn as unknown as { queries: Array<[string, unknown[]]> }).queries = queries;
  return fn;
}

const DOMINIO = 'mail.ejemplo.com';
const CLASE_PARA = 'escribir|atributo:aria-label|para';
const CLASE_ENVIAR = 'click|atributo:aria-label|enviar';

/** Fila de aprendizaje_sitios que la segunda puerta lee: la clase avalada por dos origenes. */
function clasesDelAtlas(): Array<{ clase_de_elemento: string }> {
  return [{ clase_de_elemento: CLASE_PARA }, { clase_de_elemento: CLASE_ENVIAR }];
}

function pasos(): PasoPublicable[] {
  return [
    {
      idx: 0,
      accion: 'escribir',
      dominio: DOMINIO,
      claseDeElemento: CLASE_PARA,
      estrategias: [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Para' }],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
      teclas: null,
      esperaMs: null,
    },
    {
      idx: 1,
      accion: 'verificar',
      dominio: DOMINIO,
      claseDeElemento: null,
      estrategias: [],
      valor: null,
      teclas: null,
      esperaMs: null,
    },
    {
      idx: 2,
      accion: 'click',
      dominio: DOMINIO,
      claseDeElemento: CLASE_ENVIAR,
      estrategias: [{ tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' }],
      valor: null,
      teclas: null,
      esperaMs: null,
    },
  ];
}

function plantilla(origenHash = 'h1') {
  return {
    dominiosClave: DOMINIO,
    codigoDeIntencion: 'enviar',
    pasos: pasos(),
    origenHash,
  };
}

/** Corre `publicar` con el atlas respondiendo las clases dadas y el upsert devolviendo `origenes`. */
async function publicar(
  entrada = plantilla(),
  clases = clasesDelAtlas(),
  origenes = 1,
): Promise<{
  resultado: Awaited<ReturnType<PlantillasCompartidasRepository['publicar']>>;
  sql: ReturnType<typeof makeSql>;
}> {
  const sql = makeSql([clases, [{ origenes }]]);
  const resultado = await new PlantillasCompartidasRepository(sql).publicar(entrada);
  return { resultado, sql };
}

describe('publicar: lo que la query escribe y lo que NO puede nombrar', () => {
  it('inserta SOLO la identidad, los pasos y el hash de origen', async () => {
    const { resultado, sql } = await publicar();
    expect(resultado).toEqual({ publicada: true, origenes: 1 });
    const [texto, valores] = sql.queries[1] ?? ['', []];
    expect(texto).toContain(
      'insert into plantillas_compartidas (dominios_clave, codigo_de_intencion, marcadores_clave, pasos, origenes_hash)',
    );
    expect(valores[0]).toBe(DOMINIO);
    expect(valores[1]).toBe('enviar');
    // Los marcadores se DERIVAN de los pasos, no se reciben.
    expect(valores[2]).toBe('destinatario');
    expect(valores[4]).toEqual(['h1']);
  });

  it('NINGUNA query nombra owner_id, firma, descripcion ni un id rastreable', async () => {
    const { sql } = await publicar();
    for (const [texto] of sql.queries) {
      for (const prohibido of [
        'owner_id',
        'user_id',
        'job_id',
        'firma',
        'descripcion',
        'trayectoria',
        'receta',
      ]) {
        expect(texto, prohibido).not.toContain(prohibido);
      }
    }
  });

  it('lo que se serializa a la columna pasos no lleva ningun valor de usuario', async () => {
    const { sql } = await publicar();
    const serializado = JSON.stringify(sql.queries[1]?.[1] ?? []);
    for (const prohibido of ['xpath', 'literal', '"ruta"', '"id"', '"name"', 'user-1', 'job-1']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
  });
});

describe('publicar: UNA fila por identidad, con los origenes sumados', () => {
  it('la misma identidad NO crea otra fila: suma el origen si es nuevo', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    expect(texto).toContain(
      'on conflict (dominios_clave, codigo_de_intencion, marcadores_clave) do update set',
    );
    // La pertenencia se decide DENTRO del statement: sin leer antes, no hay carrera posible y el mismo
    // origen dos veces no puede sumar dos origenes.
    expect(texto).toContain('when plantillas_compartidas.origenes_hash @> excluded.origenes_hash');
    expect(texto).toContain('then plantillas_compartidas.origenes_hash');
    expect(texto).toContain('else plantillas_compartidas.origenes_hash || excluded.origenes_hash');
  });

  it('los PASOS no se reemplazan al actualizar, al contrario que las estrategias del atlas', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    const actualizacion = texto.slice(texto.indexOf('do update set'));
    const asignaciones = actualizacion.slice(0, actualizacion.indexOf('returning'));
    expect(asignaciones).not.toContain('pasos =');
    expect(asignaciones).not.toContain('primera_vez_en');
    expect(asignaciones).toContain('actualizada_en = now()');
  });

  it('los contadores de ejecucion NO los toca la publicacion', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    expect(texto).not.toContain('ejecuciones_exitosas');
    expect(texto).not.toContain('ejecuciones_fallidas');
    expect(texto).not.toContain('fallos_consecutivos');
  });
});

describe('publicar: la SEGUNDA PUERTA (cinturon y tirantes)', () => {
  it('sin clases corroboradas en el atlas NO se inserta nada', async () => {
    const sql = makeSql([[], [{ origenes: 1 }]]);
    const resultado = await new PlantillasCompartidasRepository(sql).publicar(plantilla());
    expect(resultado).toEqual({
      publicada: false,
      motivo: 'la plantilla no es publicable (clase_no_corroborada)',
    });
    // Se leyo el atlas y se corto: no hubo insert.
    expect(sql.queries).toHaveLength(1);
  });

  it('lee las clases del atlas con el umbral de origenes independientes', async () => {
    const { sql } = await publicar();
    const [texto, valores] = sql.queries[0] ?? ['', []];
    expect(texto).toContain('select clase_de_elemento');
    expect(texto).toContain('from aprendizaje_sitios');
    expect(texto).toContain('jsonb_array_length(origenes_hash) >=');
    expect(valores).toContain(ORIGENES_PARA_PUBLICAR);
    expect(valores).toContain(MAX_CLASES_POR_DOMINIO);
  });

  it('unos pasos que no validan contra el contrato no llegan a leer el atlas', async () => {
    const sql = makeSql();
    const resultado = await new PlantillasCompartidasRepository(sql).publicar({
      ...plantilla(),
      pasos: [{ idx: 0, accion: 'navegar', dominio: DOMINIO, ruta: '/mail/u/0' }],
    });
    expect(resultado).toEqual({
      publicada: false,
      motivo: 'los pasos no validan contra el contrato de plantillas',
    });
    expect(sql.queries).toHaveLength(0);
  });

  it('un valor literal colado en los pasos rechaza la plantilla entera', async () => {
    const conLiteral = pasos();
    conLiteral[0] = {
      ...conLiteral[0]!,
      valor: { tipo: 'literal', texto: 'martin@ejemplo.com' } as never,
    };
    const sql = makeSql();
    const resultado = await new PlantillasCompartidasRepository(sql).publicar({
      ...plantilla(),
      pasos: conLiteral,
    });
    expect(resultado.publicada).toBe(false);
    expect(sql.queries).toHaveLength(0);
  });

  it('un codigo de intencion fuera de las ocho familias no llega a la base', async () => {
    const sql = makeSql();
    const resultado = await new PlantillasCompartidasRepository(sql).publicar({
      ...plantilla(),
      codigoDeIntencion: 'archivar',
    });
    expect(resultado).toEqual({
      publicada: false,
      motivo: 'el codigo de intencion no es una de las ocho familias',
    });
    expect(sql.queries).toHaveLength(0);
  });

  it('un paso que corre en un dominio que la identidad no declara se rechaza', async () => {
    const otroDominio = pasos();
    otroDominio[2] = { ...otroDominio[2]!, dominio: 'tienda.ejemplo.com' };
    const sql = makeSql();
    const resultado = await new PlantillasCompartidasRepository(sql).publicar({
      ...plantilla(),
      pasos: otroDominio,
    });
    expect(resultado).toEqual({
      publicada: false,
      motivo: 'algun paso corre en un dominio que la identidad de la plantilla no declara',
    });
    expect(sql.queries).toHaveLength(0);
  });

  it('sin dominios en la identidad no se publica nada', async () => {
    const sql = makeSql();
    const resultado = await new PlantillasCompartidasRepository(sql).publicar({
      ...plantilla(),
      dominiosClave: '',
    });
    expect(resultado).toEqual({ publicada: false, motivo: 'la plantilla no declara ningun dominio' });
    expect(sql.queries).toHaveLength(0);
  });
});

describe('publicar: NADA lee las plantillas todavia', () => {
  it('el repositorio no expone ningun metodo de lectura de plantillas_compartidas', () => {
    const metodos = Object.getOwnPropertyNames(PlantillasCompartidasRepository.prototype).filter(
      (nombre) => nombre !== 'constructor',
    );
    expect(metodos.sort()).toEqual(['clasesCorroboradas', 'publicar', 'upsert']);
  });

  it('ninguna query de este repositorio hace un select sobre plantillas_compartidas', async () => {
    const { sql } = await publicar();
    for (const [texto] of sql.queries) {
      expect(texto).not.toContain('from plantillas_compartidas');
    }
  });
});
