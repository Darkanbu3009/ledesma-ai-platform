import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que migration-recetas-web.test.ts.
const sql = readFileSync(
  new URL('../migrations/V038__recetas_web_ganadoras.sql', import.meta.url),
  'utf8',
)
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V038 (auto reparacion: ganadoras por paso y ajustes automaticos)', () => {
  it('agrega las columnas de forma idempotente y con defaults que no tocan lo existente', () => {
    expect(sql).toContain(
      "alter table recetas_web add column if not exists ganadoras jsonb not null default '{}'::jsonb",
    );
    expect(sql).toContain(
      'alter table recetas_web add column if not exists ajustes_automaticos integer not null default 0',
    );
    expect(sql).toContain('check (ajustes_automaticos >= 0)');
  });

  it('NO toca la tabla recipes de V013 (son cosas distintas)', () => {
    expect(sql).not.toContain('alter table recipes');
    expect(sql).not.toContain('create table if not exists recipes');
  });

  it('NO abre ninguna escritura por PostgREST: escribe solo el worker', () => {
    expect(sql).not.toContain('for delete');
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
    expect(sql).toContain('revoke insert, update, delete on recetas_web from authenticated, anon');
  });

  it('cabecera de aplicacion MANUAL y reversion documentada', () => {
    expect(sql).toContain('se aplica a mano en el sql editor');
    expect(sql).toContain('alter table recetas_web drop column if exists ganadoras;');
    expect(sql).toContain('alter table recetas_web drop column if exists ajustes_automaticos;');
  });

  it('deja escrito que el historial no lleva valores del sitio y que la escritura es atomica', () => {
    expect(sql).toContain('jamas su valor');
    expect(sql).toContain('un solo update');
    expect(sql).toContain('version');
  });
});
