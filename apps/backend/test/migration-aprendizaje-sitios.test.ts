import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que
// migration-recetas-web-ganadoras.test.ts.
const crudo = readFileSync(
  new URL('../migrations/V040__aprendizaje_sitios.sql', import.meta.url),
  'utf8',
).toLowerCase();

const sql = crudo.replace(/\s+/g, ' ');

/** El DDL SIN comentarios: es lo unico contra lo que se puede afirmar que una columna no existe. */
const ddl = crudo
  .split('\n')
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ');

describe('migracion V040 (atlas de sitios: aprendizaje colectivo por dominio)', () => {
  it('crea la tabla de forma idempotente con las columnas del diseno', () => {
    expect(sql).toContain('create table if not exists aprendizaje_sitios');
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
    expect(sql).toContain('dominio text not null');
    expect(sql).toContain('clase_de_elemento text not null');
    expect(sql).toContain('estrategias jsonb not null');
    expect(sql).toContain('corroboraciones integer not null default 1 check (corroboraciones >= 1)');
    expect(sql).toContain("origenes_hash jsonb not null default '[]'::jsonb");
    expect(sql).toContain('primera_vez_en timestamptz not null default now()');
    expect(sql).toContain('actualizada_en timestamptz not null default now()');
  });

  it('ANONIMATO: la tabla NO tiene ninguna columna de tenencia ni de origen rastreable', () => {
    // Es el invariante central: no es que no se escriban, es que no hay donde escribirlos. Se mira
    // el DDL sin comentarios: la cabecera SI nombra esas palabras, justamente para decir que no estan.
    const cuerpo = ddl.slice(ddl.indexOf('create table if not exists aprendizaje_sitios'));
    const definicion = cuerpo.slice(0, cuerpo.indexOf(');'));
    expect(definicion).not.toContain('owner_id');
    expect(definicion).not.toContain('user_id');
    expect(definicion).not.toContain('job_id');
    expect(definicion).not.toContain('trayectoria');
    expect(definicion).not.toContain('receta');
    expect(definicion).not.toContain('valor');
    expect(definicion).not.toContain('screenshot');
    expect(definicion).not.toContain('url');
  });

  it('UNA fila por estructura, con el dominio como columna izquierda del indice', () => {
    expect(sql).toContain(
      'create unique index if not exists aprendizaje_sitios_dominio_clase_uniq on aprendizaje_sitios (dominio, clase_de_elemento)',
    );
  });

  it('RLS habilitada y SIN ninguna policy: PostgREST no devuelve una fila a ningun cliente', () => {
    expect(sql).toContain('alter table aprendizaje_sitios enable row level security');
    expect(sql).not.toContain('create policy');
    expect(sql).toContain(
      'revoke select, insert, update, delete on aprendizaje_sitios from authenticated, anon',
    );
  });

  it('NO toca ninguna tabla anterior (recetas_web, trayectorias_web, recipes)', () => {
    expect(sql).not.toContain('alter table recetas_web');
    expect(sql).not.toContain('alter table trayectorias_web');
    expect(sql).not.toContain('alter table recipes');
    expect(sql).not.toContain('drop table if exists recetas_web');
  });

  it('cabecera de aplicacion MANUAL y reversion documentada', () => {
    expect(sql).toContain('se aplica a mano en el sql editor');
    expect(sql).toContain('drop table if exists aprendizaje_sitios;');
  });

  it('deja escrito el porque de las decisiones que no se leen en el DDL', () => {
    // El umbral de corroboracion, el hash no reversible y que el atlas no decide ninguna accion.
    expect(sql).toContain('al menos 2 origenes');
    expect(sql).toContain('hmac');
    expect(sql).toContain('verificacion determinista');
  });
});
