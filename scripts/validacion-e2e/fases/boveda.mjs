/**
 * FASE 3 - BOVEDA DE CREDENCIALES: guarda la key real, verifica EN LA BASE que el cifrado es
 * real (encrypted_key no contiene la key en claro) y prueba el rechazo por mismatch de proveedor
 * (credencial de un proveedor contra agente de otro -> 400 antes de tocar al proveedor).
 */
export async function faseBoveda(ctx) {
  const { env, sql, reporte, api } = ctx;
  const F = 'FASE 3 BOVEDA';
  if (!ctx.datos.identidadLista) {
    reporte.skip(F, 'toda la fase', 'sin identidad de prueba (FASE 2 fallo)');
    return;
  }

  const creada = await api('/v1/credentials', {
    method: 'POST',
    body: {
      label: 'E2E-VALIDACION credencial',
      providerId: env.TEST_PROVIDER,
      apiKey: env.TEST_PROVIDER_API_KEY,
    },
  });
  if (creada.status === 201 && creada.body?.credential?.id) {
    ctx.datos.credencialId = creada.body.credential.id;
    reporte.pass(F, 'POST /v1/credentials -> 201', `id=${creada.body.credential.id}, providerId=${creada.body.credential.providerId}`);
  } else {
    reporte.fail(F, 'POST /v1/credentials -> 201', `status ${creada.status}: ${JSON.stringify(creada.body)}`);
    return;
  }

  if (ctx.datos.dbOk) {
    const filas = await sql`
      select encrypted_key from provider_credentials
      where id = ${ctx.datos.credencialId} and owner_id = ${ctx.datos.usuario.id}
    `;
    const cifrada = filas[0]?.encrypted_key ?? '';
    if (cifrada === '') {
      reporte.fail(F, 'cifrado real en DB (encrypted_key)', 'fila no encontrada en provider_credentials');
    } else if (cifrada.includes(env.TEST_PROVIDER_API_KEY)) {
      reporte.fail(F, 'cifrado real en DB (encrypted_key)', 'LA KEY ESTA EN CLARO EN LA BASE');
    } else {
      reporte.pass(
        F,
        'cifrado real en DB (encrypted_key)',
        `blob base64url de ${cifrada.length} chars, sin la key en claro (AES-256-GCM iv|tag|ciphertext)`,
      );
    }
  } else {
    reporte.skip(F, 'cifrado real en DB (encrypted_key)', 'sin conexion a la base');
  }

  // Mismatch: agente de OTRO proveedor + esta credencial guardada -> 400 (nunca llega al proveedor,
  // asi que el modelo del agente-anzuelo no importa).
  const otroProveedor = env.TEST_PROVIDER === 'anthropic' ? 'openai' : 'anthropic';
  const agenteAnzuelo = await api('/v1/agents', {
    method: 'POST',
    body: {
      name: 'E2E-VALIDACION agente mismatch (no ejecutar)',
      providerId: otroProveedor,
      model: otroProveedor === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-5',
      systemPrompt: 'E2E-VALIDACION: agente anzuelo para la prueba de mismatch; no debe ejecutarse.',
    },
  });
  if (agenteAnzuelo.status !== 201) {
    reporte.fail(F, 'mismatch de proveedor -> 400', `no se pudo crear el agente anzuelo (status ${agenteAnzuelo.status})`);
    return;
  }
  ctx.datos.agenteMismatchId = agenteAnzuelo.body.agent.id;

  const mismatch = await api(`/v1/run/${ctx.datos.agenteMismatchId}`, {
    method: 'POST',
    headers: { 'x-credential-id': ctx.datos.credencialId },
    body: { messages: [{ role: 'user', content: 'no debe ejecutarse' }] },
  });
  if (mismatch.status === 400) {
    reporte.pass(F, 'mismatch de proveedor -> 400', `status 400: ${JSON.stringify(mismatch.body?.message ?? mismatch.body).slice(0, 160)}`);
  } else {
    reporte.fail(F, 'mismatch de proveedor -> 400', `status ${mismatch.status}: ${JSON.stringify(mismatch.body).slice(0, 200)}`);
  }
}
