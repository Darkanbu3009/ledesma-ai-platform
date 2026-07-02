import { createHmac } from 'node:crypto';
import { pedirJson } from '../lib/http.mjs';
import { registrarSecreto } from '../lib/env.mjs';
import { encontrarJobNuevo, esperarJobTerminal, resumenJob } from '../lib/jobs.mjs';

/** Marcas unicas en el payload_template para reconocer los jobs de CADA trigger. */
const MARCA_HMAC = 'E2E-VALIDACION trigger hmac';
const MARCA_TOKEN = 'E2E-VALIDACION trigger url_token';

/** Firma cliente del webhook entrante: HMAC-SHA256 hex de `${timestamp}.${rawBody}`, header v1=. */
function firmar(secreto, timestamp, cuerpo) {
  return `v1=${createHmac('sha256', secreto).update(`${timestamp}.${cuerpo}`).digest('hex')}`;
}

/**
 * FASE 7 - TRIGGERS POR EVENTO: el webhook publico /webhooks/triggers/:id con los dos modos de
 * auth. hmac: firma valida -> 202 y el job completa; firma invalida -> 401; replay (timestamp
 * viejo, >300s) -> 401. url_token: token correcto -> 202 y el job completa; incorrecto -> 401.
 */
export async function faseTriggers(ctx) {
  const { env, db, reporte, api } = ctx;
  const F = 'FASE 7 TRIGGERS';
  if (!ctx.datos.agenteId || !ctx.datos.credencialId) {
    reporte.skip(F, 'toda la fase', 'sin agente o credencial (fase previa fallo)');
    return;
  }

  const cuerpoEvento = JSON.stringify({ fuente: 'E2E-VALIDACION', evento: 'prueba-webhook' });

  // ---- Trigger HMAC -------------------------------------------------------------------------
  const th = await api('/v1/triggers', {
    method: 'POST',
    body: {
      agentId: ctx.datos.agenteId,
      credentialId: ctx.datos.credencialId,
      authMode: 'hmac',
      payloadTemplate: { messages: [{ role: 'user', content: `${MARCA_HMAC}: Responde solo: OK` }] },
    },
  });
  if (th.status === 201 && th.body?.trigger?.id && th.body?.hmacSecret) {
    ctx.datos.triggerHmacId = th.body.trigger.id;
    registrarSecreto(th.body.hmacSecret);
    reporte.pass(F, 'crear trigger hmac (secreto una vez)', `id=${th.body.trigger.id}, webhookUrl=${th.body.webhookUrl}`);
  } else {
    reporte.fail(F, 'crear trigger hmac (secreto una vez)', `status ${th.status}: ${JSON.stringify(th.body).slice(0, 200)}`);
  }

  if (ctx.datos.triggerHmacId) {
    const secreto = th.body.hmacSecret;
    // Se dispara SIEMPRE contra API_BASE_URL (la webhookUrl devuelta puede derivar del Host del
    // request si PUBLIC_BASE_URL no esta seteada en prod; se reporta si difiere).
    const urlWebhook = `${env.API_BASE_URL}/webhooks/triggers/${ctx.datos.triggerHmacId}`;
    if (th.body.webhookUrl !== urlWebhook) {
      reporte.info(F, 'webhookUrl devuelta vs API_BASE_URL', `devuelta=${th.body.webhookUrl} (PUBLIC_BASE_URL sin setear?)`);
    }

    const ts = Math.floor(Date.now() / 1000);
    const valido = await pedirJson(urlWebhook, {
      method: 'POST',
      headers: { 'x-ledesma-timestamp': String(ts), 'x-ledesma-signature': firmar(secreto, ts, cuerpoEvento) },
      body: cuerpoEvento,
    });
    if (valido.status === 202) {
      reporte.pass(F, 'webhook hmac firma valida -> 202', JSON.stringify(valido.body));
    } else {
      reporte.fail(F, 'webhook hmac firma valida -> 202', `status ${valido.status}: ${JSON.stringify(valido.body)}`);
    }

    if (valido.status === 202 && ctx.datos.dbOk) {
      const jobTrigger = await encontrarJobNuevo(db, ctx.datos.usuario.id, ctx.datos.jobsVistos, MARCA_HMAC, { plazoMs: 60_000 });
      if (jobTrigger === null) {
        reporte.fail(F, 'job del trigger hmac completado', 'el 202 no encolo ningun job visible del owner');
      } else {
        ctx.datos.jobsVistos.add(jobTrigger.id);
        const { desenlace, job } = await esperarJobTerminal(db, ctx.datos.usuario.id, jobTrigger.id, { plazoMs: 120_000 });
        if (desenlace === 'completed') {
          reporte.pass(F, 'job del trigger hmac completado', resumenJob(job));
        } else {
          reporte.fail(F, 'job del trigger hmac completado', `desenlace=${desenlace}, ${resumenJob(job)}`);
        }
      }
    }

    const tsMalo = Math.floor(Date.now() / 1000);
    const invalido = await pedirJson(urlWebhook, {
      method: 'POST',
      headers: { 'x-ledesma-timestamp': String(tsMalo), 'x-ledesma-signature': `v1=${'0'.repeat(64)}` },
      body: cuerpoEvento,
    });
    if (invalido.status === 401) {
      reporte.pass(F, 'webhook hmac firma invalida -> 401', `status 401`);
    } else {
      reporte.fail(F, 'webhook hmac firma invalida -> 401', `status ${invalido.status}: ${JSON.stringify(invalido.body)}`);
    }

    const tsViejo = Math.floor(Date.now() / 1000) - 400; // fuera de la ventana anti-replay de 300s
    const replay = await pedirJson(urlWebhook, {
      method: 'POST',
      headers: { 'x-ledesma-timestamp': String(tsViejo), 'x-ledesma-signature': firmar(secreto, tsViejo, cuerpoEvento) },
      body: cuerpoEvento,
    });
    if (replay.status === 401) {
      reporte.pass(F, 'webhook hmac replay (>300s) -> 401', `timestamp ${tsViejo} (400s atras), status 401`);
    } else {
      reporte.fail(F, 'webhook hmac replay (>300s) -> 401', `status ${replay.status}: ${JSON.stringify(replay.body)}`);
    }
  }

  // ---- Trigger url_token --------------------------------------------------------------------
  const tt = await api('/v1/triggers', {
    method: 'POST',
    body: {
      agentId: ctx.datos.agenteId,
      credentialId: ctx.datos.credencialId,
      authMode: 'url_token',
      payloadTemplate: { messages: [{ role: 'user', content: `${MARCA_TOKEN}: Responde solo: OK` }] },
    },
  });
  if (tt.status === 201 && tt.body?.trigger?.id && tt.body?.urlToken) {
    ctx.datos.triggerTokenId = tt.body.trigger.id;
    registrarSecreto(tt.body.urlToken);
    reporte.pass(F, 'crear trigger url_token (token una vez)', `id=${tt.body.trigger.id}`);
  } else {
    reporte.fail(F, 'crear trigger url_token (token una vez)', `status ${tt.status}: ${JSON.stringify(tt.body).slice(0, 200)}`);
    return;
  }

  const urlToken = `${env.API_BASE_URL}/webhooks/triggers/${ctx.datos.triggerTokenId}`;
  const tokenOk = await pedirJson(`${urlToken}?token=${encodeURIComponent(tt.body.urlToken)}`, {
    method: 'POST',
    body: cuerpoEvento,
  });
  if (tokenOk.status === 202) {
    reporte.pass(F, 'webhook url_token correcto -> 202', JSON.stringify(tokenOk.body));
  } else {
    reporte.fail(F, 'webhook url_token correcto -> 202', `status ${tokenOk.status}: ${JSON.stringify(tokenOk.body)}`);
  }

  if (tokenOk.status === 202 && ctx.datos.dbOk) {
    const jobToken = await encontrarJobNuevo(db, ctx.datos.usuario.id, ctx.datos.jobsVistos, MARCA_TOKEN, { plazoMs: 60_000 });
    if (jobToken === null) {
      reporte.fail(F, 'job del trigger url_token completado', 'el 202 no encolo ningun job visible del owner');
    } else {
      ctx.datos.jobsVistos.add(jobToken.id);
      const { desenlace, job } = await esperarJobTerminal(db, ctx.datos.usuario.id, jobToken.id, { plazoMs: 120_000 });
      if (desenlace === 'completed') {
        reporte.pass(F, 'job del trigger url_token completado', resumenJob(job));
      } else {
        reporte.fail(F, 'job del trigger url_token completado', `desenlace=${desenlace}, ${resumenJob(job)}`);
      }
    }
  }

  const tokenMalo = await pedirJson(`${urlToken}?token=token-incorrecto-e2e`, {
    method: 'POST',
    body: cuerpoEvento,
  });
  if (tokenMalo.status === 401) {
    reporte.pass(F, 'webhook url_token incorrecto -> 401', 'status 401');
  } else {
    reporte.fail(F, 'webhook url_token incorrecto -> 401', `status ${tokenMalo.status}: ${JSON.stringify(tokenMalo.body)}`);
  }
}
