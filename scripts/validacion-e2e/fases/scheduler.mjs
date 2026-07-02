import { encontrarJobNuevo, esperarJobTerminal, resumenJob } from '../lib/jobs.mjs';

/** Marca unica en el payload para reconocer los jobs que encolo ESTA tarea (y no otra fuente). */
const MARCA = 'E2E-VALIDACION scheduler';

/**
 * FASE 6 - SCHEDULER: tarea cada minuto ('* * * * *') apuntando al agente de prueba. pg_cron
 * (enqueue_due_scheduled_tasks) debe encolar un job en <= ~2 min y el worker completarlo. La tarea
 * se DESACTIVA apenas se observa el primer job para que no siga encolando.
 */
export async function faseScheduler(ctx) {
  const { db, reporte, api } = ctx;
  const F = 'FASE 6 SCHEDULER';
  if (!ctx.datos.agenteId || !ctx.datos.credencialId) {
    reporte.skip(F, 'toda la fase', 'sin agente o credencial (fase previa fallo)');
    return;
  }
  if (!ctx.datos.dbOk) {
    reporte.skip(F, 'toda la fase', 'sin acceso a la base para observar la cola');
    return;
  }

  const tarea = await api('/v1/scheduled-tasks', {
    method: 'POST',
    body: {
      agentId: ctx.datos.agenteId,
      credentialId: ctx.datos.credencialId,
      cronExpression: '* * * * *',
      payload: { messages: [{ role: 'user', content: `${MARCA}: Responde solo: OK` }] },
    },
  });
  if (tarea.status === 201 && tarea.body?.task?.id) {
    ctx.datos.tareaId = tarea.body.task.id;
    reporte.pass(F, 'POST /v1/scheduled-tasks -> 201', `id=${tarea.body.task.id}, nextRunAt=${tarea.body.task.nextRunAt}`);
  } else {
    reporte.fail(F, 'POST /v1/scheduled-tasks -> 201', `status ${tarea.status}: ${JSON.stringify(tarea.body)}`);
    return;
  }

  // pg_cron corre cada minuto; el peor caso razonable para ver el job encolado es ~2.5 min.
  const jobEncolado = await encontrarJobNuevo(db, ctx.datos.usuario.id, ctx.datos.jobsVistos, MARCA, {
    plazoMs: 150_000,
  });

  // DESACTIVAR YA MISMO (antes de esperar la ejecucion): que no siga encolando cada minuto.
  const apagada = await api(`/v1/scheduled-tasks/${ctx.datos.tareaId}`, {
    method: 'PATCH',
    body: { isActive: false },
  });
  if (apagada.status === 200 && apagada.body?.task?.isActive === false) {
    reporte.pass(F, 'PATCH isActive:false (desactivacion inmediata)', `task.isActive=false`);
  } else {
    reporte.fail(F, 'PATCH isActive:false (desactivacion inmediata)', `status ${apagada.status}: ${JSON.stringify(apagada.body)}`);
  }

  if (jobEncolado === null) {
    reporte.fail(
      F,
      'pg_cron encolo un job de la tarea',
      "2.5 min sin job nuevo en la cola: enqueue_due_scheduled_tasks no corrio o el cron 'enqueue-due-scheduled-tasks' esta inactivo",
    );
    return;
  }
  ctx.datos.jobsVistos.add(jobEncolado.id);
  reporte.pass(F, 'pg_cron encolo un job de la tarea', `jobId=${jobEncolado.id}, encolado ${jobEncolado.created_at}`);

  const { desenlace, job } = await esperarJobTerminal(db, ctx.datos.usuario.id, jobEncolado.id, { plazoMs: 120_000 });
  if (desenlace === 'completed') {
    // Exito = status 'completed' (last_error no nulo solo indica un reintento transitorio previo).
    reporte.pass(F, 'worker completo el job del scheduler', resumenJob(job));
  } else {
    reporte.fail(F, 'worker completo el job del scheduler', `desenlace=${desenlace}, ${resumenJob(job)}`);
  }

  // Evidencia extra: la tarea avanzo last_run_at/next_run_at al disparar.
  const filas = await db.get(
    'scheduled_tasks',
    `id=eq.${ctx.datos.tareaId}&owner_id=eq.${ctx.datos.usuario.id}&select=last_run_at,next_run_at,is_active`,
  );
  if (filas[0]) {
    reporte.info(F, 'estado final de la tarea', `last_run_at=${filas[0].last_run_at}, is_active=${filas[0].is_active}`);
  }
}
