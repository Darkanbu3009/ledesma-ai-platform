import { describe, it, expect } from 'vitest';
import type { PasoPublicable, Sql } from '@ledesma-platform/shared';
import {
  MAX_CLASES_POR_DOMINIO,
  MAX_FILAS_DE_DIAGNOSTICO,
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

describe('publicar: la superficie del repositorio es CERRADA', () => {
  it('expone exactamente las tres operaciones del ciclo de vida y ni una mas', () => {
    const metodos = Object.getOwnPropertyNames(PlantillasCompartidasRepository.prototype).filter(
      (nombre) => nombre !== 'constructor',
    );
    // `buscarServible`, `diagnosticarMiss` y `registrarEjecucion` son el CONSUMO; no hay ningun
    // metodo que lea o escriba acotado por dueno, porque una plantilla no tiene dueno (ver la
    // cabecera del repositorio).
    expect(metodos.sort()).toEqual([
      'buscarServible',
      'clasesCorroboradas',
      'diagnosticarMiss',
      'publicar',
      'registrarEjecucion',
      'upsert',
    ]);
  });

  it('la publicacion no hace ningun select sobre plantillas_compartidas', async () => {
    const { sql } = await publicar();
    for (const [texto] of sql.queries) {
      expect(texto).not.toContain('from plantillas_compartidas');
    }
  });
});

describe('buscarServible: la lectura del consumo', () => {
  it('busca por las TRES columnas de la identidad, acotada al estado y excluyendo el origen propio', async () => {
    const sql = makeSql([[{ id: 'p-1', estado: 'candidata', pasos: pasos(), origenes: 2 }]]);
    const repo = new PlantillasCompartidasRepository(sql);

    const servible = await repo.buscarServible({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresPosibles: ['', 'destinatario'],
      origenHash: 'hash-del-consumidor',
    });

    expect(servible).toMatchObject({ id: 'p-1', estado: 'candidata', origenes: 2 });
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('dominios_clave = ');
    expect(texto).toContain('codigo_de_intencion = ');
    // CONTENCION: igualdad contra la LISTA de subconjuntos, o sea las mismas tres columnas del
    // indice unico de V041 y en el mismo orden. No hay operador de conjuntos ni columna nueva.
    expect(texto).toContain('marcadores_clave in ');
    expect(valores).toContainEqual({ lista: ['', 'destinatario'] });
    expect(texto).toContain('estado in ');
    // LA EXCLUSION DEL PROPIO ORIGEN vive DENTRO de la query: el hash no sale de la base.
    expect(texto).toContain('from jsonb_array_elements_text(origenes_hash) as origen(hash)');
    expect(texto).toContain('where origen.hash <> ');
    expect(valores).toContain('hash-del-consumidor');
    expect(valores).toContain(DOMINIO);
    expect(valores).toContain('enviar');
    // Ninguna query de esta tabla puede nombrar un dueno: la columna no existe.
    expect(texto).not.toContain('owner_id');
  });

  it('la regla del origen es "queda alguno DISTINTO del mio", no "yo no estoy"', async () => {
    const sql = makeSql([[]]);
    await new PlantillasCompartidasRepository(sql).buscarServible({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresPosibles: ['', 'destinatario'],
      origenHash: 'hash-del-consumidor',
    });
    const [texto] = sql.queries[0] as [string, unknown[]];
    // El predicado viejo ("cualquier plantilla a la que yo haya contribuido alguna vez") dejaba una
    // fila con DOS origenes reales fuera del alcance de LAS DOS cuentas, para siempre. Los tres
    // casos de la regla nueva (solo yo, solo otros, yo y otros) se ejercitan de punta a punta en
    // apps/worker/test/tarea-web-plantillas-consumo.test.ts, contra el fake que copia este predicado.
    expect(texto).not.toContain('not (origenes_hash @>');
  });

  it('sin fila devuelve null (y la tarea sigue por el motor libre)', async () => {
    const repo = new PlantillasCompartidasRepository(makeSql([[]]));
    const servible = await repo.buscarServible({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresPosibles: [''],
      origenHash: 'hash',
    });
    expect(servible).toBeNull();
  });

  it('sin ninguna clave de marcadores no se consulta nada (un `in ()` no es una query)', async () => {
    const sql = makeSql([[]]);
    const servible = await new PlantillasCompartidasRepository(sql).buscarServible({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresPosibles: [],
      origenHash: 'hash',
    });
    expect(servible).toBeNull();
    expect(sql.queries).toHaveLength(0);
  });

  it('EL DESEMPATE es determinista: la mas especifica, la mas corroborada y al final el id', async () => {
    const sql = makeSql([[{ id: 'p-1', estado: 'candidata', pasos: pasos(), origenes: 2 }]]);
    await new PlantillasCompartidasRepository(sql).buscarServible({
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresPosibles: ['', 'asunto', 'asunto+destinatario', 'destinatario'],
      origenHash: 'hash-del-consumidor',
    });
    const [texto] = sql.queries[0] as [string, unknown[]];
    const orden = texto.slice(texto.indexOf('order by'));
    // 1. LA MAS ESPECIFICA: cuantos marcadores exige la fila (la clave vacia son cero).
    expect(orden).toContain("when marcadores_clave = '' then 0");
    expect(orden).toContain("length(marcadores_clave) - length(replace(marcadores_clave, '+', '')) + 1");
    // 2. LA MAS CORROBORADA. 3. El id, que es UNICO: es lo que hace TOTAL el orden, para que dos
    //    corridas con los mismos datos elijan siempre la misma fila.
    expect(orden.indexOf('origenes desc')).toBeLessThan(orden.indexOf('ejecuciones_exitosas desc'));
    expect(orden.indexOf('ejecuciones_exitosas desc')).toBeLessThan(orden.indexOf('id asc'));
    expect(orden).toContain('limit 1');
  });
});

describe('registrarEjecucion: los contadores agregados', () => {
  it('un EXITO suma a exitosas, pone los fallos seguidos en cero y LIMPIA el motivo (V042)', async () => {
    const sql = makeSql([[]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', true);
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('ejecuciones_exitosas = ejecuciones_exitosas + ');
    expect(texto).toContain('fallos_consecutivos = case when ');
    expect(texto).toContain('ultima_falla_motivo = ');
    // 1 al contador de exitos, 0 al de fallos, 1 al discriminante del case, el motivo limpio y el id.
    expect(valores).toEqual([1, 0, 1, null, 'p-1']);
    // NO toca el estado: la promocion y el retiro son decisiones aparte.
    expect(texto).not.toContain('estado =');
  });

  it('un FALLO suma a fallidas, acumula los fallos seguidos y persiste su motivo (V042)', async () => {
    const sql = makeSql([[]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', false, 'barrera_bloqueada');
    const [, valores] = sql.queries[0] as [string, unknown[]];
    expect(valores).toEqual([0, 1, 0, 'barrera_bloqueada', 'p-1']);
  });

  it('un fallo SIN motivo (o con uno fuera del vocabulario) persiste NULL, no revienta', async () => {
    const sql = makeSql([[], []]);
    const repo = new PlantillasCompartidasRepository(sql);
    await repo.registrarEjecucion('p-1', false);
    await repo.registrarEjecucion('p-1', false, 'cualquier cosa' as never);
    expect((sql.queries[0] as [string, unknown[]])[1]).toEqual([0, 1, 0, null, 'p-1']);
    expect((sql.queries[1] as [string, unknown[]])[1]).toEqual([0, 1, 0, null, 'p-1']);
  });

  it('un motivo en un EXITO no se persiste: el exito siempre limpia', async () => {
    const sql = makeSql([[]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', true, 'abandonada');
    expect((sql.queries[0] as [string, unknown[]])[1]).toEqual([1, 0, 1, null, 'p-1']);
  });
});

describe('diagnosticarMiss: donde se corto la lectura del consumo', () => {
  const CLAVE = {
    dominiosClave: DOMINIO,
    codigoDeIntencion: 'enviar',
    marcadoresPosibles: ['', 'asunto', 'asunto+destinatario', 'destinatario'],
  };

  /** Una fila de la tabla tal como la devuelve la consulta del diagnostico. */
  function fila(marcadores: string, estado = 'candidata', origenes = 2) {
    return { marcadores_clave: marcadores, estado, origenes };
  }

  async function diagnosticar(filas: unknown[]) {
    const sql = makeSql([filas]);
    const diagnostico = await new PlantillasCompartidasRepository(sql).diagnosticarMiss(CLAVE);
    return { diagnostico, sql };
  }

  it('sin ninguna fila de esta identidad: sin_identidad_en_tabla', async () => {
    const { diagnostico, sql } = await diagnosticar([]);
    expect(diagnostico).toEqual({ corte: 'sin_identidad_en_tabla', origenes: null });
    // La consulta busca por los DOS componentes que no se relajan, sin el de marcadores.
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('dominios_clave = ');
    expect(texto).toContain('codigo_de_intencion = ');
    expect(texto).not.toContain('marcadores_clave = ');
    expect(texto).not.toContain('marcadores_clave in ');
    expect(valores).toContain(MAX_FILAS_DE_DIAGNOSTICO);
  });

  it('hay filas pero ninguna pide un subconjunto de lo declarado: marcadores_no_contenidos', async () => {
    const { diagnostico } = await diagnosticar([fila('asunto+cuerpo+destinatario+monto')]);
    expect(diagnostico).toEqual({ corte: 'marcadores_no_contenidos', origenes: null });
  });

  it('la fila casa pero esta retirada: estado_no_servible, con sus origenes', async () => {
    const { diagnostico } = await diagnosticar([fila('asunto+destinatario', 'retirada', 4)]);
    expect(diagnostico).toEqual({ corte: 'estado_no_servible', origenes: 4 });
  });

  it('la fila casa y es servible: el unico filtro que queda es el ORIGEN', async () => {
    const { diagnostico } = await diagnosticar([fila('asunto+destinatario', 'candidata', 1)]);
    expect(diagnostico).toEqual({ corte: 'origen_propio', origenes: 1 });
  });

  it('con varias filas contenidas, los origenes son los de la que el desempate habria elegido', async () => {
    const { diagnostico } = await diagnosticar([
      fila('destinatario', 'candidata', 9),
      fila('asunto+destinatario', 'candidata', 3),
    ]);
    // La MAS ESPECIFICA gana aunque tenga menos origenes: el mismo orden que el `order by`.
    expect(diagnostico).toEqual({ corte: 'origen_propio', origenes: 3 });
  });

  it('NO le pregunta nada al hash de origen: la consulta no lo nombra', async () => {
    const { sql } = await diagnosticar([fila('destinatario')]);
    const [texto] = sql.queries[0] as [string, unknown[]];
    expect(texto).not.toContain('@>');
    expect(texto).not.toContain('jsonb_array_elements_text');
    expect(texto).not.toContain('owner_id');
    // Solo el LARGO del arreglo, que es un conteo y no un identificador.
    expect(texto).toContain('jsonb_array_length(origenes_hash) as origenes');
  });
});
