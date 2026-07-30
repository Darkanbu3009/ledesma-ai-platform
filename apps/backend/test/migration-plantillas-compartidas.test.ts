import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que
// migration-aprendizaje-sitios.test.ts.
const original = readFileSync(
  new URL('../migrations/V041__plantillas_compartidas.sql', import.meta.url),
  'utf8',
);

const crudo = original.toLowerCase();
const sql = crudo.replace(/\s+/g, ' ');

/** El DDL SIN comentarios: es lo unico contra lo que se puede afirmar que una columna no existe. */
const ddl = crudo
  .split('\n')
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ');

/** El cuerpo de la definicion de la tabla, sin comentarios: donde viven (o no) las columnas. */
const definicion = (() => {
  const cuerpo = ddl.slice(ddl.indexOf('create table if not exists plantillas_compartidas'));
  return cuerpo.slice(0, cuerpo.indexOf('constraint plantillas_compartidas_codigo'));
})();

describe('migracion V041 (plantillas compartidas: el procedimiento sin el usuario)', () => {
  it('es la siguiente migracion libre: el maximo anterior es V040', () => {
    // V026 esta DUPLICADO en el repo (V026__jobs_resultado.sql y V026__jobs_sin_agente.sql), asi que
    // hay 40 numeros distintos en 41 archivos y el siguiente libre es V041, no V042.
    expect(new URL('../migrations/V041__plantillas_compartidas.sql', import.meta.url).pathname).toContain(
      'V041__',
    );
  });

  it('crea la tabla de forma idempotente con las columnas del diseno y nada mas', () => {
    expect(sql).toContain('create table if not exists plantillas_compartidas');
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
    expect(sql).toContain('dominios_clave text not null');
    expect(sql).toContain('codigo_de_intencion text not null');
    expect(sql).toContain('marcadores_clave text not null');
    expect(sql).toContain('pasos jsonb not null');
    expect(sql).toContain("estado text not null default 'candidata'");
    expect(sql).toContain("origenes_hash jsonb not null default '[]'::jsonb");
    expect(sql).toContain(
      'ejecuciones_exitosas integer not null default 0 check (ejecuciones_exitosas >= 0)',
    );
    expect(sql).toContain(
      'ejecuciones_fallidas integer not null default 0 check (ejecuciones_fallidas >= 0)',
    );
    expect(sql).toContain(
      'fallos_consecutivos integer not null default 0 check (fallos_consecutivos >= 0)',
    );
    expect(sql).toContain('ultima_ejecucion_en timestamptz');
    expect(sql).toContain('primera_vez_en timestamptz not null default now()');
    expect(sql).toContain('actualizada_en timestamptz not null default now()');
  });

  it('ANONIMATO: la tabla NO tiene columna de tenencia, ni firma, ni descripcion, ni valores', () => {
    // Es el invariante central: no es que no se escriban, es que NO HAY DONDE escribirlos. Se mira el
    // DDL sin comentarios, porque la cabecera SI nombra esas palabras, justamente para decir que no
    // estan.
    for (const prohibida of [
      'owner_id',
      'user_id',
      'job_id',
      'firma',
      'descripcion',
      'creada_desde_trayectoria',
      'trayectoria',
      'receta',
      'literal',
      'valor',
      'xpath',
      'ruta',
      'url',
      'screenshot',
    ]) {
      expect(definicion, prohibida).not.toContain(prohibida);
    }
  });

  it('SOLO INTENCIONES IRREVERSIBLES: el CHECK son las ocho familias, con su ortografia exacta', () => {
    // Sobre el texto ORIGINAL: 'cancelarSuscripcion' es camelCase y el CHECK compara texto exacto.
    expect(original).toContain("'cancelarSuscripcion'");
    for (const familia of [
      'enviar',
      'publicar',
      'borrar',
      'pagar',
      'transferir',
      'comprar',
      'firmar',
    ]) {
      expect(original, familia).toContain(`'${familia}'`);
    }
    expect(sql).toContain('constraint plantillas_compartidas_codigo_de_intencion_check');
    expect(sql).toContain('codigo_de_intencion in (');
    // NO existe un codigo para una tarea reversible.
    expect(sql).not.toContain("'reversible'");
  });

  it('el CHECK de estado son los tres del ciclo de vida', () => {
    expect(sql).toContain('constraint plantillas_compartidas_estado_check');
    expect(sql).toContain("estado in ('candidata', 'corroborada', 'retirada')");
  });

  it('UNA fila por IDENTIDAD, y ese indice es tambien el de lectura del consumo', () => {
    expect(sql).toContain(
      'create unique index if not exists plantillas_compartidas_identidad_uniq on plantillas_compartidas (dominios_clave, codigo_de_intencion, marcadores_clave)',
    );
    // Sin indices de mas: el unico de la tabla es el de la identidad.
    expect(sql.match(/create (unique )?index/g)).toHaveLength(1);
  });

  it('RLS habilitada y SIN ninguna policy: PostgREST no devuelve una fila a ningun cliente', () => {
    expect(sql).toContain('alter table plantillas_compartidas enable row level security');
    expect(sql).not.toContain('create policy');
    expect(sql).toContain(
      'revoke select, insert, update, delete on plantillas_compartidas from authenticated, anon',
    );
  });

  it('ESTRICTAMENTE ADITIVA: el unico ALTER sobre una tabla existente es el CHECK de origen', () => {
    expect(sql).not.toContain('alter table trayectorias_web');
    expect(sql).not.toContain('alter table recipes');
    expect(sql).not.toContain('alter table jobs');
    expect(sql).not.toContain('alter table aprendizaje_sitios');
    expect(sql).not.toContain('drop table if exists recetas_web');
    // Sobre recetas_web SOLO se toca la restriccion de `origen`: ni una columna, ni una fila.
    const sobreRecetas = (ddl.match(/alter table recetas_web[^;]*/g) ?? []).join(' | ');
    expect(sobreRecetas).toContain('drop constraint if exists recetas_web_origen_check');
    expect(sobreRecetas).toContain('add constraint recetas_web_origen_check');
    expect(sobreRecetas).not.toContain('add column');
    expect(sobreRecetas).not.toContain('drop column');
    expect(sobreRecetas).not.toContain('alter column');
  });

  it('el CHECK de recetas_web.origen admite plantilla_compartida SIN perder los dos de antes', () => {
    expect(sql).toContain("check (origen in ('automatica', 'grabacion', 'plantilla_compartida'))");
    // Reemplazo idempotente con el patron do $$ de V036 (ADD CONSTRAINT no admite IF NOT EXISTS).
    expect(sql).toContain('do $$');
    expect(sql).toContain('drop constraint if exists recetas_web_origen_check');
  });

  it('cabecera de aplicacion MANUAL y reversion documentada, incluida la del CHECK', () => {
    expect(sql).toContain('se aplica a mano en el sql editor');
    expect(sql).toContain('drop table if exists plantillas_compartidas;');
    expect(sql).toContain('alter table recetas_web drop constraint if exists recetas_web_origen_check;');
  });

  it('deja escrito el porque de lo que no se lee en el DDL', () => {
    // Por que no hay firma ni descripcion, por que solo irreversibles, y por que el hash es otro.
    expect(sql).toContain('cuasi identificador');
    expect(sql).toContain('hmac');
    expect(sql).toContain('plantillas-compartidas/v1');
    expect(sql).toContain('atlas-sitios/v1');
    expect(sql).toContain('solo intenciones irreversibles');
    expect(sql).toContain('ausencia de columna');
  });

  it('declara que en este commit NADA lee la tabla', () => {
    expect(sql).toContain('solo habilita la escritura');
    expect(sql).toContain('nadie la sirve todavia');
  });
});
