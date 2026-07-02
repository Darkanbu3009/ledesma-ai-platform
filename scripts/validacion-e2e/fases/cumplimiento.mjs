/**
 * FASE 8 - CUMPLIMIENTO: consentimiento versionado (privacy_notice vigente) y derechos del
 * titular (solicitud de acceso). Ambos scoped al usuario de prueba.
 */
export async function faseCumplimiento(ctx) {
  const { reporte, api } = ctx;
  const F = 'FASE 8 CUMPLIMIENTO';
  if (!ctx.datos.identidadLista) {
    reporte.skip(F, 'toda la fase', 'sin identidad de prueba (FASE 2 fallo)');
    return;
  }

  const estadoInicial = await api('/v1/consents/me');
  const versionVigente = estadoInicial.body?.current?.privacy_notice;
  if (estadoInicial.status === 200 && typeof versionVigente === 'string') {
    reporte.pass(
      F,
      'GET /v1/consents/me (antes)',
      `vigente privacy_notice=${versionVigente}, faltantes=${JSON.stringify(estadoInicial.body.missing)}`,
    );
  } else {
    reporte.fail(F, 'GET /v1/consents/me (antes)', `status ${estadoInicial.status}: ${JSON.stringify(estadoInicial.body)}`);
    return;
  }

  const consentimiento = await api('/v1/consents', {
    method: 'POST',
    body: { document_type: 'privacy_notice', document_version: versionVigente },
  });
  if (consentimiento.status === 201 && consentimiento.body?.consent) {
    reporte.pass(F, 'POST /v1/consents (privacy_notice vigente) -> 201', `documentVersion=${consentimiento.body.consent.documentVersion}`);
  } else {
    reporte.fail(F, 'POST /v1/consents (privacy_notice vigente) -> 201', `status ${consentimiento.status}: ${JSON.stringify(consentimiento.body)}`);
  }

  const estadoFinal = await api('/v1/consents/me');
  const faltantes = estadoFinal.body?.missing ?? null;
  if (estadoFinal.status === 200 && Array.isArray(faltantes) && faltantes.length === 0) {
    reporte.pass(F, 'GET /v1/consents/me -> sin faltantes', `missing=[]`);
  } else {
    reporte.fail(F, 'GET /v1/consents/me -> sin faltantes', `status ${estadoFinal.status}, missing=${JSON.stringify(faltantes)}`);
  }

  const solicitud = await api('/v1/data-requests', {
    method: 'POST',
    body: { request_type: 'access', details: 'E2E-VALIDACION solicitud de acceso automatizada' },
  });
  if (solicitud.status === 201 && solicitud.body?.request?.id) {
    ctx.datos.solicitudId = solicitud.body.request.id;
    reporte.pass(F, 'POST /v1/data-requests (access) -> 201', `id=${solicitud.body.request.id}, status=${solicitud.body.request.status}`);
  } else {
    reporte.fail(F, 'POST /v1/data-requests (access) -> 201', `status ${solicitud.status}: ${JSON.stringify(solicitud.body)}`);
  }

  const lista = await api('/v1/data-requests');
  const enLista = (lista.body?.requests ?? []).some((r) => r.id === ctx.datos.solicitudId);
  if (lista.status === 200 && enLista) {
    reporte.pass(F, 'GET /v1/data-requests lista la solicitud', `total=${lista.body.requests.length}`);
  } else {
    reporte.fail(F, 'GET /v1/data-requests lista la solicitud', `status ${lista.status}, enLista=${enLista}`);
  }

  // Extra informativo: el 'access' self-service (export) del titular.
  const exportacion = await api('/v1/data-requests/export');
  reporte.info(
    F,
    'GET /v1/data-requests/export (access self-service)',
    `status ${exportacion.status}, subjectId coincide=${exportacion.body?.export?.subjectId === ctx.datos.usuario.id}`,
  );
}
