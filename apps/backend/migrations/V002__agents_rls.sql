-- Asegura que owner_id sea obligatorio para filas nuevas creadas via el endpoint por-usuario.
-- (No forzamos NOT NULL para no romper filas admin existentes con owner_id null.)

-- Politicas RLS por owner_id. RLS ya esta habilitado en la tabla (creada con "enable RLS").
-- El backend se conecta con el rol de servicio (pooler) que OMITE RLS; estas politicas son la
-- defensa para cualquier acceso con rol authenticated/anon (p.ej. si en el futuro la consola
-- llamara a PostgREST directo). El aislamiento principal lo aplica el backend filtrando por
-- owner_id; esto es la segunda capa.

-- Lectura: un usuario autenticado solo ve sus agentes.
create policy "agents_select_own"
  on agents for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Insercion: solo puede crear agentes a su nombre.
create policy "agents_insert_own"
  on agents for insert
  to authenticated
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Actualizacion: solo sus agentes.
create policy "agents_update_own"
  on agents for update
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'))
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Borrado: solo sus agentes.
create policy "agents_delete_own"
  on agents for delete
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
