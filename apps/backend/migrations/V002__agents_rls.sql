-- Politicas RLS por owner_id para la tabla agents. Idempotente: este archivo se puede re-aplicar
-- contra una base que ya las tenga (prod) sin error, y produce el mismo estado en una base vacia.
--
-- El backend se conecta con el rol de servicio (pooler) que OMITE RLS; estas politicas son la
-- defensa para cualquier acceso con rol authenticated/anon (p.ej. si en el futuro la consola
-- llamara a PostgREST directo). El aislamiento principal lo aplica el backend filtrando por
-- owner_id; esto es la segunda capa.
--
-- No forzamos owner_id NOT NULL para no romper filas admin existentes con owner_id null.

-- Habilita RLS en agents. V001 crea la tabla sin RLS; en prod se habilito a mano. Habilitarlo aqui
-- (idempotente: re-habilitar no falla) hace que una recreacion desde cero tenga la misma postura.
alter table agents enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.

-- Lectura: un usuario autenticado solo ve sus agentes.
drop policy if exists "agents_select_own" on agents;
create policy "agents_select_own"
  on agents for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Insercion: solo puede crear agentes a su nombre.
drop policy if exists "agents_insert_own" on agents;
create policy "agents_insert_own"
  on agents for insert
  to authenticated
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Actualizacion: solo sus agentes.
drop policy if exists "agents_update_own" on agents;
create policy "agents_update_own"
  on agents for update
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'))
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Borrado: solo sus agentes.
drop policy if exists "agents_delete_own" on agents;
create policy "agents_delete_own"
  on agents for delete
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
