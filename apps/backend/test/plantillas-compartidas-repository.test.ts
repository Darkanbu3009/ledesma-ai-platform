import { describe, it, expect } from 'vitest';
import type { PasoPublicable, Sql } from '@ledesma-platform/shared';
import {
  DESAJUSTES_PARA_RETIRO,
  FALLOS_PARA_RETIRO,
  MAX_CLASES_POR_DOMINIO,
  MAX_FILAS_DE_DIAGNOSTICO,
  ORIGENES_PARA_PUBLICAR,
  PlantillasCompartidasRepository,
  UMBRAL_DE_CORROBORACION,
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
  estadoPrevio: string | null = null,
): Promise<{
  resultado: Awaited<ReturnType<PlantillasCompartidasRepository['publicar']>>;
  sql: ReturnType<typeof makeSql>;
}> {
  const sql = makeSql([clases, [{ origenes, estado_previo: estadoPrevio }]]);
  const resultado = await new PlantillasCompartidasRepository(sql).publicar(entrada);
  return { resultado, sql };
}

describe('publicar: lo que la query escribe y lo que NO puede nombrar', () => {
  it('inserta SOLO la identidad, los pasos y el hash de origen', async () => {
    const { resultado, sql } = await publicar();
    expect(resultado).toEqual({ publicada: true, origenes: 1, rehabilitada: false });
    const [texto, valores] = sql.queries[1] ?? ['', []];
    expect(texto).toContain(
      'insert into plantillas_compartidas (dominios_clave, codigo_de_intencion, marcadores_clave, pasos, origenes_hash)',
    );
    // Los TRES primeros parametros son la identidad del CTE `antes` (el estado previo, para D5);
    // despues la identidad del insert, los pasos y el origen.
    expect(valores.slice(0, 3)).toEqual([DOMINIO, 'enviar', 'destinatario']);
    expect(valores.slice(3, 6)).toEqual([DOMINIO, 'enviar', 'destinatario']);
    expect(valores[7]).toEqual(['h1']);
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

  it('los PASOS de una fila SANA no se reemplazan: solo la retirada o la desajustada los adopta', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    const actualizacion = texto.slice(texto.indexOf('do update set'));
    const asignaciones = actualizacion.slice(0, actualizacion.indexOf('returning'));
    // El case: excluded.pasos SOLO cuando la fila estaba retirada o con desajuste registrado; en
    // cualquier otro estado se conserva el procedimiento con aval.
    expect(asignaciones).toContain('pasos = case when plantillas_compartidas.estado = \'retirada\'');
    expect(asignaciones).toContain('then excluded.pasos else plantillas_compartidas.pasos end');
    expect(asignaciones).not.toContain('primera_vez_en');
    expect(asignaciones).toContain('actualizada_en = now()');
  });

  it('los contadores de EXITOS y FALLIDAS no los toca la publicacion', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    expect(texto).not.toContain('ejecuciones_exitosas');
    expect(texto).not.toContain('ejecuciones_fallidas');
    // `fallos_consecutivos` y `consumidores_hash` SOLO se tocan al rehabilitar una fila retirada o
    // desajustada: en cualquier otro estado el case los deja exactamente como estaban.
    expect(texto).toContain('then 0');
    expect(texto).toContain('else plantillas_compartidas.fallos_consecutivos');
  });
});

