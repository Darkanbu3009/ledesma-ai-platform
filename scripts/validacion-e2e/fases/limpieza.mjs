import { borrarUsuario } from '../lib/supabase.mjs';

/**
 * LIMPIEZA FINAL: corre SIEMPRE (incluso si fallaron fases). Borra todo lo creado, primero por la
 * API (ejercita los DELETE reales) y despues un barrido directo en DB como red de seguridad.
 *
 * REGLA DURA: toda query toca EXCLUSIVAMENTE filas del owner de prueba (owner_id/profile_id/id =
 * usuario de prueba). JAMAS se toca data de otros owners. Nota: borrar el agente cascadea sus
 * jobs/tareas/triggers/recetas/agent_runs (FK on delete cascade), asi que el "historial" de jobs
 * completed del usuario de prueba tambien desaparece; se reporta.
 */

/** Barrido directo en DB de TODO lo asociado a UN owner de prueba. Orden respetando FKs. */
export async function limpiarRestosDeOwner(sql, ownerId) {
  const conteos = {};
  // Tablas con owner_id (el orden evita choques de FK: hijos antes que agents).
  conteos.jobs = (await sql`delete from jobs where owner_id = ${ownerId} returning id`).length;
  conteos.scheduled_tasks = (await sql`delete from scheduled_tasks where owner_id = ${ownerId} returning id`).length;
  conteos.triggers = (await sql`delete from triggers where owner_id = ${ownerId} returning id`).length;
  conteos.recipes = (await sql`delete from recipes where owner_id = ${ownerId} returning id`).length;
  conteos.agent_runs = (await sql`delete from agent_runs where owner_id = ${ownerId} returning id`).length;
  conteos.processing_records = (await sql`delete from processing_records where owner_id = ${ownerId} returning id`).length;
  conteos.consents = (await sql`delete from consents where owner_id = ${ownerId} returning id`).length;
  conteos.data_subject_requests = (await sql`delete from data_subject_requests where owner_id = ${ownerId} returning id`).length;
  conteos.agents = (await sql`delete from agents where owner_id = ${ownerId} returning id`).length;
  conteos.provider_credentials = (await sql`delete from provider_credentials where owner_id = ${ownerId} returning id`).length;
  // Perfil y satelites (profile_id / id = sub del usuario de prueba).
  conteos.usage_counters = (await sql`delete from usage_counters where profile_id = ${ownerId} returning id`).length;
  conteos.subscriptions = (await sql`delete from subscriptions where profile_id = ${ownerId} returning id`).length;
  conteos.profiles = (await sql`delete from profiles where id = ${ownerId} returning id`).length;
  return conteos;
}

/** Conteo de filas remanentes del owner por tabla (verificacion post-limpieza). */
export async function contarRestosDeOwner(sql, ownerId) {
  const filas = await sql`
    select 'agents' as tabla, count(*)::int as n from agents where owner_id = ${ownerId}
    union all select 'provider_credentials', count(*)::int from provider_credentials where owner_id = ${ownerId}
    union all select 'jobs', count(*)::int from jobs where owner_id = ${ownerId}
    union all select 'scheduled_tasks', count(*)::int from scheduled_tasks where owner_id = ${ownerId}
    union all select 'triggers', count(*)::int from triggers where owner_id = ${ownerId}
    union all select 'recipes', count(*)::int from recipes where owner_id = ${ownerId}
    union all select 'agent_runs', count(*)::int from agent_runs where owner_id = ${ownerId}
    union all select 'consents', count(*)::int from consents where owner_id = ${ownerId}
    union all select 'data_subject_requests', count(*)::int from data_subject_requests where owner_id = ${ownerId}
    union all select 'processing_records', count(*)::int from processing_records where owner_id = ${ownerId}
    union all select 'profiles', count(*)::int from profiles where id = ${ownerId}
    union all select 'subscriptions', count(*)::int from subscriptions where profile_id = ${ownerId}
    union all select 'usage_counters', count(*)::int from usage_counters where profile_id = ${ownerId}
  `;
  return Object.fromEntries(filas.map((f) => [f.tabla, f.n]));
}

