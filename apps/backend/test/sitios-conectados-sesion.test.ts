import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SitiosConectadosRepository } from '../src/sitios/sitios-conectados-repository.js';
import type { Sql } from '../src/db/client.js';

/**
 * Cobertura de la EXTENSION 7.1b del repositorio de sitios conectados (V025: sesion de login en
 * vuelo) y del contrato estatico de la migracion V025. La base 7.1a (crear/obtener/cifrado/borrar)
 * ya esta cubierta en sitios-conectados-repository.test.ts; aca solo lo NUEVO.
 */

const SITIO_ID = '99999999-9999-4999-8999-999999999999';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITIO_ID,
    owner_id: 'user-1',
    dominio: 'app.ejemplo.com',
    url_login: 'https://app.ejemplo.com/login',
    contexto_externo_id: 'ctx-1',
    proxy_ref: 'browserbase',
    egress_ip: '203.0.113.7',
    fingerprint_ref: 'contexto:ctx-1',
    sesion_externa_id: 'ses-1',
    vista_en_vivo_url: 'https://live.browserbase.com/ses-1',
    estado: 'esperando_login',
    tiene_contexto: false,
    creado_en: '2026-07-16T00:00:00.000Z',
    ultimo_uso_en: null,
    expira_en: null,
    ...overrides,
  };
}

function makeSqlReturning(result: unknown[]): Sql {
  return vi.fn(async () => result) as unknown as Sql;
}

function sqlText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>').replace(/\s+/g, ' ');
}

function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[0] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('registrarSesionDeLogin', () => {
  it('inserta la conexion nueva con la terna pineada + sesion en vuelo, nace esperando_login', async () => {
    const sql = makeSqlReturning([makeRow()]);
    const sitio = await new SitiosConectadosRepository(sql).registrarSesionDeLogin({
      ownerId: 'user-1',
      dominio: 'app.ejemplo.com',
      urlLogin: 'https://app.ejemplo.com/login',
      contextoExternoId: 'ctx-1',
      proxyRef: 'browserbase',
      egressIp: '203.0.113.7',
      fingerprintRef: 'contexto:ctx-1',
      sesionExternaId: 'ses-1',
      vistaEnVivoUrl: 'https://live.browserbase.com/ses-1',
    });
    expect(sqlText(sql)).toContain('insert into sitios_conectados');
    expect(sqlText(sql)).toContain("'esperando_login'");
    expect(sitio).toMatchObject({
      sesionExternaId: 'ses-1',
      vistaEnVivoUrl: 'https://live.browserbase.com/ses-1',
      egressIp: '203.0.113.7',
      estado: 'esperando_login',
    });
  });
});

describe('reabrirParaLogin', () => {
  it('actualiza SOLO url/sesion/vista y estado; JAMAS toca la terna pineada ni el contexto cifrado', async () => {
    const sql = makeSqlReturning([makeRow()]);
    await new SitiosConectadosRepository(sql).reabrirParaLogin(SITIO_ID, 'user-1', {
      urlLogin: 'https://app.ejemplo.com/login',
      sesionExternaId: 'ses-2',
      vistaEnVivoUrl: 'https://live.browserbase.com/ses-2',
    });
    const texto = sqlText(sql);
    expect(texto).toContain('update sitios_conectados');
    expect(texto).toContain("estado = 'esperando_login'");
    // El SET no puede nombrar las columnas pineadas ni el blob (pin de por vida, V024).
    const set = texto.slice(0, texto.indexOf('where'));
    expect(set).not.toContain('proxy_ref =');
    expect(set).not.toContain('egress_ip =');
    expect(set).not.toContain('contexto_externo_id =');
    expect(set).not.toContain('fingerprint_ref =');
    expect(set).not.toContain('contexto_cifrado');
    // Acotado por id + owner.
    expect(sqlValues(sql)).toContain('user-1');
    expect(sqlValues(sql)).toContain(SITIO_ID);
  });
});

describe('cerrarLogin', () => {
  it('marca el estado terminal y limpia las referencias de la sesion en vuelo', async () => {
    const sql = makeSqlReturning([makeRow({ estado: 'error', sesion_externa_id: null, vista_en_vivo_url: null })]);
    const sitio = await new SitiosConectadosRepository(sql).cerrarLogin(SITIO_ID, 'user-1', 'error');
    const texto = sqlText(sql);
    expect(texto).toContain('sesion_externa_id = null');
    expect(texto).toContain('vista_en_vivo_url = null');
    expect(sitio?.estado).toBe('error');
    expect(sitio?.sesionExternaId).toBeNull();
  });
});

describe('listarEsperandoLoginVencidas', () => {
  it('filtra por estado esperando_login + creado_en < corte, SIN owner (tarea de plataforma) y sin blobs', async () => {
    const sql = makeSqlReturning([
      { id: SITIO_ID, owner_id: 'user-1', sesion_externa_id: 'ses-1' },
    ]);
    const filas = await new SitiosConectadosRepository(sql).listarEsperandoLoginVencidas(
      '2026-07-16T11:50:00.000Z',
    );
    const texto = sqlText(sql);
    expect(texto).toContain("estado = 'esperando_login'");
    expect(texto).toContain('creado_en <');
    expect(texto).not.toContain('contexto_cifrado');
    expect(filas).toEqual([{ id: SITIO_ID, ownerId: 'user-1', sesionExternaId: 'ses-1' }]);
  });
});

describe('guardarContexto (extension V025)', () => {
  it('al confirmar limpia la sesion en vuelo ademas de cifrar y activar', async () => {
    const sql = makeSqlReturning([
      makeRow({ estado: 'activo', tiene_contexto: true, sesion_externa_id: null, vista_en_vivo_url: null }),
    ]);
    await new SitiosConectadosRepository(sql).guardarContexto(
      SITIO_ID,
      'user-1',
      { contexto: '{"cookies":[]}' },
      '0123456789abcdef0123456789abcdef',
    );
    const texto = sqlText(sql);
    expect(texto).toContain('sesion_externa_id = null');
    expect(texto).toContain('vista_en_vivo_url = null');
  });
});

describe('migracion V025 (sesion de login en vuelo)', () => {
  const sql = readFileSync(new URL('../migrations/V025__sitios_conectados_sesion.sql', import.meta.url), 'utf8')
    .toLowerCase()
    .replace(/\s+/g, ' ');

  it('agrega las dos columnas de forma idempotente', () => {
    expect(sql).toContain('add column if not exists sesion_externa_id text');
    expect(sql).toContain('add column if not exists vista_en_vivo_url text');
  });

  it('agrega el indice del barrido (estado, creado_en)', () => {
    expect(sql).toContain(
      'create index if not exists sitios_conectados_estado_creado_idx on sitios_conectados (estado, creado_en)',
    );
  });

  it('no introduce ninguna columna de contrasena ni de contexto en claro', () => {
    expect(sql).not.toContain('password');
    expect(sql).not.toContain('contrasena');
    expect(sql).not.toContain('contexto_plano');
  });
});
