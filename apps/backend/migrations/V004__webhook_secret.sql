-- Secreto de firma de webhooks por agente. La plataforma firma cada POST; el cliente verifica.
create extension if not exists pgcrypto;

alter table agents
  add column if not exists webhook_secret text not null
  default ('whsec_' || encode(gen_random_bytes(24), 'hex'));
-- Nota: default volatil => las filas existentes reciben cada una su propio secreto.
