import { describe, it, expect } from 'vitest';
import { TrayectoriasWebRepository, type NuevaTrayectoria } from '../src/trayectorias/trayectorias-repository.js';
import type { Sql } from '../src/db/client.js';

/**
 * Mock del cliente sql con begin REAL (las consultas de crear corren dentro de la transaccion) y
 * respuestas por forma de consulta. Mismo espiritu que retention-repository.test.ts: sin DB, se
 * valida el texto de las queries, los parametros y el mapeo snake_case -> camelCase.
 */
interface RecordedCall {
  text: string;
  values: unknown[];
  tx: boolean;
}

function makeSql(responder: (text: string, values: unknown[]) => unknown[]) {
  const calls: RecordedCall[] = [];
  const exec =
    (tx: boolean) =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Uso helper del cliente real: sql(lista) interpola una lista en un IN (...). El mock lo
      // devuelve como valor opaco, sin registrarlo como consulta.
      if (!Array.isArray((strings as unknown as { raw?: unknown }).raw)) {
        return strings as unknown as unknown[];
      }
      const text = Array.from(strings).join(' ? ').replace(/\s+/g, ' ');
      calls.push({ text, values, tx });
      return responder(text, values);
    };
  const tagged = exec(false) as unknown as Sql & { calls: RecordedCall[] };
  (tagged as unknown as { begin: unknown }).begin = async <T>(cb: (tx: Sql) => Promise<T>) => {
    const inner = exec(true) as unknown as Sql;
    (inner as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
    return cb(inner);
  };
  (tagged as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  (tagged as unknown as { calls: RecordedCall[] }).calls = calls;
  return tagged;
}

const NUEVA: NuevaTrayectoria = {
  ownerId: 'user-1',
  jobId: 'job-1',
  connectionId: 'conn-1',
  dominio: 'en.wikipedia.org',
  objetivo: 'leer el articulo destacado',
  estado: 'exitosa',
  iniciadaEn: new Date('2026-07-20T00:00:00.000Z'),
  terminadaEn: new Date('2026-07-20T00:00:42.000Z'),
  duracionMs: 42_000,
  tokensIn: 1200,
  tokensOut: 340,
  pasos: [
    {
      idx: 0,
      accion: { tipo: 'goto', instruccion: 'https://en.wikipedia.org/', metodo: null, argumentos: [] },
      selector: null,
      valorCensurado: null,
      url: 'https://en.wikipedia.org/',
      exito: true,
    },
    {
      idx: 1,
      accion: { tipo: 'act', instruccion: 'click the featured article', metodo: 'click', argumentos: [] },
      selector: 'xpath=//a[@id="featured"]',
      valorCensurado: null,
      url: 'https://en.wikipedia.org/',
      exito: true,
    },
  ],
};

describe('TrayectoriasWebRepository.crear', () => {
  it('inserta la cabecera y CADA paso dentro de la transaccion, y devuelve el id', async () => {
    const sql = makeSql((text) =>
      text.includes('insert into trayectorias_web') ? [{ id: 'tray-1' }] : [],
    );
    const id = await new TrayectoriasWebRepository(sql).crear(NUEVA);
    expect(id).toBe('tray-1');

    // 1 insert de cabecera + 2 de pasos, TODOS transaccionales (todo o nada).
    expect(sql.calls).toHaveLength(3);
    expect(sql.calls.every((c) => c.tx)).toBe(true);
    expect(sql.calls[0]?.text).toContain('insert into trayectorias_web');
    expect(sql.calls[1]?.text).toContain('insert into pasos_trayectoria');
    // Cada paso viaja con el id de la cabecera y su idx.
    expect(sql.calls[1]?.values[0]).toBe('tray-1');
    expect(sql.calls[1]?.values[1]).toBe(0);
    expect(sql.calls[2]?.values[1]).toBe(1);
  });
});

describe('escritura incremental (FIX D): iniciar, agregarPasos y finalizar', () => {
  it('iniciar inserta SOLO la cabecera y devuelve su id', async () => {
    const sql = makeSql((text) =>
      text.includes('insert into trayectorias_web') ? [{ id: 'tray-1' }] : [],
    );
    const id = await new TrayectoriasWebRepository(sql).iniciar({ ...NUEVA, estado: 'fallida', pasos: [] });
    expect(id).toBe('tray-1');
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain('insert into trayectorias_web');
  });

  it('agregarPasos verifica la pertenencia dentro de la transaccion y vuelca el lote', async () => {
    const sql = makeSql((text) =>
      text.includes('select id from trayectorias_web') ? [{ id: 'tray-1' }] : [],
    );
    await new TrayectoriasWebRepository(sql).agregarPasos('tray-1', 'user-1', NUEVA.pasos);
    expect(sql.calls).toHaveLength(3);
    expect(sql.calls.every((c) => c.tx)).toBe(true);
    expect(sql.calls[0]?.text).toContain('select id from trayectorias_web');
    expect(sql.calls[0]?.values).toEqual(['tray-1', 'user-1']);
    expect(sql.calls[1]?.text).toContain('insert into pasos_trayectoria');
    // Idempotente por (trayectoria_id, idx): un lote reintentado no duplica pasos.
    expect(sql.calls[1]?.text).toContain('on conflict (trayectoria_id, idx) do nothing');
    expect(sql.calls[1]?.values[0]).toBe('tray-1');
    expect(sql.calls[1]?.values[1]).toBe(0);
  });

  it('agregarPasos con una trayectoria AJENA no escribe nada', async () => {
    const sql = makeSql(() => []);
    await new TrayectoriasWebRepository(sql).agregarPasos('tray-ajena', 'user-1', NUEVA.pasos);
    expect(sql.calls).toHaveLength(1);
  });

  it('finalizar actualiza la cabecera y REEMPLAZA los pasos por la lista final, todo en la transaccion', async () => {
    const sql = makeSql((text) => (text.includes('update trayectorias_web') ? [{ id: 'tray-1' }] : []));
    await new TrayectoriasWebRepository(sql).finalizar('tray-1', 'user-1', NUEVA);
    // 1 update + 1 delete + 2 inserts, todos transaccionales.
    expect(sql.calls).toHaveLength(4);
    expect(sql.calls.every((c) => c.tx)).toBe(true);
    expect(sql.calls[0]?.text).toContain('update trayectorias_web');
    expect(sql.calls[0]?.text).toContain('where id = ? and owner_id = ?');
    expect(sql.calls[1]?.text).toContain('delete from pasos_trayectoria');
    expect(sql.calls[2]?.text).toContain('insert into pasos_trayectoria');
  });

  it('finalizar sobre una trayectoria AJENA no borra ni escribe pasos', async () => {
    const sql = makeSql(() => []);
    await new TrayectoriasWebRepository(sql).finalizar('tray-ajena', 'user-1', NUEVA);
    expect(sql.calls).toHaveLength(1);
  });
});

describe('TrayectoriasWebRepository.listarPorJobConPasos', () => {
  const CABECERA = {
    id: 'tray-1',
    owner_id: 'user-1',
    job_id: 'job-1',
    connection_id: 'conn-1',
    dominio: 'en.wikipedia.org',
    objetivo: 'leer el articulo destacado',
    estado: 'exitosa',
    iniciada_en: '2026-07-20T00:00:00.000Z',
    terminada_en: '2026-07-20T00:00:42.000Z',
    duracion_ms: 42_000,
    tokens_in: 1200,
    tokens_out: null,
    creada_en: '2026-07-20T00:00:42.000Z',
  };
  const PASO = {
    id: 'paso-1',
    trayectoria_id: 'tray-1',
    idx: 0,
    accion: { tipo: 'goto' },
    selector: null,
    valor_censurado: null,
    url: 'https://en.wikipedia.org/',
    exito: true,
    creado_en: '2026-07-20T00:00:10.000Z',
  };

  it('acota por job Y owner, y agrupa los pasos bajo su trayectoria en camelCase', async () => {
    const sql = makeSql((text) => {
      if (text.includes('from trayectorias_web')) return [CABECERA];
      if (text.includes('from pasos_trayectoria')) return [PASO];
      return [];
    });
    const result = await new TrayectoriasWebRepository(sql).listarPorJobConPasos('job-1', 'user-1');

    // La lectura de cabeceras filtra por job_id y owner_id (el aislamiento vive en la query).
    expect(sql.calls[0]?.text).toContain('where job_id = ? and owner_id = ?');
    expect(sql.calls[0]?.values).toEqual(['job-1', 'user-1']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'tray-1',
      jobId: 'job-1',
      dominio: 'en.wikipedia.org',
      estado: 'exitosa',
      duracionMs: 42_000,
      tokensIn: 1200,
      tokensOut: null,
      iniciadaEn: '2026-07-20T00:00:00.000Z',
    });
    expect(result[0]?.pasos).toEqual([
      {
        id: 'paso-1',
        idx: 0,
        accion: { tipo: 'goto' },
        selector: null,
        valorCensurado: null,
        url: 'https://en.wikipedia.org/',
        exito: true,
        creadoEn: '2026-07-20T00:00:10.000Z',
      },
    ]);
  });

  it('sin cabeceras: lista vacia y NO consulta pasos', async () => {
    const sql = makeSql(() => []);
    const result = await new TrayectoriasWebRepository(sql).listarPorJobConPasos('job-x', 'user-1');
    expect(result).toEqual([]);
    expect(sql.calls).toHaveLength(1);
  });
});
