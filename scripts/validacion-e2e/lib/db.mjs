/**
 * Auditoria de la base via PostgREST (HTTPS). El entorno de ejecucion solo permite salida HTTPS, asi
 * que no hay conexion postgres directa: lo que se puede verificar es la EXISTENCIA/accesibilidad de
 * las tablas del schema public (probe REST). El catalogo de funciones (pg_proc) y el schema `cron`
 * NO estan expuestos por PostgREST; esas piezas se auditan de forma FUNCIONAL en las fases (que el
 * scheduler encole y el worker complete un job prueba toda la cadena SQL: enqueue_due_scheduled_tasks
 * + scheduler_cron_next + el cron pg_cron activo).
 */

/** Devuelve las tablas de `esperadas` que NO existen/accesibles via PostgREST. */
export async function tablasFaltantes(db, esperadas) {
  const faltantes = [];
  for (const tabla of esperadas) {
    if (!(await db.existeTabla(tabla))) faltantes.push(tabla);
  }
  return faltantes;
}
