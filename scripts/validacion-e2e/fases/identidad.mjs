import { crearUsuarioPrueba, obtenerJwt, emailDePrueba } from '../lib/supabase.mjs';

/**
 * FASE 2 - IDENTIDAD DE PRUEBA: usuario nuevo via Supabase admin, JWT sin magic link manual,
 * registro del perfil (la consola llama POST /v1/register/individual tras el login) y subida de
 * tier a 'autonomous' via el endpoint super-admin.
 */
export async function faseIdentidad(ctx) {
  const { env, reporte, api, apiAdmin } = ctx;
  const F = 'FASE 2 IDENTIDAD';

  let usuario;
  try {
    usuario = await crearUsuarioPrueba(env, emailDePrueba());
    ctx.datos.usuario = usuario;
    reporte.pass(F, 'crear usuario de prueba (Supabase admin)', `email=${usuario.email}, id=${usuario.id}`);
  } catch (error) {
    reporte.fail(F, 'crear usuario de prueba (Supabase admin)', error.message);
    return;
  }

  try {
    const { jwt, metodo } = await obtenerJwt(env, usuario);
    ctx.datos.jwt = jwt;
    reporte.pass(F, 'obtener JWT del usuario de prueba', `metodo=${metodo}`);
  } catch (error) {
    reporte.fail(F, 'obtener JWT del usuario de prueba', error.message);
    return;
  }

  // Mismo flujo que la consola tras el primer login: GET /v1/me detecta needsRegistration y el
  // cliente registra el perfil individual.
  const antes = await api('/v1/me');
  reporte.info(F, 'GET /v1/me antes del registro', `status ${antes.status}, needsRegistration=${antes.body?.needsRegistration}`);

  const registro = await api('/v1/register/individual', {
    method: 'POST',
    body: { full_name: 'E2E-VALIDACION usuario de prueba' },
  });
  if ((registro.status === 201 || registro.status === 200) && registro.body?.profile?.id === usuario.id) {
    reporte.pass(F, 'POST /v1/register/individual', `status ${registro.status}, tier inicial=${registro.body.profile.tier}`);
  } else {
    reporte.fail(F, 'POST /v1/register/individual', `status ${registro.status}: ${JSON.stringify(registro.body)}`);
    return;
  }

  const subida = await apiAdmin(`/v1/admin/profiles/${usuario.id}/tier`, {
    method: 'POST',
    body: { tier: 'autonomous' },
  });
  if (subida.status === 200 && subida.body?.profile?.tier === 'autonomous') {
    reporte.pass(F, "subir tier a 'autonomous' (admin)", `profile.tier=${subida.body.profile.tier}`);
  } else {
    reporte.fail(F, "subir tier a 'autonomous' (admin)", `status ${subida.status}: ${JSON.stringify(subida.body)}`);
    return;
  }

  const me = await api('/v1/me');
  if (me.status === 200 && me.body?.profile?.tier === 'autonomous') {
    reporte.pass(F, 'GET /v1/me -> tier autonomous', `plan=${me.body?.subscription?.plan}, runsLimit=${me.body?.usageCounter?.runsLimit}`);
    ctx.datos.identidadLista = true;
  } else {
    reporte.fail(F, 'GET /v1/me -> tier autonomous', `status ${me.status}, tier=${me.body?.profile?.tier}`);
  }
}
