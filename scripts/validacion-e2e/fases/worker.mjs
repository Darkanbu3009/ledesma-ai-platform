import { esperarJobTerminal, resumenJob } from '../lib/jobs.mjs';

/**
 * FASE 5 - WORKER EN PRODUCCION (prueba de fuego del despliegue en Railway): receta de 2 pasos
 * encadenados, disparo manual -> 202 + jobId, y poll de la tabla jobs hasta 'completed'. Un job
 * que queda 'pending' para siempre significa que el worker desplegado NO esta tomando jobs.
 */
export async function faseWorker(ctx) {
  const { db, reporte, api } = ctx;
  const F = 'FASE 5 WORKER';
  if (!ctx.datos.agenteId || !ctx.datos.credencialId) {
    reporte.skip(F, 'toda la fase', 'sin agente o credencial (fase previa fallo)');
    return;
  }

  const receta = await api('/v1/recipes', {
    method: 'POST',
    body: {
      agentId: ctx.datos.agenteId,
      credentialId: ctx.datos.credencialId,
      name: 'E2E-VALIDACION receta',
      description: 'Receta temporal de la validacion end-to-end. Se borra al final.',
      steps: [
        { message: 'Di el numero 7' },
        { message: 'Suma 1 al numero que dijiste y responde solo el resultado' },
      ],
    },
  });
  if (receta.status === 201 && receta.body?.recipe?.id) {
    ctx.datos.recetaId = receta.body.recipe.id;
    reporte.pass(F, 'POST /v1/recipes -> 201', `id=${receta.body.recipe.id}, pasos=${receta.body.recipe.steps?.length}`);
  } else {
    reporte.fail(F, 'POST /v1/recipes -> 201', `status ${receta.status}: ${JSON.stringify(receta.body)}`);
    return;
  }

  const disparo = await api(`/v1/recipes/${ctx.datos.recetaId}/run`, { method: 'POST' });
  if (disparo.status === 202 && disparo.body?.jobId) {
    ctx.datos.jobRecetaId = disparo.body.jobId;
    ctx.datos.jobsVistos.add(disparo.body.jobId);
    reporte.pass(F, 'POST /v1/recipes/:id/run -> 202 + jobId', `jobId=${disparo.body.jobId}`);
  } else {
    reporte.fail(F, 'POST /v1/recipes/:id/run -> 202 + jobId', `status ${disparo.status}: ${JSON.stringify(disparo.body)}`);
    return;
  }

  if (!ctx.datos.dbOk) {
    reporte.skip(F, 'job de receta completado por el worker', 'sin conexion a la base para pollear jobs');
    return;
  }
  const { desenlace, job } = await esperarJobTerminal(db, ctx.datos.usuario.id, ctx.datos.jobRecetaId, {
    plazoMs: 180_000,
  });
  if (desenlace === 'completed') {
    // status='completed' es el criterio de exito. last_error puede quedar NO nulo tras un reintento
    // transitorio exitoso (el worker no lo limpia en markCompleted): es evidencia, no un fallo.
    ctx.datos.workerVivo = true;
    if (job.last_error === null) {
      reporte.pass(F, 'job de receta completado por el worker', resumenJob(job));
    } else {
      reporte.pass(F, 'job de receta completado por el worker', `completado tras reintento(s); last_error previo: ${resumenJob(job)}`);
    }
  } else if (desenlace === 'timeout' && job?.status === 'pending') {
    reporte.fail(
      F,
      'job de receta completado por el worker',
      `EL WORKER DESPLEGADO NO ESTA TOMANDO JOBS: 3 min despues sigue 'pending' (${resumenJob(job)})`,
    );
  } else {
    reporte.fail(F, 'job de receta completado por el worker', `desenlace=${desenlace}, ${resumenJob(job)}`);
  }

  const detalle = await api(`/v1/recipes/${ctx.datos.recetaId}`);
  if (detalle.status === 200 && detalle.body?.recipe?.lastRunAt) {
    reporte.pass(F, 'receta con last_run_at actualizado', `lastRunAt=${detalle.body.recipe.lastRunAt}`);
  } else {
    reporte.fail(F, 'receta con last_run_at actualizado', `status ${detalle.status}, lastRunAt=${detalle.body?.recipe?.lastRunAt}`);
  }
}
