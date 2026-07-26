import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
 * aqui se verifica el CONTRATO de la migracion de forma estatica, mismo enfoque que
 * migration-recetas-web.test.ts. Lo que mas importa comprobar: que la tabla NO tenga ninguna columna
 * de credencial (el login jamas se graba), que RLS solo exponga SELECT propio, y que la columna
 * `origen` de recetas_web se agregue sin tocar las filas existentes.
 */
const sql = readFileSync(new URL('../migrations/V036__grabaciones.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V036 (grabaciones)', () => {
  it('crea la tabla de forma idempotente', () => {
    expect(sql).toContain('create table if not exists grabaciones');
    expect(sql).toContain('create extension if not exists pgcrypto');
  });

  it('NO existe ninguna columna de contrasena ni de credencial (el login jamas se graba)', () => {
    for (const prohibida of ['password', 'contrasena', 'credencial', 'credential', 'secreto']) {
      expect(sql).not.toContain(`${prohibida} text`);
      expect(sql).not.toContain(`${prohibida} bytea`);
    }
  });

  it('tenancy text y referencias del sitio grabado', () => {
    expect(sql).toContain('owner_id text not null');
    expect(sql).not.toContain('owner_id uuid');
    expect(sql).toContain('connection_id uuid not null');
    expect(sql).toContain('dominio text not null');
    expect(sql).toContain('descripcion text not null');
  });

  it('estado y motivo acotados por CHECK, con los pasos como jsonb', () => {
    expect(sql).toContain("check ( estado in ('grabando', 'terminada', 'descartada') )");
    expect(sql).toContain(
      "'contrasena', 'vencida', 'demasiados_pasos', 'no_repetible', 'sitio_no_disponible'",
    );
    expect(sql).toContain("pasos jsonb not null default '[]'::jsonb");
    expect(sql).toContain('vista_en_vivo_url text');
    expect(sql).toContain('creada_en timestamptz not null default now()');
    expect(sql).toContain('actualizada_en timestamptz not null default now()');
  });

  it('RLS: habilitada, solo SELECT propio, sin policies de escritura (mismo patron que V024)', () => {
    expect(sql).toContain('alter table grabaciones enable row level security');
    expect(sql).toContain("owner_id = (auth.jwt() ->> 'sub')");
    expect(sql).toContain('for select');
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
    expect(sql).not.toContain('for delete');
  });

  it('REVOKE de escritura a los roles de cliente (cinturon y tirantes, igual que V024/V035)', () => {
    expect(sql).toContain('revoke insert, update, delete on grabaciones from authenticated, anon');
  });

  it('indice de listado por owner y estado', () => {
    expect(sql).toContain('on grabaciones (owner_id, estado)');
  });

  it('agrega origen a recetas_web con default seguro y CHECK idempotente', () => {
    expect(sql).toContain(
      "alter table recetas_web add column if not exists origen text not null default 'automatica'",
    );
    expect(sql).toContain("check (origen in ('automatica', 'grabacion'))");
    expect(sql).toContain('recetas_web_origen_check');
    // Ninguna otra tabla se toca y NADA se borra: la migracion es aditiva (el unico `drop table` del
    // archivo esta dentro del comentario que documenta como revertir).
    expect(sql).not.toContain('drop table if exists recetas_web');
    expect(sql).not.toContain('alter table sitios_conectados');
    expect(sql).not.toContain('delete from');
  });

  it('cabecera de aplicacion MANUAL y reversion documentada', () => {
    expect(sql).toContain('se aplica a mano en el sql editor');
    expect(sql).toContain('drop table if exists grabaciones;');
    expect(sql).toContain('alter table recetas_web drop column if exists origen;');
  });

  it('documenta el invariante del login y que una receta grabada no salta las protecciones', () => {
    expect(sql).toContain('el login jamas se graba');
    expect(sql).toContain('verificacion determinista');
  });
});
