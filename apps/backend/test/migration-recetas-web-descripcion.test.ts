import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que migration-recetas-web.test.ts.
const sql = readFileSync(
  new URL('../migrations/V037__recetas_web_descripcion.sql', import.meta.url),
  'utf8',
)
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V037 (descripcion de lo que el usuario enseno)', () => {
  it('agrega la columna de forma idempotente y sin tocar los datos existentes', () => {
    expect(sql).toContain('alter table recetas_web add column if not exists descripcion text');
    // Sin NOT NULL y sin default: toda receta anterior queda en null, que es lo que era.
    expect(sql).not.toContain('descripcion text not null');
  });

  it('NO toca la tabla recipes de V013 (son cosas distintas)', () => {
    expect(sql).not.toContain('alter table recipes');
    expect(sql).not.toContain('create table if not exists recipes');
  });

  it('NO abre ninguna escritura por PostgREST: el borrado pasa por el backend', () => {
    expect(sql).not.toContain('for delete');
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
    expect(sql).toContain('revoke insert, update, delete on recetas_web from authenticated, anon');
  });

  it('cabecera de aplicacion MANUAL y reversion documentada', () => {
    expect(sql).toContain('se aplica a mano en el sql editor');
    expect(sql).toContain('alter table recetas_web drop column if exists descripcion;');
  });

  it('deja escrito que la descripcion no autoriza nada', () => {
    expect(sql).toContain('verificacion determinista');
    expect(sql).toContain('no autoriza nada');
  });
});
