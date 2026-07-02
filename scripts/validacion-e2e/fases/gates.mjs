/**
 * FASE 9 - GATES POR TIER: con el usuario bajado a 'free', crear una scheduled task debe dar 403
 * (gate server-side). Al final SIEMPRE se restaura 'autonomous' (aunque el 403 no llegue), para
 * que la limpieza y cualquier re-corrida partan de un estado conocido.
 */
export async function faseGates(ctx) {
  const { reporte, api, apiAdmin } = ctx;
  const F = 'FASE 9 GATES';
  if (!ctx.datos.identidadLista || !ctx.datos.agenteId || !ctx.datos.credencialId) {
    reporte.skip(F, 'toda la fase', 'sin identidad/agente/credencial (fase previa fallo)');
    return;
  }
  const uid = ctx.datos.usuario.id;

  const bajada = await apiAdmin(`/v1/admin/profiles/${uid}/tier`, { method: 'POST', body: { tier: 'free' } });
  if (bajada.status === 200 && bajada.body?.profile?.tier === 'free') {
    reporte.pass(F, "bajar tier a 'free' (admin)", 'profile.tier=free');
  } else {
    reporte.fail(F, "bajar tier a 'free' (admin)", `status ${bajada.status}: ${JSON.stringify(bajada.body)}`);
  }

  try {
    const intento = await api('/v1/scheduled-tasks', {
      method: 'POST',
      body: {
        agentId: ctx.datos.agenteId,
        credentialId: ctx.datos.credencialId,
        cronExpression: '0 0 1 1 *',
        payload: { messages: [{ role: 'user', content: 'E2E-VALIDACION: no debe crearse (gate free)' }] },
      },
    });
    if (intento.status === 403) {
      reporte.pass(F, 'crear scheduled task con tier free -> 403', `status 403: ${JSON.stringify(intento.body?.error?.message ?? intento.body).slice(0, 140)}`);
    } else {
      reporte.fail(F, 'crear scheduled task con tier free -> 403', `status ${intento.status}: ${JSON.stringify(intento.body).slice(0, 200)}`);
      // Si contra lo esperado se creo, se registra para que la limpieza la borre.
      if (intento.status === 201 && intento.body?.task?.id) ctx.datos.tareaGateId = intento.body.task.id;
    }
  } finally {
    const restaura = await apiAdmin(`/v1/admin/profiles/${uid}/tier`, { method: 'POST', body: { tier: 'autonomous' } });
    if (restaura.status === 200 && restaura.body?.profile?.tier === 'autonomous') {
      reporte.pass(F, "restaurar tier 'autonomous'", 'profile.tier=autonomous');
    } else {
      reporte.fail(F, "restaurar tier 'autonomous'", `status ${restaura.status}: ${JSON.stringify(restaura.body)}`);
    }
  }
}
