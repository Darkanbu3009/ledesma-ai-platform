-- ACEPTACIONES LEGALES: registro AUDITABLE y VERSIONADO de que documento acepto cada titular, en que
-- version y cuando. Sustituye a la tabla `consents` (V014) como fuente de verdad del consentimiento.
--
-- POR QUE UNA TABLA NUEVA Y NO UN ALTER SOBRE `consents`:
--   1. `consents` guarda la IP EN CLARO (columna ip_address) y el user-agent completo. Eso es un dato
--      personal conservado sin necesidad: para probar un consentimiento basta un identificador NO
--      REVERSIBLE que permita correlacionar sin volver a identificar al titular.
--   2. El vocabulario del dominio en este repo ya es espanol para todo lo nuevo (sitios_conectados V024,
--      trayectorias_web V030, politicas_ejecucion V034, recetas_web V035, grabaciones V036). La tabla del
--      consentimiento sigue esa convencion.
--
-- La columna ip_hash guarda HMAC-SHA256(secreto_del_backend, "aceptacion-legal-ip:v1|" || ip) en hex. Es
-- de UNA SOLA VIA: sin el secreto no se puede recuperar la IP, y el prefijo de dominio evita que el mismo
-- secreto produzca el mismo digest en otro uso. Nullable a proposito: si el backend no tiene secreto de
-- hash configurado, se guarda null (ausencia de evidencia) en vez de guardar la IP en claro.
--
-- MODELO DE VERSIONES: la version VIGENTE de cada documento NO vive en la base, vive como constante
-- versionada en el codigo (apps/backend/src/privacy/documents.ts, CURRENT_DOCUMENT_VERSIONS). El backend
-- compara lo aceptado contra esa constante y calcula que falta re-aceptar. Se eligio la constante y no una
-- tabla porque la version tiene que subir EN EL MISMO COMMIT que el texto del documento (que tambien vive
-- en el repo, apps/console/src/content/legal/): un dato en base permitiria que la version y el texto se
-- desincronicen entre despliegues, y la re-aceptacion masiva quedaria a un UPDATE de distancia sin
-- revision de codigo.
--
-- `consents` (V014) NO SE BORRA en esta migracion: se rellena de aqui hacia atras (backfill abajo) y queda
-- congelada como historico. Ninguna ruta escribe ya en ella. Cuando quieras retirarla, en una migracion
-- posterior y ya con el backfill verificado:
--   drop table if exists consents;
--
-- Tenancy: owner_id = sub del JWT (text), IDENTICO a agents (V001), jobs (V008), sitios_conectados (V024)
-- y el resto. El backend escribe con el rol de servicio (omite RLS); el aislamiento real es el WHERE
-- owner_id de cada query del repositorio. La policy RLS (solo SELECT propio) es la segunda capa: la
-- escritura ocurre server-side (POST /v1/consents con requireUser), nunca por PostgREST, porque exponer
-- INSERT por RLS permitiria a un cliente FALSEAR la evidencia de su propio consentimiento.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de Supabase
-- (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo es IDEMPOTENTE:
-- re-aplicarlo es un NO-OP y reproduce el mismo esquema en una base vacia. Revertir es limpio:
--   drop table if exists aceptaciones_legales;

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V014, se repite aqui por si V039 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists aceptaciones_legales (
  id          uuid primary key default gen_random_uuid(),
  -- Titular que acepto (sub del JWT). NOT NULL: una aceptacion SIEMPRE tiene dueno.
  owner_id    text not null,
  -- Documento aceptado. CHECK acotado a los documentos que la plataforma versiona hoy; ampliar el CHECK
  -- al sumar documentos (misma politica que el status de jobs).
  documento   text not null check (documento in ('aviso_privacidad', 'terminos')),
  -- Version aceptada (fecha ISO YYYY-MM-DD). El backend la compara contra la VIGENTE para saber si hace
  -- falta re-aceptar. Se guarda lo que el titular acepto, no lo vigente: asi una aceptacion vieja queda
  -- registrada tal cual y sigue contando como faltante de la version nueva.
  version     text not null,
  aceptada_en timestamptz not null default now(),
  -- HMAC-SHA256 hex (64 chars) de la IP del request. NO REVERSIBLE. null = no se capturo evidencia.
  ip_hash     text
);

-- Un titular acepta UNA vez cada version de cada documento: re-aceptar la MISMA version es idempotente
-- (el repositorio hace INSERT ... ON CONFLICT DO NOTHING). El unique cubre exactamente esa clave.
create unique index if not exists aceptaciones_legales_owner_doc_version_uniq
  on aceptaciones_legales (owner_id, documento, version);
-- Indice por titular: listar todo lo que acepto (GET /v1/consents/me, seccion del perfil).
create index if not exists aceptaciones_legales_owner_id_idx
  on aceptaciones_legales (owner_id);
-- Indice por titular y documento: resolver "que version de ESTE documento acepto" sin recorrer el resto.
create index if not exists aceptaciones_legales_owner_documento_idx
  on aceptaciones_legales (owner_id, documento);

alter table aceptaciones_legales enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "aceptaciones_legales_select_own" on aceptaciones_legales;
create policy "aceptaciones_legales_select_own"
  on aceptaciones_legales for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------------------------------------
-- BACKFILL desde `consents` (V014). Trae el historico para que a quien ya acepto no se le vuelva a pedir la
-- MISMA version. Mapea el vocabulario del wire (privacy_notice/terms) al de esta tabla.
--
-- ip_hash queda NULL en el backfill A PROPOSITO: el HMAC lo calcula el backend con un secreto que NO vive
-- en la base, y meterlo en un archivo de migracion versionado en git lo expondria. Prefiero registrar
-- "no hay evidencia de IP" antes que arrastrar la IP en claro a la tabla nueva.
--
-- Idempotente: el ON CONFLICT DO NOTHING contra el unique deja re-aplicar el archivo sin duplicar. El
-- guard de existencia evita fallar en una base nueva donde `consents` (V014) nunca se creo.
-- ---------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'consents') then
    insert into aceptaciones_legales (owner_id, documento, version, aceptada_en, ip_hash)
    select
      c.owner_id,
      case c.document_type when 'privacy_notice' then 'aviso_privacidad' else 'terminos' end,
      c.document_version,
      c.accepted_at,
      null
    from consents c
    where c.document_type in ('privacy_notice', 'terms')
    on conflict (owner_id, documento, version) do nothing;
  end if;
end
$$;

-- Para VERIFICAR el backfill:
--   select documento, count(*) from aceptaciones_legales group by documento;
