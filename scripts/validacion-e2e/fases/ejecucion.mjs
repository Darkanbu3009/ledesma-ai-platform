import { consumirSse } from '../lib/http.mjs';

/**
 * FASE 4 - AGENTE + EJECUCION DIRECTA: crea el agente de prueba (TEST_PROVIDER/TEST_MODEL, sin
 * tools) y ejecuta /v1/run/:agentId por SSE con la credencial guardada. Prompt minimo: la prueba
 * cuesta centavos. Se espera texto y un stop limpio (evento stop + done).
 */
export async function faseEjecucion(ctx) {
  const { env, reporte, api } = ctx;
  const F = 'FASE 4 EJECUCION';
  if (!ctx.datos.identidadLista || !ctx.datos.credencialId) {
    reporte.skip(F, 'toda la fase', 'sin identidad o credencial (fase previa fallo)');
    return;
  }

  const agente = await api('/v1/agents', {
    method: 'POST',
    body: {
      name: 'E2E-VALIDACION agente',
      description: 'Agente temporal de la validacion end-to-end automatizada. Se borra al final.',
      providerId: env.TEST_PROVIDER,
      model: env.TEST_MODEL,
      systemPrompt: 'Responde EXACTAMENTE lo que se te pide, sin agregar nada mas.',
      maxTokens: 64,
    },
  });
  if (agente.status === 201 && agente.body?.agent?.id) {
    ctx.datos.agenteId = agente.body.agent.id;
    reporte.pass(F, 'POST /v1/agents -> 201', `id=${agente.body.agent.id}, model=${agente.body.agent.model}`);
  } else {
    reporte.fail(F, 'POST /v1/agents -> 201', `status ${agente.status}: ${JSON.stringify(agente.body)}`);
    return;
  }

  const corrida = await consumirSse(`${env.API_BASE_URL}/v1/run/${ctx.datos.agenteId}`, {
    headers: { authorization: `Bearer ${ctx.datos.jwt}`, 'x-credential-id': ctx.datos.credencialId },
    body: { messages: [{ role: 'user', content: 'Responde solo: OK' }] },
  });
  const stopLimpio = corrida.stop !== null && corrida.error === null;
  const huboTexto = corrida.texto.trim().length > 0;
  if (corrida.status === 200 && stopLimpio && huboTexto) {
    reporte.pass(
      F,
      '/v1/run SSE con credencial guardada',
      `texto='${corrida.texto.trim().slice(0, 40)}', stop=${corrida.stop.reason}, tokens in/out=${corrida.stop.usage?.inputTokens}/${corrida.stop.usage?.outputTokens}`,
    );
  } else {
    reporte.fail(
      F,
      '/v1/run SSE con credencial guardada',
      `status ${corrida.status}, texto='${corrida.texto.slice(0, 60)}', stop=${JSON.stringify(corrida.stop)}, error=${JSON.stringify(corrida.error)}`,
    );
  }
}