describe('publicar: la rehabilitacion de una fila retirada o desajustada (D5 y D3 de resiliencia)', () => {
  it('una publicacion nueva regresa la retirada a candidata, con racha y consumidores en cero', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    const actualizacion = texto.slice(texto.indexOf('do update set'));
    // estado: retirada (o con desajuste registrado) -> candidata; cualquier otro se conserva.
    expect(actualizacion).toContain("estado = case when plantillas_compartidas.estado = 'retirada'");
    expect(actualizacion).toContain("then 'candidata' else plantillas_compartidas.estado end");
    // consumidores_hash: la evidencia de consumo era del procedimiento que fallaba.
    expect(actualizacion).toContain(
      "then '[]'::jsonb else plantillas_compartidas.consumidores_hash end",
    );
    // origenes_hash SE CONSERVA: el case de arriba sigue sumando sobre el acumulado, nunca lo vacia.
    expect(actualizacion).not.toContain("origenes_hash = '[]'");
  });

  it('D3: la identidad desajustada adopta los pasos nuevos y limpia sus desajustes, atomico', async () => {
    const { sql } = await publicar();
    const [texto] = sql.queries[1] ?? [''];
    const actualizacion = texto.slice(texto.indexOf('do update set'));
    // La condicion del reemplazo es retirada O desajuste registrado, y vive en el MISMO statement.
    expect(actualizacion).toContain(
      "or plantillas_compartidas.desajustes_hash <> '[]'::jsonb then excluded.pasos",
    );
    expect(actualizacion).toContain(
      "desajustes_hash = case when plantillas_compartidas.estado = 'retirada'",
    );
    expect(actualizacion).toContain("then '[]'::jsonb else plantillas_compartidas.desajustes_hash end");
  });

  it('el resultado dice si hubo rehabilitacion, leyendo el estado previo en el mismo statement', async () => {
    const { resultado } = await publicar(plantilla(), clasesDelAtlas(), 3, 'retirada');
    expect(resultado).toEqual({ publicada: true, origenes: 3, rehabilitada: true });
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
  it('expone exactamente las operaciones del ciclo de vida y ni una mas', () => {
    const metodos = Object.getOwnPropertyNames(PlantillasCompartidasRepository.prototype).filter(
      (nombre) => nombre !== 'constructor',
    );
    // `buscarServible`, `diagnosticarMiss`, `registrarEjecucion` y `registrarDesajuste` son el
    // CONSUMO; no hay ningun metodo que lea o escriba acotado por dueno, porque una plantilla no
    // tiene dueno (ver la cabecera del repositorio).
    expect(metodos.sort()).toEqual([
      'buscarServible',
      'clasesCorroboradas',
      'comoRegistro',
      'diagnosticarMiss',
      'publicar',
      'registrarDesajuste',
      'registrarEjecucion',
      'upsert',
    ]);
  });

  it('la publicacion solo lee de plantillas_compartidas el ESTADO previo (D5), nada mas', async () => {
    const { sql } = await publicar();
    // El unico select sobre la tabla es el CTE de una columna que decide la rehabilitacion: no se
    // leen pasos, ni hashes, ni contadores.
    for (const [texto] of sql.queries) {
      const lecturas = texto.split('from plantillas_compartidas').length - 1;
      if (lecturas > 0) {
        expect(lecturas).toBe(1);
        expect(texto).toContain('with antes as ( select estado from plantillas_compartidas');
        expect(texto).not.toContain('select pasos');
        expect(texto).not.toContain('select origenes_hash');
      }
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
    // 2. D3: corroborada gana a candidata, por encima de los desempates de corroboracion cruda y por
    //    debajo de la especificidad. 3. LA MAS CORROBORADA. 4. El id, que es UNICO: es lo que hace
    //    TOTAL el orden, para que dos corridas con los mismos datos elijan siempre la misma fila.
    const rangoDeEstado = orden.indexOf("when estado = 'corroborada' then 1 else 0 end desc");
    expect(rangoDeEstado).toBeGreaterThan(-1);
    expect(orden.indexOf('marcadores_clave')).toBeLessThan(rangoDeEstado);
    expect(rangoDeEstado).toBeLessThan(orden.indexOf('origenes desc'));
    expect(orden.indexOf('origenes desc')).toBeLessThan(orden.indexOf('ejecuciones_exitosas desc'));
    expect(orden.indexOf('ejecuciones_exitosas desc')).toBeLessThan(orden.indexOf('id asc'));
    expect(orden).toContain('limit 1');
  });
});

describe('registrarEjecucion: contadores, evidencia de consumo y transiciones', () => {
  /** La fila que devuelve el returning del update, con su identidad para el log. */
  function filaDeRegistro(estado = 'candidata', estadoPrevio = 'candidata') {
    return {
      estado,
      estado_previo: estadoPrevio,
      dominios_clave: DOMINIO,
      codigo_de_intencion: 'enviar',
      marcadores_clave: 'destinatario',
    };
  }

  it('un EXITO suma a exitosas, pone los fallos seguidos en cero y LIMPIA el motivo (V042)', async () => {
    const sql = makeSql([[filaDeRegistro()]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', true, undefined, 'c1');
    const [texto] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('ejecuciones_exitosas = ejecuciones_exitosas + 1');
    expect(texto).toContain('fallos_consecutivos = 0');
    expect(texto).toContain('ultima_falla_motivo = null');
    expect(texto).not.toContain('ejecuciones_fallidas');
  });

  it('D2: el exito agrega el hash del consumidor SOLO si es nuevo, dentro del statement', async () => {
    const sql = makeSql([[filaDeRegistro()]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', true, undefined, 'c1');
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    // La misma tecnica del on conflict de origenes_hash: la pertenencia se decide con @> y el mismo
    // consumidor dos veces no puede sumar dos.
    expect(texto).toContain('consumidores_hash = case when consumidores_hash @> ');
    expect(texto).toContain('else consumidores_hash || ');
    expect(valores).toContain('p-1');
    expect(JSON.stringify(valores)).toContain('c1');
  });

  it('D3: candidata pasa a corroborada con origenes >= 2 y consumidores >= 2, atomico', async () => {
    const sql = makeSql([[filaDeRegistro('corroborada')]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarEjecucion(
      'p-1',
      true,
      undefined,
      'c1',
    );
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    // La transicion vive en el MISMO update que los contadores (un solo statement).
    expect(texto).toContain("when estado = 'candidata'");
    expect(texto).toContain('and jsonb_array_length(origenes_hash) >= ');
    // El conteo de consumidores se hace sobre la MISMA expresion deduplicada que se persiste.
    expect(texto).toContain("then 'corroborada' else estado end");
    expect(valores).toContain(UMBRAL_DE_CORROBORACION);
    // Y el llamador recibe la transicion con la identidad de la fila, para el log.
    expect(registro).toEqual({
      estado: 'corroborada',
      estadoPrevio: 'candidata',
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresClave: 'destinatario',
    });
  });

  it('un FALLO suma a fallidas y con motivo IMPUTABLE acumula la racha de retiro (V042/D4)', async () => {
    const sql = makeSql([[filaDeRegistro()]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', false, 'barrera_bloqueada');
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('ejecuciones_fallidas = ejecuciones_fallidas + 1');
    expect(texto).toContain('fallos_consecutivos = case when ');
    expect(texto).toContain('then fallos_consecutivos + 1 else 0 end');
    // imputable=true viaja como discriminante, el motivo se persiste y el id cierra el where.
    expect(valores).toContain(true);
    expect(valores).toContain('barrera_bloqueada');
    expect(valores).toContain('p-1');
    // Los fallos NO escriben evidencia de consumo (D2).
    expect(texto).not.toContain('consumidores_hash');
  });

  it('D4: al tercer fallo imputable seguido la fila pasa a retirada, en el mismo statement', async () => {
    const sql = makeSql([[filaDeRegistro('retirada')]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarEjecucion(
      'p-1',
      false,
      'sin_efecto',
    );
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain("and fallos_consecutivos + 1 >= ");
    expect(texto).toContain("then 'retirada' else estado end");
    expect(valores).toContain(FALLOS_PARA_RETIRO);
    // sin_efecto es imputable: mueve la racha.
    expect(valores).toContain(true);
    expect(registro?.estado).toBe('retirada');
  });

  it('D4: abandonada y sesion cortan la racha (0) sin dejar de contar como fallidas', async () => {
    const sql = makeSql([[filaDeRegistro()], [filaDeRegistro()]]);
    const repo = new PlantillasCompartidasRepository(sql);
    await repo.registrarEjecucion('p-1', false, 'abandonada');
    await repo.registrarEjecucion('p-1', false, 'sesion');
    for (const llamada of sql.queries) {
      const [texto, valores] = llamada;
      // No imputable: el discriminante viaja en false, la racha cae a 0 y la fallida SI se cuenta.
      expect(valores).toContain(false);
      expect(valores).not.toContain(true);
      expect(texto).toContain('ejecuciones_fallidas = ejecuciones_fallidas + 1');
    }
  });

  it('un fallo SIN motivo (o con uno fuera del vocabulario) persiste NULL y NO es imputable', async () => {
    const sql = makeSql([[filaDeRegistro()], [filaDeRegistro()]]);
    const repo = new PlantillasCompartidasRepository(sql);
    await repo.registrarEjecucion('p-1', false);
    await repo.registrarEjecucion('p-1', false, 'cualquier cosa' as never);
    for (const llamada of sql.queries) {
      const [, valores] = llamada;
      expect(valores).toContain(null);
      expect(valores).toContain(false);
      expect(valores).not.toContain('cualquier cosa');
    }
  });

  it('un motivo en un EXITO no se persiste: el exito siempre limpia', async () => {
    const sql = makeSql([[filaDeRegistro()]]);
    await new PlantillasCompartidasRepository(sql).registrarEjecucion('p-1', true, 'abandonada', 'c1');
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('ultima_falla_motivo = null');
    expect(valores).not.toContain('abandonada');
  });

  it('el retiro y la corroboracion aplican tambien sobre corroborada y candidata segun el caso', async () => {
    // corroborada que falla tres veces imputables: el case de retirada no exige candidata.
    const sql = makeSql([[filaDeRegistro('retirada', 'corroborada')]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarEjecucion(
      'p-1',
      false,
      'barrera_bloqueada',
    );
    const [texto] = sql.queries[0] as [string, unknown[]];
    expect(texto).not.toContain("estado = 'candidata' and fallos_consecutivos");
    expect(registro).toMatchObject({ estado: 'retirada', estadoPrevio: 'corroborada' });
  });

  it('devuelve null cuando la fila no existe (el update no toco nada)', async () => {
    const sql = makeSql([[]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarEjecucion('nope', true);
    expect(registro).toBeNull();
  });
});

describe('registrarDesajuste: retiro acelerado por evidencia estructural (V044, D4)', () => {
  function filaDeRegistro(estado = 'candidata', estadoPrevio = 'candidata') {
    return {
      estado,
      estado_previo: estadoPrevio,
      dominios_clave: DOMINIO,
      codigo_de_intencion: 'enviar',
      marcadores_clave: 'destinatario',
    };
  }

  it('agrega el hash del consumidor SOLO si es nuevo y persiste el motivo, sin tocar contadores de ejecucion', async () => {
    const sql = makeSql([[filaDeRegistro()]]);
    await new PlantillasCompartidasRepository(sql).registrarDesajuste('p-1', 'c1');
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    expect(texto).toContain('desajustes_hash = case when desajustes_hash @> ');
    expect(texto).toContain('else desajustes_hash || ');
    expect(texto).toContain("ultima_falla_motivo = 'desajuste_de_interfaz'");
    // NO es una ejecucion: ni fallidas, ni exitosas, ni la racha de retiro por calidad.
    expect(texto).not.toContain('ejecuciones_fallidas');
    expect(texto).not.toContain('ejecuciones_exitosas');
    expect(texto).not.toContain('fallos_consecutivos');
    expect(valores).toContain('p-1');
    expect(JSON.stringify(valores)).toContain('c1');
  });

  it('D4: con DESAJUSTES_PARA_RETIRO consumidores distintos la fila pasa a retirada, en el mismo statement', async () => {
    const sql = makeSql([[filaDeRegistro('retirada', 'candidata')]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarDesajuste('p-1', 'c2');
    const [texto, valores] = sql.queries[0] as [string, unknown[]];
    // El conteo se hace sobre la MISMA expresion deduplicada que se persiste: dos desajustes del
    // MISMO consumidor no pueden llegar al umbral.
    expect(texto).toContain('when jsonb_array_length( case when desajustes_hash @> ');
    expect(texto).toContain("then 'retirada' else estado end");
    expect(valores).toContain(DESAJUSTES_PARA_RETIRO);
    expect(registro).toMatchObject({ estado: 'retirada', estadoPrevio: 'candidata' });
  });

  it('el umbral es DOS consumidores distintos, no dos desajustes', () => {
    expect(DESAJUSTES_PARA_RETIRO).toBe(2);
  });

  it('devuelve la identidad de la fila para el log, jamas un hash', async () => {
    const sql = makeSql([[filaDeRegistro()]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarDesajuste('p-1', 'c1');
    expect(registro).toEqual({
      estado: 'candidata',
      estadoPrevio: 'candidata',
      dominiosClave: DOMINIO,
      codigoDeIntencion: 'enviar',
      marcadoresClave: 'destinatario',
    });
  });

  it('devuelve null cuando la fila no existe (el update no toco nada)', async () => {
    const sql = makeSql([[]]);
    const registro = await new PlantillasCompartidasRepository(sql).registrarDesajuste('nope', 'c1');
    expect(registro).toBeNull();
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

  it('D3: a igualdad de marcadores, la CORROBORADA gana a la candidata (mismo orden que la query)', async () => {
    const { diagnostico } = await diagnosticar([
      fila('destinatario', 'candidata', 9),
      fila('asunto', 'corroborada', 2),
    ]);
    // Un marcador cada una: el estado decide antes que los origenes crudos.
    expect(diagnostico).toEqual({ corte: 'origen_propio', origenes: 2 });
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
