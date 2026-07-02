import { tablasFaltantes } from '../lib/db.mjs';

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

/**
 * FASE 1 - INFRA: salud del API, acceso a la base (via PostgREST sobre HTTPS) y auditoria de
 * migraciones. NOTA de entorno: el runner solo tiene salida HTTPS, asi que la base se consulta por
 * PostgREST (no hay conexion postgres directa). Eso permite auditar la EXISTENCIA de las tablas
 * (V001..V014) pero NO el catalogo de funciones (pg_proc) ni el schema `cron`: esas piezas
 * (enqueue_due_scheduled_tasks, scheduler_cron_next y el cron 'enqueue-due-scheduled-tasks') se
 * verifican FUNCIONALMENTE en la Fase 6 (que el scheduler encole un job prueba toda la cadena).
 */
export async function faseInfra(ctx) {
  const { db, reporte, api } = ctx;
  const F = 'FASE 1 INFRA';

  const salud = await api('/health');
  if (salud.status === 200 && salud.body?.status === 'ok') {
    reporte.pass(F, 'GET /health -> 200', JSON.stringify(salud.body));
  } else {
    reporte.fail(F, 'GET /health -> 200', `status ${salud.status}: ${JSON.stringify(salud.body)}`);
  }

  try {
    const filas = await db.get('profiles', 'select=id&limit=1');
    reporte.pass(F, 'acceso a la base (PostgREST/HTTPS)', `lectura de profiles ok (${filas.length} fila de muestra)`);
    ctx.datos.dbOk = true;
  } catch (error) {
    reporte.fail(F, 'acceso a la base (PostgREST/HTTPS)', error.message);
    ctx.datos.dbOk = false;
    return;
  }

  const faltantes = await tablasFaltantes(db, TABLAS_CLAVE);
  if (faltantes.length === 0) {
    reporte.pass(F, 'auditoria de migraciones (tablas V001..V014)', `${TABLAS_CLAVE.length} tablas clave presentes y accesibles`);
  } else {
    reporte.fail(F, 'auditoria de migraciones (tablas V001..V014)', `faltan/inaccesibles: [${faltantes.join(', ')}]`);
  }

  reporte.info(
    F,
    'funciones y cron (enqueue_due_scheduled_tasks / scheduler_cron_next / cron pg_cron)',
    'no auditables por PostgREST desde el runner (pg_proc y schema cron no expuestos); se verifican funcionalmente en FASE 6 (el scheduler debe encolar un job)',
  );
  reporte.info(
    F,
    "cron de retencion 'retention-purge-expired' (V016)",
    'no auditable por PostgREST (schema cron no expuesto); es opt-in e informativo por diseno',
  );
}
