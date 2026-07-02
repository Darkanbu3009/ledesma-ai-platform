import postgres from 'postgres';

/**
 * Conexion DIRECTA a la base de produccion (misma DATABASE_URL del backend) para las
 * verificaciones que la API no expone: auditoria de migraciones, cifrado en reposo, la cola
 * `jobs` y la verificacion de limpieza. Reusa la libreria `postgres` que ya usa el backend
 * (cero dependencias nuevas; se resuelve desde node_modules de la raiz del workspace).
 *
 * prepare:false para ser compatible con el pooler de Supabase en modo transaccion (los prepared
 * statements no sobreviven al pooling); inofensivo contra una conexion directa.
 */
export function conectarDb(databaseUrl) {
  return postgres(databaseUrl, {
    prepare: false,
    max: 3,
    idle_timeout: 10,
    connect_timeout: 20,
    onnotice: () => {},
  });
}

/** true si la tabla existe en el schema public. */
export async function existeTabla(sql, nombre) {
  const filas = await sql`select to_regclass(${'public.' + nombre}) as reg`;
  return filas[0]?.reg !== null;
}

/** true si existe una funcion con ese nombre en el schema public. */
export async function existeFuncion(sql, nombre) {
  const filas = await sql`
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${nombre} limit 1
  `;
  return filas.length > 0;
}

/**
 * Estado de un job de pg_cron por nombre. Devuelve { existe, activo, schedule } o
 * { consultable:false } si la base no deja leer cron.job (permisos / extension ausente).
 */
export async function estadoCronJob(sql, jobname) {
  try {
    const filas = await sql`select jobname, schedule, active from cron.job where jobname = ${jobname}`;
    const fila = filas[0];
    if (!fila) return { consultable: true, existe: false, activo: false, schedule: null };
    return { consultable: true, existe: true, activo: fila.active === true, schedule: fila.schedule };
  } catch (error) {
    return { consultable: false, error: error instanceof Error ? error.message : 'desconocido' };
  }
}
