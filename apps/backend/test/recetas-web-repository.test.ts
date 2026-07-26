import { describe, it, expect, vi } from 'vitest';
import type { Sql } from '@ledesma-platform/shared';
import { RecetasWebRepository } from '../src/recetas-web/recetas-web-repository.js';

/**
 * RECETAS DE TAREA WEB (V035): acceso a datos. Mismo estilo de mock del tagged template `sql` que
 * aprobaciones-cancelacion.test.ts.
 *
 * El punto CENTRAL de estos tests es que el repositorio NO devuelve nunca los pasos crudos del jsonb:
 * entre que una receta se escribe y que se ejecuta hay una fila de base de datos, y una receta
 * manipulada no debe llegar al ejecutor. Ante cualquier paso que no valide, la receta se comporta
 * como inexistente y la tarea corre por el camino de siempre.
 *
 * OJO: nada de esto es la tabla `recipes` de V013 (cadenas de instrucciones para un agente
 * conversacional). Son dos tablas y dos repositorios distintos.
 */

const PASOS_VALIDOS = [
  {
    idx: 0,
    accion: 'click',
    estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
  },
];

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    owner_id: 'user-1',
    dominio: 'app.ejemplo.com',
    firma_objetivo: 'envia un correo a <destinatario>',
    version: 2,
    estado: 'activa',
    pasos: PASOS_VALIDOS,
    creada_desde_trayectoria: null,
    ejecuciones_exitosas: 4,
    ejecuciones_fallidas: 1,
    ultima_ejecucion_en: '2026-07-24T00:00:00.000Z',
    creada_en: '2026-07-20T00:00:00.000Z',
    actualizada_en: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

function makeSql(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function sqlText(sql: Sql, indice = 0): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[indice]?.[0] ?? []).join('<param>');
}

function sqlValues(sql: Sql, indice = 0): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[indice] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('buscarActiva', () => {
  it('devuelve la receta con sus pasos ya validados y en camelCase', async () => {
    const sql = makeSql([makeRow()]);
    const receta = await new RecetasWebRepository(sql).buscarActiva('user-1', 'app.ejemplo.com', 'f');
    expect(receta).toMatchObject({
      id: 'rec-1',
      ownerId: 'user-1',
      dominio: 'app.ejemplo.com',
      version: 2,
      estado: 'activa',
      ejecucionesExitosas: 4,
      ejecucionesFallidas: 1,
    });
    expect(receta?.pasos).toHaveLength(1);
    expect(receta?.pasos[0]?.accion).toBe('click');
  });

  it('acota por owner, dominio, firma y estado activa (aislamiento y unicidad)', async () => {
    const sql = makeSql([makeRow()]);
    await new RecetasWebRepository(sql).buscarActiva('user-1', 'app.ejemplo.com', 'firma-x');
    const texto = sqlText(sql);
    expect(texto).toContain('where owner_id =');
    expect(texto).toContain('and dominio =');
    expect(texto).toContain('and firma_objetivo =');
    expect(texto).toContain("estado = 'activa'");
    expect(sqlValues(sql)).toEqual(['user-1', 'app.ejemplo.com', 'firma-x']);
  });

  it('sin fila devuelve null', async () => {
    expect(await new RecetasWebRepository(makeSql([])).buscarActiva('user-1', 'd', 'f')).toBeNull();
  });

  it('UNA RECETA MANIPULADA no llega al ejecutor: pasos invalidos devuelven null', async () => {
    const envenenadas: unknown[] = [
      // Una navegacion a OTRO dominio disfrazada de ruta.
      [{ ...PASOS_VALIDOS[0], accion: 'navegar', estrategias: [], ruta: 'https://malo.com/pago' }],
      // Un paso con una accion inventada.
      [{ ...PASOS_VALIDOS[0], accion: 'ejecutar_script' }],
      // Un atributo fuera de la lista cerrada.
      [{ ...PASOS_VALIDOS[0], estrategias: [{ tipo: 'atributo', atributo: 'onclick', valor: 'alert(1)' }] }],
      // Indices con hueco: faltarian pasos del flujo aprendido.
      [PASOS_VALIDOS[0], { ...PASOS_VALIDOS[0], idx: 7 }],
      // Formas que ni siquiera son una lista de pasos.
      'no soy un arreglo',
      [],
      null,
    ];
    for (const pasos of envenenadas) {
      const sql = makeSql([makeRow({ pasos })]);
      expect(await new RecetasWebRepository(sql).buscarActiva('user-1', 'd', 'f')).toBeNull();
    }
  });
});

