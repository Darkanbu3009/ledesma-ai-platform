import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica: que cree recetas_web con sus
// columnas y CHECKs, el unique PARCIAL de una sola receta activa por firma, los indices, RLS solo
// SELECT propio y el REVOKE de escritura, de forma idempotente y con reversion documentada. El
// comportamiento runtime (RecetasWebRepository) se cubre con mocks aparte. Mismo enfoque que
// migration-trayectorias-web.test.ts.
const sql = readFileSync(new URL('../migrations/V035__recetas_web.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V035 (recetas_web)', () => {
  it('crea la tabla de forma idempotente', () => {
    expect(sql).toContain('create table if not exists recetas_web');
    expect(sql).toContain('create extension if not exists pgcrypto');
  });

  it('NO toca la tabla recipes de V013 (son cosas distintas, ver desambiguacion)', () => {
    expect(sql).not.toContain('alter table recipes');
    expect(sql).not.toContain('drop table if exists recipes;');
    expect(sql).not.toContain('create table if not exists recipes');
  });

  it('tenancy text, dominio, firma del objetivo y version acotada por CHECK', () => {
    // owner_id es TEXT (sub del JWT), misma tenancy que jobs / trayectorias_web; jamas uuid.
    expect(sql).toContain('owner_id text not null');
    expect(sql).not.toContain('owner_id uuid');
    expect(sql).toContain('dominio text not null');
    expect(sql).toContain('firma_objetivo text not null');
    expect(sql).toContain('version integer not null default 1 check (version >= 1)');
  });

  it('estado acotado a activa u obsoleta y pasos como jsonb obligatorio', () => {
    expect(sql).toContain("check (estado in ('activa', 'obsoleta'))");
    expect(sql).toContain('pasos jsonb not null');
    expect(sql).toContain('creada_desde_trayectoria uuid');
  });

  it('contadores de uso con CHECK no negativo y marcas de tiempo', () => {
    expect(sql).toContain('ejecuciones_exitosas integer not null default 0 check (ejecuciones_exitosas >= 0)');
    expect(sql).toContain('ejecuciones_fallidas integer not null default 0 check (ejecuciones_fallidas >= 0)');
    expect(sql).toContain('ultima_ejecucion_en timestamptz');
    expect(sql).toContain('creada_en timestamptz not null default now()');
    expect(sql).toContain('actualizada_en timestamptz not null default now()');
  });

  it('UNA sola receta ACTIVA por owner, dominio y firma (unique PARCIAL)', () => {
    expect(sql).toContain(
      'create unique index if not exists recetas_web_activa_uniq on recetas_web (owner_id, dominio, firma_objetivo) where estado = \'activa\'',
    );
  });

  it('indice de busqueda por owner y dominio', () => {
    expect(sql).toContain('on recetas_web (owner_id, dominio)');
  });

  it('RLS: habilitada, solo SELECT propio, sin policies de escritura (mismo patron que V024)', () => {
    expect(sql).toContain('alter table recetas_web enable row level security');
    expect(sql).toContain("owner_id = (auth.jwt() ->> 'sub')");
    expect(sql).toContain('for select');
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
    expect(sql).not.toContain('for delete');
  });

  it('REVOKE de escritura a los roles de cliente (cinturon y tirantes, igual que V024/V034)', () => {
    expect(sql).toContain('revoke insert, update, delete on recetas_web from authenticated, anon');
  });

  it('cabecera de aplicacion MANUAL y reversion documentada', () => {
    expect(sql).toContain('se aplica a mano en el sql editor');
    expect(sql).toContain('drop table if exists recetas_web;');
  });

  it('documenta que la receta NO guarda valores tecleados ni salta la verificacion', () => {
    expect(sql).toContain('marcador');
    expect(sql).toContain('verificacion determinista');
  });
});