export async function limpiezaFinal(ctx) {
  const { env, sql, reporte, api } = ctx;
  const F = 'LIMPIEZA';
  const d = ctx.datos;
  if (!d.usuario) {
    reporte.info(F, 'nada que limpiar', 'no se llego a crear el usuario de prueba');
    return;
  }

  // 1) Por la API (mejor senal: ejercita los DELETE reales). Errores no cortan la limpieza.
  const borradosApi = [];
  const intentarDelete = async (nombre, ruta, opciones) => {
    try {
      const res = await api(ruta, { method: opciones?.method ?? 'DELETE', ...(opciones?.body ? { body: opciones.body } : {}) });
      borradosApi.push(`${nombre}:${res.status}`);
    } catch (error) {
      borradosApi.push(`${nombre}:ERROR(${error.message.slice(0, 60)})`);
    }
  };

  if (d.tareaId) await intentarDelete('tarea.desactivar', `/v1/scheduled-tasks/${d.tareaId}`, { method: 'PATCH', body: { isActive: false } });
  if (d.tareaId) await intentarDelete('tarea', `/v1/scheduled-tasks/${d.tareaId}`);
  if (d.tareaGateId) await intentarDelete('tarea-gate', `/v1/scheduled-tasks/${d.tareaGateId}`);
  if (d.triggerHmacId) await intentarDelete('trigger-hmac', `/v1/triggers/${d.triggerHmacId}`);
  if (d.triggerTokenId) await intentarDelete('trigger-token', `/v1/triggers/${d.triggerTokenId}`);
  if (d.recetaId) await intentarDelete('receta', `/v1/recipes/${d.recetaId}`);
  if (d.agenteId) await intentarDelete('agente', `/v1/agents/${d.agenteId}`);
  if (d.agenteMismatchId) await intentarDelete('agente-mismatch', `/v1/agents/${d.agenteMismatchId}`);
  if (d.credencialId) await intentarDelete('credencial', `/v1/credentials/${d.credencialId}`);
  if (borradosApi.length > 0) reporte.info(F, 'DELETE por API', borradosApi.join(', '));

  // 2) Red de seguridad directa en DB, SIEMPRE acotada al owner de prueba. consents /
  //    data_subject_requests / profiles / subscriptions / usage_counters NO tienen DELETE en la
  //    API: solo se pueden borrar aqui. Por eso el usuario de Auth solo se elimina en el paso 3 SI
  //    este barrido corrio sin error; de lo contrario se DEJA en Auth para que el pre-barrido de un
  //    run futuro (con DB alcanzable) lo descubra por email y limpie sus filas huerfanas.
  let barridoOk = false;
  if (ctx.datos.dbOk) {
    try {
      const conteos = await limpiarRestosDeOwner(sql, d.usuario.id);
      barridoOk = true;
      const tocadas = Object.entries(conteos).filter(([, n]) => n > 0);
      reporte.info(
        F,
        'barrido DB acotado al owner de prueba',
        tocadas.length === 0 ? 'sin filas remanentes (la API ya habia borrado todo)' : tocadas.map(([t, n]) => `${t}=${n}`).join(', '),
      );
      reporte.info(
        F,
        'historial de jobs del usuario de prueba',
        'los jobs completed del owner de prueba se borran (cascada del agente / barrido); no queda historial E2E',
      );
    } catch (error) {
      reporte.fail(F, 'barrido DB acotado al owner de prueba', error.message);
    }
  } else {
    reporte.skip(F, 'barrido DB acotado al owner de prueba', 'sin conexion a la base');
  }

  // 3) Usuario de prueba en Supabase Auth. SOLO si el barrido DB corrio sin error: borrarlo antes
  //    dejaria filas huerfanas (tablas sin DELETE por API) que ningun run futuro podria descubrir
  //    (el descubrimiento de restos es por email en Auth). Si no se borra, queda etiquetado para el
  //    pre-barrido del proximo run.
  if (barridoOk) {
    try {
      const ok = await borrarUsuario(env, d.usuario.id);
      if (ok) reporte.pass(F, 'borrar usuario de prueba (Supabase admin)', `id=${d.usuario.id}`);
      else reporte.fail(F, 'borrar usuario de prueba (Supabase admin)', 'status inesperado');
    } catch (error) {
      reporte.fail(F, 'borrar usuario de prueba (Supabase admin)', error.message);
    }
  } else {
    reporte.info(
      F,
      'usuario de prueba conservado en Auth (barrido DB no completo)',
      `id=${d.usuario.id}; se deja para que el pre-barrido de un run futuro con DB lo limpie por completo`,
    );
  }

  // 4) Verificacion final: cero filas del owner de prueba en todas las tablas.
  if (ctx.datos.dbOk) {
    try {
      const restos = await contarRestosDeOwner(sql, d.usuario.id);
      const sucias = Object.entries(restos).filter(([, n]) => n > 0);
      if (sucias.length === 0) {
        reporte.pass(F, 'verificacion: cero filas E2E-VALIDACION activas', 'todas las tablas en 0 para el owner de prueba');
      } else {
        reporte.fail(F, 'verificacion: cero filas E2E-VALIDACION activas', sucias.map(([t, n]) => `${t}=${n}`).join(', '));
      }
    } catch (error) {
      reporte.fail(F, 'verificacion: cero filas E2E-VALIDACION activas', error.message);
    }
  }
}
