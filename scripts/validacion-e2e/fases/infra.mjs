import { existeTabla, existeFuncion, estadoCronJob } from '../lib/db.mjs';

const TABLAS_CLAVE = [
  'agents',
  'agent_runs',
  'profiles',
  'organizations',
  'subscriptions',
  'usage_counters',
  'provider_credentials',
  'jobs',
  'scheduled_tasks',
  'triggers',
  'recipes',
  'consents',
  'data_subject_requests',
  'processing_records',
];

const FUNCIONES_CLAVE = ['enqueue_due_scheduled_tasks', 'scheduler_cron_next', 'retention_purge_expired'];

/** FASE 1 - INFRA: salud del API, conexion a la base y auditoria de migraciones V001..V016. */
export async function faseInfra(ctx) {
  const { sql, reporte, api } = ctx;
  const F = 'FASE 1 INFRA';

  const salud = await api('/health');
  if (salud.status === 200 && salud.body?.status === 'ok') {
    reporte.pass(F, 'GET /health -> 200', JSON.stringify(salud.body));
  } else {
    reporte.fail(F, 'GET /health -> 200', `status ${salud.status}: ${JSON.stringify(salud.body)}`);
  }

  try {
    const filas = await sql`select current_database() as db, version() as version`;
    reporte.pass(F, 'conexion a DATABASE_URL', `db=${filas[0].db}, ${String(filas[0].version).split(' on ')[0]}`);
    ctx.datos.dbOk = true;
  } catch (error) {
    reporte.fail(F, 'conexion a DATABASE_URL', error.message);
    ctx.datos.dbOk = false;
    return; // sin base no hay auditoria ni fases con verificacion en DB
  }

  const tablasFaltantes = [];
  for (const tabla of TABLAS_CLAVE) {
    if (!(await existeTabla(sql, tabla))) tablasFaltantes.push(tabla);
  }
  const funcionesFaltantes = [];
  for (const fn of FUNCIONES_CLAVE) {
    if (!(await existeFuncion(sql, fn))) funcionesFaltantes.push(fn);
  }
  if (tablasFaltantes.length === 0 && funcionesFaltantes.length === 0) {
    reporte.pass(F, 'auditoria de migraciones (tablas + funciones)', `${TABLAS_CLAVE.length} tablas y ${FUNCIONES_CLAVE.length} funciones presentes`);
  } else {
    reporte.fail(
      F,
      'auditoria de migraciones (tablas + funciones)',
      `faltan tablas: [${tablasFaltantes.join(', ')}] funciones: [${funcionesFaltantes.join(', ')}]`,
    );
  }

  // El nombre REAL del job en V011 es 'enqueue-due-scheduled-tasks' (el plan lo llamaba
  // 'enqueue-due-tasks'); se consultan ambos y se reporta el que exista.
  const cronScheduler = await estadoCronJob(sql, 'enqueue-due-scheduled-tasks');
  const cronSchedulerAlias = cronScheduler.existe ? cronScheduler : await estadoCronJob(sql, 'enqueue-due-tasks');
  const cronElegido = cronScheduler.existe ? cronScheduler : cronSchedulerAlias;
  if (!cronElegido.consultable) {
    reporte.fail(F, "cron 'enqueue-due-scheduled-tasks' activo", `cron.job no consultable: ${cronElegido.error}`);
  } else if (cronElegido.existe && cronElegido.activo) {
    reporte.pass(F, "cron 'enqueue-due-scheduled-tasks' activo", `schedule='${cronElegido.schedule}'`);
  } else {
    reporte.fail(
      F,
      "cron 'enqueue-due-scheduled-tasks' activo",
      cronElegido.existe ? 'existe pero active=false' : 'no existe en cron.job (V011 sin aplicar?)',
    );
  }

  // Retencion (V016): INFORMATIVO, no falla la validacion.
  const cronRetencion = await estadoCronJob(sql, 'retention-purge-expired');
  if (!cronRetencion.consultable) {
    reporte.info(F, "cron retencion 'retention-purge-expired' (V016)", `cron.job no consultable: ${cronRetencion.error}`);
  } else {
    reporte.info(
      F,
      "cron retencion 'retention-purge-expired' (V016)",
      cronRetencion.existe
        ? `existe, active=${cronRetencion.activo}, schedule='${cronRetencion.schedule}'`
        : 'NO programado (la retencion corre solo on-demand via POST /v1/admin/retention/purge)',
    );
  }
}