describe('promover (D4)', () => {
  function makeTx(versionAnterior: number | null, filaCreada: unknown) {
    const llamadas: Array<{ texto: string; valores: unknown[] }> = [];
    const tx = vi.fn(async (partes: readonly string[], ...valores: unknown[]) => {
      llamadas.push({ texto: partes.join('<param>'), valores });
      return llamadas.length === 1
        ? versionAnterior === null
          ? []
          : [{ version: versionAnterior }]
        : [filaCreada];
    });
    (tx as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
    return { tx, llamadas };
  }

  function makeSqlConTransaccion(tx: unknown) {
    const sql = vi.fn() as unknown as Sql;
    (sql as unknown as { begin: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).begin = (
      fn,
    ) => fn(tx);
    (sql as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
    return sql;
  }

  it('sin receta previa crea la version 1', async () => {
    const { tx, llamadas } = makeTx(null, makeRow({ version: 1 }));
    const receta = await new RecetasWebRepository(makeSqlConTransaccion(tx)).promover({
      ownerId: 'user-1',
      dominio: 'app.ejemplo.com',
      firmaObjetivo: 'f',
      pasos: PASOS_VALIDOS as never,
      creadaDesdeTrayectoria: null,
    });
    expect(receta?.version).toBe(1);
    expect(llamadas[1]?.valores).toContain(1);
  });

  it('con receta previa la marca obsoleta e incrementa version, TODO en la misma transaccion', async () => {
    const { tx, llamadas } = makeTx(3, makeRow({ version: 4 }));
    const receta = await new RecetasWebRepository(makeSqlConTransaccion(tx)).promover({
      ownerId: 'user-1',
      dominio: 'app.ejemplo.com',
      firmaObjetivo: 'f',
      pasos: PASOS_VALIDOS as never,
      creadaDesdeTrayectoria: 'tray-1',
    });
    expect(receta?.version).toBe(4);
    expect(llamadas[0]?.texto).toContain("set estado = 'obsoleta'");
    expect(llamadas[0]?.texto).toContain("estado = 'activa'");
    expect(llamadas[0]?.valores).toEqual(['user-1', 'app.ejemplo.com', 'f']);
    expect(llamadas[1]?.texto).toContain('insert into recetas_web');
    expect(llamadas[1]?.valores).toContain(4);
  });
});

describe('mantenimiento de la receta', () => {
  it('marcarObsoleta acota por id y owner', async () => {
    const sql = makeSql([]);
    await new RecetasWebRepository(sql).marcarObsoleta('rec-1', 'user-1');
    expect(sqlText(sql)).toContain("set estado = 'obsoleta'");
    expect(sqlValues(sql)).toEqual(['rec-1', 'user-1']);
  });

  it('reemplazarPasos sube version y solo toca la receta ACTIVA del owner', async () => {
    const sql = makeSql([]);
    await new RecetasWebRepository(sql).reemplazarPasos('rec-1', 'user-1', PASOS_VALIDOS as never);
    const texto = sqlText(sql);
    expect(texto).toContain('version = version + 1');
    expect(texto).toContain("estado = 'activa'");
    expect(sqlValues(sql)).toEqual([PASOS_VALIDOS, 'rec-1', 'user-1']);
  });

  it('registrarEjecucion suma al contador que corresponde', async () => {
    const exitosa = makeSql([]);
    await new RecetasWebRepository(exitosa).registrarEjecucion('rec-1', 'user-1', true);
    expect(sqlValues(exitosa).slice(0, 2)).toEqual([1, 0]);

    const fallida = makeSql([]);
    await new RecetasWebRepository(fallida).registrarEjecucion('rec-1', 'user-1', false);
    expect(sqlValues(fallida).slice(0, 2)).toEqual([0, 1]);
  });
});

describe('listarActivas (lo que ya sabe hacer)', () => {
  it('sin dominios lista todas las activas del owner', async () => {
    const sql = makeSql([makeRow(), makeRow({ id: 'rec-2' })]);
    const recetas = await new RecetasWebRepository(sql).listarActivas('user-1');
    expect(recetas.map((r) => r.id)).toEqual(['rec-1', 'rec-2']);
    const texto = sqlText(sql);
    expect(texto).toContain('where owner_id =');
    expect(texto).toContain("estado = 'activa'");
    expect(sqlValues(sql)).toEqual(['user-1']);
  });

  it('con dominios acota a esos dominios (los sitios que la tarea autorizo)', async () => {
    const sql = makeSql([makeRow()]);
    await new RecetasWebRepository(sql).listarActivas('user-1', ['app.ejemplo.com']);
    // La primera llamada es el fragmento de la lista de dominios; la segunda, la consulta.
    expect(sqlText(sql, 1)).toContain('and dominio in');
    expect(sqlValues(sql, 1)[0]).toBe('user-1');
  });

  it('con la lista de dominios VACIA no consulta nada (pedir "en ninguno" no puede leer todo)', async () => {
    const sql = makeSql([makeRow()]);
    expect(await new RecetasWebRepository(sql).listarActivas('user-1', [])).toEqual([]);
    expect((sql as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('una fila con pasos manipulados se DESCARTA de la lista, sin tumbar las demas', async () => {
    const sql = makeSql([makeRow({ id: 'rec-mala', pasos: 'no soy un arreglo' }), makeRow()]);
    const recetas = await new RecetasWebRepository(sql).listarActivas('user-1');
    expect(recetas.map((r) => r.id)).toEqual(['rec-1']);
  });

  it('la descripcion viaja cuando la hay y queda en null cuando no (recetas anteriores a V037)', async () => {
    const conTexto = makeSql([makeRow({ descripcion: '  enviar un correo  ' })]);
    const recetas = await new RecetasWebRepository(conTexto).listarActivas('user-1');
    expect(recetas[0]?.descripcion).toBe('enviar un correo');

    const sinTexto = makeSql([makeRow({ descripcion: '   ' })]);
    const otras = await new RecetasWebRepository(sinTexto).listarActivas('user-1');
    expect(otras[0]?.descripcion).toBeNull();
  });
});

describe('borrar (que la olvide)', () => {
  it('acota por id Y por owner, y dice si borro algo', async () => {
    const sql = makeSql([{ id: 'rec-1' }]);
    expect(await new RecetasWebRepository(sql).borrar('rec-1', 'user-1')).toBe(true);
    expect(sqlText(sql)).toContain('delete from recetas_web where id =');
    expect(sqlValues(sql)).toEqual(['rec-1', 'user-1']);
  });

  it('una receta ajena o inexistente no borra nada', async () => {
    expect(await new RecetasWebRepository(makeSql([])).borrar('rec-1', 'otro')).toBe(false);
  });
});
