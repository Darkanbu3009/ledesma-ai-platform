import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica: que cree trayectorias_web y
// pasos_trayectoria con sus columnas, CHECKs, indices, RLS solo-SELECT por owner, el cascade de los
// pasos y la gemela SQL de la purga por retencion, de forma idempotente y con reversion documentada.
// El comportamiento runtime (TrayectoriasWebRepository) se cubre con mocks aparte. Mismo enfoque que
// migration-sitios-conectados.test.ts.
const sql = readFileSync(new URL('../migrations/V030__trayectorias_web.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V030 (trayectorias_web + pasos_trayectoria)', () => {
  it('crea ambas tablas de forma idempotente', () => {
    expect(sql).toContain('create table if not exists trayectorias_web');
    expect(sql).toContain('create table if not exists pasos_trayectoria');
    expect(sql).toContain('create extension if not exists pgcrypto');
  });

  it('trayectorias_web: tenancy text, referencias a job/conexion y desenlace acotado por CHECK', () => {
    // owner_id es TEXT (sub del JWT), misma tenancy que jobs/aprobaciones_web; jamas uuid.
    expect(sql).toContain('owner_id text not null');
    expect(sql).not.toContain('owner_id uuid');
    expect(sql).toContain('job_id uuid not null');
    expect(sql).toContain('connection_id uuid not null');
    expect(sql).toContain('dominio text not null');
    expect(sql).toContain('objetivo text not null');
    expect(sql).toContain("estado in ('exitosa', 'fallida', 'pausada')");
  });

  it('trayectorias_web: metricas de la ejecucion (tiempos, duracion, tokens)', () => {
    expect(sql).toContain('iniciada_en timestamptz not null');
    expect(sql).toContain('terminada_en timestamptz not null');
    expect(sql).toContain('duracion_ms integer not null check (duracion_ms >= 0)');
    expect(sql).toContain('tokens_in integer');
    expect(sql).toContain('tokens_out integer');
  });

  it('pasos_trayectoria: FK con ON DELETE CASCADE (los pasos viven y mueren con su trayectoria)', () => {
    expect(sql).toContain('references trayectorias_web(id) on delete cascade');
  });

  it('pasos_trayectoria: accion jsonb censurada, selector/valor/url nullables y orden unico por idx', () => {
    expect(sql).toContain('accion jsonb not null');
    expect(sql).toContain('valor_censurado text');
    expect(sql).not.toContain('valor_censurado text not null');
    expect(sql).toContain('selector text');
    expect(sql).toContain('idx integer not null check (idx >= 0)');
    expect(sql).toContain(
      'create unique index if not exists pasos_trayectoria_orden_uniq on pasos_trayectoria (trayectoria_id, idx)',
    );
  });

  it('indices de acceso: por owner, por job y por terminada_en (purga sin table scan)', () => {
    expect(sql).toContain('on trayectorias_web (owner_id, iniciada_en desc)');
    expect(sql).toContain('on trayectorias_web (job_id)');
    expect(sql).toContain('on trayectorias_web (terminada_en)');
  });

  it('RLS: habilitada en ambas tablas, solo SELECT propio (escrituras server-side)', () => {
    expect(sql).toContain('alter table trayectorias_web enable row level security');
    expect(sql).toContain('alter table pasos_trayectoria enable row level security');
    expect(sql).toContain("owner_id = (auth.jwt() ->> 'sub')");
    // Los pasos no llevan owner: su policy resuelve el dueno via la cabecera.
    expect(sql).toContain('t.id = pasos_trayectoria.trayectoria_id');
    // Ninguna policy de insert/update/delete: la escritura es del worker con rol de servicio.
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
    expect(sql).not.toContain('for delete');
  });

  it('purga por retencion: gemela SQL con default 30 dias sobre terminada_en', () => {
    expect(sql).toContain('create or replace function trayectorias_purge_expired');
    expect(sql).toContain('p_trayectorias_days integer default 30');
    expect(sql).toContain('terminada_en < now() - make_interval(days => p_trayectorias_days)');
  });

  it('reversion limpia documentada (drop de funcion y tablas en orden)', () => {
    expect(sql).toContain('drop function if exists trayectorias_purge_expired(integer)');
    expect(sql).toContain('drop table if exists pasos_trayectoria');
    expect(sql).toContain('drop table if exists trayectorias_web');
  });
});
