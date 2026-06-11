-- Corridas de agentes: SOLO metadatos. Nunca contenido de mensajes, nunca llaves.
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  owner_id text,
  provider_id text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  stop_reason text,
  status text not null check (status in ('completed', 'error', 'aborted')),
  error_code text,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists agent_runs_agent_created_idx on agent_runs (agent_id, created_at desc);

alter table agent_runs enable row level security;

create policy "agent_runs_select_own"
  on agent_runs for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
