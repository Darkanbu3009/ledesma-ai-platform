-- TRIGGERS POR EVENTO de la EJECUCION AUTONOMA (Fase 5.4). Un trigger es la DEFINICION de un webhook
-- ENTRANTE: un sistema de terceros le pega a una URL publica y, si el evento AUTENTICA, se ENCOLA un
-- job 'pending' en la cola `jobs` (V008) que el worker (5.2) ya ejecuta. Igual que scheduled_tasks
-- (V009) para el disparo por horario, un trigger NO ejecuta nada por si mismo: solo PRODUCE jobs.
-- El endpoint entrante copia agent_id, owner_id, credential_id y payload_template al job, exactamente
-- como el scheduler (V010) copia scheduled_tasks -> jobs.
--
-- SEGURIDAD (el punto critico): la ruta entrante es PUBLICA (sin JWT de usuario). Un trigger mal
-- autenticado dejaria que cualquiera queme las credenciales del cliente encolando ejecuciones. Por eso
-- cada trigger lleva UNO de dos mecanismos de autenticacion, y su material se guarda de forma NO
-- recuperable en claro:
--   * auth_mode = 'hmac'      -> hmac_secret_encrypted: el secreto HMAC CIFRADO con AES-256-GCM bajo
--                                VAULT_SECRET (apps/backend/src/crypto/aes-gcm.ts), idthat como la
--                                boveda de credenciales (V006.encrypted_key). El cliente firma cada
--                                POST y el backend verifica con verifyWebhookSignature (anti-replay).
--   * auth_mode = 'url_token' -> url_token_hash: el SHA-256 (hex) de un token impredecible. El token en
--                                claro se muestra UNA sola vez al crear/rotar (va en la URL del webhook)
--                                y NUNCA se persiste: si la base se filtra, el hash no permite firmar.
-- El secreto/token se muestra al usuario UNA vez (como una API key) y no se puede volver a mostrar.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE:
-- re-aplicarlo es un NO-OP y reproduce el mismo esquema en una base vacia.
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002), provider_credentials (V006),
-- jobs (V008) y scheduled_tasks (V009). El backend se conecta con el rol de servicio (pooler) que OMITE
-- RLS; el aislamiento real es el WHERE owner_id de cada query del repositorio. Las policies RLS de abajo
-- son la segunda capa.

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V009, se repite aqui por si V012 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists triggers (
  id                    uuid primary key default gen_random_uuid(),
  -- Dueno del trigger (sub del JWT). NOT NULL: un trigger autonomo SIEMPRE tiene dueno.
  owner_id              text not null,
  -- Agente a ejecutar cuando el evento dispara. on delete cascade (igual que jobs/scheduled_tasks):
  -- borrar el agente limpia sus triggers, y asi el disparo nunca encola un job para un agente inexistente.
  agent_id              uuid not null references agents(id) on delete cascade,
  -- QUE credencial de la boveda usar al ejecutar. Sin FK on delete (mismo criterio que jobs): si se
  -- borra la credencial, el trigger queda y los jobs que encole fallaran limpio al resolverla (PR 5.2).
  credential_id         uuid not null,
  -- Mecanismo de autenticacion del endpoint entrante para ESTE trigger.
  auth_mode             text not null check (auth_mode in ('hmac', 'url_token')),
  -- Secreto HMAC CIFRADO (AES-256-GCM bajo VAULT_SECRET). NUNCA en claro. Solo para auth_mode='hmac'.
  hmac_secret_encrypted text,
  -- SHA-256 (hex) del url_token impredecible. El token en claro no se guarda. Solo para auth_mode='url_token'.
  url_token_hash        text,
  -- Mensaje base ({ messages, maxIterations? }) que ejecuta el agente al dispararse; el endpoint
  -- entrante puede combinarlo con datos del evento (ver routes/incoming-triggers.ts). Mismo shape que
  -- el payload de un job / el body de /v1/run/:agentId.
  payload_template      jsonb not null default '{}'::jsonb,
  -- Pausar/activar sin borrar: el endpoint entrante solo dispara triggers activos (uno inactivo -> 404).
  is_active             boolean not null default true,
  -- Ultima vez que el endpoint entrante encolo un job para este trigger (ISO). null = nunca disparo.
  last_triggered_at     timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- COHERENCIA del material de auth: exactamente el secreto del auth_mode presente, el otro null. Evita
  -- un trigger 'hmac' sin secreto (que nadie podria firmar) o un 'url_token' con un secreto HMAC muerto.
  constraint triggers_auth_material_check check (
    (auth_mode = 'hmac' and hmac_secret_encrypted is not null and url_token_hash is null)
    or (auth_mode = 'url_token' and url_token_hash is not null and hmac_secret_encrypted is null)
  )
);

-- Indice por owner para el CRUD del usuario (listar sus triggers).
create index if not exists triggers_owner_id_idx on triggers (owner_id);
-- Unico PARCIAL sobre el hash del url_token: garantiza que dos triggers no compartan token y habilita,
-- si hiciera falta, resolver un trigger por su token (hoy el endpoint entrante resuelve por :id de la
-- URL y compara el hash en tiempo constante). where url_token_hash is not null: los triggers 'hmac' no
-- ocupan el indice ni chocan entre si por su url_token_hash NULL.
create unique index if not exists triggers_url_token_hash_key
  on triggers (url_token_hash)
  where url_token_hash is not null;

-- RLS por owner_id. triggers es una tabla OPERATIVA gestionada por la plataforma: la creacion y la
-- edicion JAMAS pasan por el cliente (ocurren server-side via el repositorio con el rol de servicio que
-- omite RLS), porque la CREACION debe pasar por el GATE POR TIER y la validacion de pertenencia del
-- backend, y porque genera material secreto. Igual que jobs (V008) y scheduled_tasks (V009), solo
-- exponemos SELECT al rol authenticated (para una futura vista "mis triggers", 5.4b). Aun via ese
-- SELECT, hmac_secret_encrypted esta CIFRADO y url_token_hash es un HASH: ninguno es usable para firmar.
-- Exponer INSERT/UPDATE via RLS permitiria saltarse el gate por tier: deliberadamente NO se hace.
alter table triggers enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "triggers_select_own" on triggers;
create policy "triggers_select_own"
  on triggers for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
