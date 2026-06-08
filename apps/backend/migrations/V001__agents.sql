-- Tabla de configuracion de agentes. Guarda CONFIG, nunca llaves de proveedor.
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  provider_id text not null check (provider_id in ('anthropic', 'openai', 'openai-compatible')),
  model text not null,
  system_prompt text not null default '',
  max_tokens integer not null default 1024 check (max_tokens > 0 and max_tokens <= 32000),
  temperature double precision check (temperature >= 0 and temperature <= 2),
  base_url text,
  tools jsonb not null default '[]'::jsonb,
  owner_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agents_owner_id_idx on agents (owner_id);
