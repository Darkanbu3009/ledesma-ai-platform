-- MOTIVO DEL ULTIMO FALLO de una plantilla compartida (V042). Evidencia de produccion del 3 ago
-- 2026: la primera plantilla consumida quedo con ejecuciones_fallidas=1 y fallos_consecutivos=1, y
-- el POR QUE (la barrera de identidad bloqueo el paso del asunto) solo existia en el log del worker
-- y en la trayectoria de esa corrida, que no lleva el id de la plantilla. Los contadores de V041
-- alimentan el retiro, pero un retiro que no sabe distinguir "la barrera la bloqueo" de "el sitio ya
-- no muestra el efecto" retira por igual plantillas rotas y plantillas con mala suerte.
--
-- UNA sola columna, vocabulario CERRADO (el mismo de MOTIVOS_DE_FALLA_DE_PLANTILLA en
-- packages/shared/src/plantillas/contrato.ts):
--   - barrera_bloqueada: la barrera de identidad bloqueo un paso y la plantilla se abandono;
--   - sin_efecto: corrio entera y el sitio no mostro que la accion surtiera efecto;
--   - abandonada: un paso no se pudo ejecutar de forma determinista;
--   - sesion: la sesion de navegador dejo de responder a mitad de la ejecucion.
--
-- LOS CONTADORES NO CAMBIAN DE SEMANTICA. Esto solo dice por que fue el ULTIMO fallo; un exito la
-- limpia (NULL), igual que un exito pone fallos_consecutivos en 0. NADA del usuario entra aqui: el
-- valor es uno de cuatro codigos de la plataforma.

alter table plantillas_compartidas
  add column ultima_falla_motivo text
    check (
      ultima_falla_motivo is null
      or ultima_falla_motivo in ('barrera_bloqueada', 'sin_efecto', 'abandonada', 'sesion')
    );

comment on column plantillas_compartidas.ultima_falla_motivo is
  'Motivo del ultimo fallo (vocabulario cerrado de la plataforma); NULL tras un exito o sin fallos.';
