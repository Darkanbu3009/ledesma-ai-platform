-- ANDAMIAJE DE PRIVACIDAD Y CUMPLIMIENTO (Fase 5.6). Tres tablas de accountability que la plataforma
-- necesita para operar agentes de forma AUTONOMA bajo la nueva LFPDPPP de Mexico (en vigor 21-mar-2025),
-- el GDPR (clientes internacionales) y el EU AI Act:
--
--   consents               -> registro VERSIONADO de la aceptacion del titular de un documento (aviso de
--                             privacidad / terminos). Consentimiento libre, especifico e informado: si el
--                             documento cambia de version (nueva finalidad), se requiere NUEVA aceptacion,
--                             por eso se versiona por (owner, document_type, document_version).
--   data_subject_requests  -> solicitudes de DERECHOS DEL TITULAR (ARCO de la ley mexicana + portabilidad/
--                             erasure de GDPR): acceso, rectificacion, cancelacion, oposicion, erasure.
--   processing_records     -> REGISTRO DE ACTIVIDADES DE TRATAMIENTO (espeja el Art 30 GDPR y el principio
--                             de responsabilidad de la LFPDPPP): que trata cada agente y para que.
--
-- El texto legal de los avisos NO vive aqui (lo redacta un abogado; la consola lo muestra con placeholders
-- [REVISION LEGAL PENDIENTE]). Esta tabla solo persiste QUE version acepto cada usuario y CUANDO.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de Supabase
-- (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE: re-aplicarlo
-- es un NO-OP y reproduce el mismo esquema en una base vacia.
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002), provider_credentials (V006),
-- jobs (V008), scheduled_tasks (V009), triggers (V012) y recipes (V013). El backend se conecta con el rol
-- de servicio (pooler) que OMITE RLS; el aislamiento real es el WHERE owner_id de cada query del
-- repositorio. Las policies RLS de abajo son la segunda capa. Estos son datos SENSIBLES de cumplimiento:
-- solo se expone SELECT propio; la escritura ocurre server-side (endpoints con requireUser).

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V009/V012/V013, se repite aqui por si V014 se
-- aplicara sola.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------------------
-- consents: aceptacion VERSIONADA de un documento por un titular. Un usuario acepta UNA version; si el
-- documento sube de version, la nueva version queda SIN aceptar hasta que la acepte de nuevo (el helper del
-- backend, missingConsents, calcula que falta). ip_address/user_agent son opcionales (evidencia del
-- consentimiento; nullable porque un consentimiento server-to-server podria no traerlos).
-- ---------------------------------------------------------------------------------------------------------
create table if not exists consents (
  id               uuid primary key default gen_random_uuid(),
  -- Titular que acepta (sub del JWT). NOT NULL: un consentimiento SIEMPRE tiene dueno.
  owner_id         text not null,
  -- Que documento se acepto. CHECK acotado a los tipos que la plataforma versiona hoy; ampliar el CHECK al
  -- sumar documentos (misma politica que status en jobs/data_subject_requests).
  document_type    text not null check (document_type in ('privacy_notice', 'terms')),
  -- Version del documento aceptada (fecha ISO o semver, texto libre). El backend compara contra la version
  -- VIGENTE (privacy/documents.ts) para saber si hace falta re-aceptar.
  document_version text not null,
  accepted_at      timestamptz not null default now(),
  -- Evidencia opcional del consentimiento (para auditoria). Nullable.
  ip_address       text,
  user_agent       text
);

-- Un titular acepta UNA vez cada version de cada documento: re-aceptar la MISMA version es idempotente
-- (el repo hace INSERT ... ON CONFLICT DO NOTHING). El unique cubre exactamente esa clave.
create unique index if not exists consents_owner_doc_version_uniq
  on consents (owner_id, document_type, document_version);
-- Indice por owner para listar los consentimientos del titular (GET /v1/consents/me).
create index if not exists consents_owner_id_idx on consents (owner_id);

alter table consents enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
-- Solo SELECT propio: la escritura ocurre server-side (POST /v1/consents con requireUser) con el rol de
-- servicio que omite RLS. Exponer INSERT via RLS permitiria falsear consentimientos por PostgREST.
drop policy if exists "consents_select_own" on consents;
create policy "consents_select_own"
  on consents for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------------------------------------
-- data_subject_requests: solicitudes de derechos del titular (ARCO + portabilidad/erasure). El titular
-- crea una solicitud (POST /v1/data-requests) y consulta su estado; la resolucion la hace la plataforma
-- (self-service para 'access', admin para el resto). resolved_at/resolution_note se llenan al resolver.
-- ---------------------------------------------------------------------------------------------------------
create table if not exists data_subject_requests (
  id              uuid primary key default gen_random_uuid(),
  -- Titular que solicita (sub del JWT). NOT NULL.
  owner_id        text not null,
  -- Tipo de derecho ejercido. ARCO de la ley mexicana (acceso/rectificacion/cancelacion/oposicion) +
  -- erasure de GDPR. El CHECK evita tipos invalidos; ampliar al sumar derechos (p.ej. portabilidad).
  request_type    text not null check (
                    request_type in ('access', 'rectification', 'cancellation', 'opposition', 'erasure')
                  ),
  -- Estado del ciclo de vida de la solicitud.
  status          text not null default 'pending' check (
                    status in ('pending', 'in_progress', 'completed', 'rejected')
                  ),
  -- Detalle libre del titular (que datos, que rectificacion, etc.). Puede ser null.
  details         text,
  created_at      timestamptz not null default now(),
  -- Cuando se resolvio (completed/rejected) y una nota de resolucion. null mientras siga abierta.
  resolved_at     timestamptz,
  resolution_note text
);

create index if not exists data_subject_requests_owner_id_idx on data_subject_requests (owner_id);
-- Indice para el panel admin (resolver por estado, mas viejas primero).
create index if not exists data_subject_requests_status_idx on data_subject_requests (status, created_at);

alter table data_subject_requests enable row level security;

-- Solo SELECT propio: el titular ve SUS solicitudes. La creacion y la resolucion ocurren server-side.
drop policy if exists "data_subject_requests_select_own" on data_subject_requests;
create policy "data_subject_requests_select_own"
  on data_subject_requests for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------------------------------------
-- processing_records: registro de actividades de tratamiento (accountability). Que trata cada agente y
-- para que. agent_id es NULLABLE (un tratamiento puede no estar ligado a un agente concreto) y con FK a
-- agents con on delete cascade (borrar el agente limpia sus registros, igual que jobs/scheduled_tasks).
-- ---------------------------------------------------------------------------------------------------------
create table if not exists processing_records (
  id              uuid primary key default gen_random_uuid(),
  -- Responsable del tratamiento (sub del JWT). NOT NULL.
  owner_id        text not null,
  -- Agente asociado al tratamiento (opcional). on delete cascade: borrar el agente limpia sus registros.
  agent_id        uuid references agents(id) on delete cascade,
  -- Finalidad del tratamiento (para que se tratan los datos).
  purpose         text not null,
  -- Categorias de datos tratados (texto descriptivo; p.ej. "contactos, mensajes de chat").
  data_categories text not null,
  created_at      timestamptz not null default now()
);

create index if not exists processing_records_owner_id_idx on processing_records (owner_id);
-- Indice por agente para listar los tratamientos de un agente (agent_id puede ser null: el indice los omite).
create index if not exists processing_records_agent_id_idx on processing_records (agent_id);

alter table processing_records enable row level security;

drop policy if exists "processing_records_select_own" on processing_records;
create policy "processing_records_select_own"
  on processing_records for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
