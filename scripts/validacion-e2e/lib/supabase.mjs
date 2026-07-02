import { randomBytes } from 'node:crypto';
import { pedirJson } from './http.mjs';
import { registrarSecreto } from './env.mjs';

/**
 * Identidad de prueba via la API ADMIN de Supabase Auth (GoTrue) con la SERVICE_ROLE_KEY.
 * Sin dependencia de @supabase/supabase-js: son 4 endpoints REST estables.
 *
 * Estrategia para obtener un JWT SIN magic link manual (el login de la consola es solo OTP):
 *   1. admin createUser con password + email_confirm:true, y sign-in por password grant.
 *   2. FALLBACK si el proveedor password esta deshabilitado en el proyecto: admin generate_link
 *      (magiclink) y canje del hashed_token via /auth/v1/verify (POST, sin tocar email).
 * El metodo que funciono se reporta en la evidencia de la Fase 2.
 */

function cabecerasAdmin(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
}

export function emailDePrueba() {
  const marca = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `validacion-e2e+${marca}@ledesma-ai-labs.com`;
}

/** Coincide SOLO con los emails que genera este script: acota el barrido de restos. */
export function esEmailDePrueba(email) {
  return /^validacion-e2e\+\d{8,14}@ledesma-ai-labs\.com$/.test(email ?? '');
}

export async function crearUsuarioPrueba(env, email) {
  const password = randomBytes(24).toString('base64url');
  registrarSecreto(password);
  const res = await pedirJson(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabecerasAdmin(env),
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { proposito: 'E2E-VALIDACION', creado_por: 'scripts/validacion-e2e' },
    },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`admin createUser fallo (status ${res.status}): ${JSON.stringify(res.body)}`);
  }
  const id = res.body?.id ?? res.body?.user?.id;
  if (!id) throw new Error(`admin createUser sin id en la respuesta: ${JSON.stringify(res.body)}`);
  return { id, email, password };
}

/** Intenta password grant; si el proveedor esta deshabilitado, cae a generate_link + verify. */
export async function obtenerJwt(env, usuario) {
  const porPassword = await pedirJson(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    body: { email: usuario.email, password: usuario.password },
  });
  if (porPassword.status === 200 && typeof porPassword.body?.access_token === 'string') {
    registrarSecreto(porPassword.body.access_token);
    if (typeof porPassword.body.refresh_token === 'string') registrarSecreto(porPassword.body.refresh_token);
    return { jwt: porPassword.body.access_token, metodo: 'password_grant' };
  }

  // Fallback: link administrativo + canje del token_hash (no manda email real en verify).
  const link = await pedirJson(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: cabecerasAdmin(env),
    body: { type: 'magiclink', email: usuario.email },
  });
  const tokenHash =
    link.body?.hashed_token ?? link.body?.properties?.hashed_token ?? null;
  if ((link.status !== 200 && link.status !== 201) || !tokenHash) {
    throw new Error(
      `no se pudo obtener JWT: password grant status ${porPassword.status} (${JSON.stringify(porPassword.body?.error_code ?? porPassword.body)}), generate_link status ${link.status}`,
    );
  }
  registrarSecreto(tokenHash);
  const verificado = await pedirJson(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    body: { type: 'magiclink', token_hash: tokenHash },
  });
  if (verificado.status !== 200 || typeof verificado.body?.access_token !== 'string') {
    throw new Error(`verify del magiclink fallo (status ${verificado.status}): ${JSON.stringify(verificado.body?.error_code ?? '')}`);
  }
  registrarSecreto(verificado.body.access_token);
  if (typeof verificado.body.refresh_token === 'string') registrarSecreto(verificado.body.refresh_token);
  return { jwt: verificado.body.access_token, metodo: 'generate_link+verify' };
}

export async function borrarUsuario(env, userId) {
  const res = await pedirJson(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: cabecerasAdmin(env),
  });
  return res.status === 200 || res.status === 204;
}

/** Lista usuarios de prueba que quedaron de corridas anteriores (SOLO emails del patron propio). */
export async function listarUsuariosPruebaRestantes(env) {
  const restos = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const res = await pedirJson(`${env.SUPABASE_URL}/auth/v1/admin/users?page=${pagina}&per_page=100`, {
      headers: cabecerasAdmin(env),
    });
    if (res.status !== 200) break;
    const usuarios = res.body?.users ?? [];
    for (const u of usuarios) {
      if (esEmailDePrueba(u.email)) restos.push({ id: u.id, email: u.email });
    }
    if (usuarios.length < 100) break;
  }
  return restos;
}
