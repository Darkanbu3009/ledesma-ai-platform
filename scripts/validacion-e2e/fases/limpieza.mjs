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

// Tablas acotadas por owner_id (hijos antes que agents por las FK on delete) y las scoped por
// profile_id / id del usuario de prueba. Se listan aparte para reusarlas en barrido y verificacion.
const TABLAS_OWNER = [
  'jobs',
  'scheduled_tasks',
  'triggers',
  'recipes',
  'agent_runs',
  'processing_records',
  'consents',
  'data_subject_requests',
  'agents',
  'provider_credentials',
];
const TABLAS_PROFILE = [
  ['usage_counters', 'profile_id'],
  ['subscriptions', 'profile_id'],
  ['profiles', 'id'],
];

/** Barrido directo en DB de TODO lo asociado a UN owner de prueba, via PostgREST. Orden respeta FKs. */
export async function limpiarRestosDeOwner(db, ownerId) {
  const conteos = {};
  for (const tabla of TABLAS_OWNER) {
    conteos[tabla] = await db.del(tabla, `owner_id=eq.${ownerId}`);
  }
  for (const [tabla, col] of TABLAS_PROFILE) {
    conteos[tabla] = await db.del(tabla, `${col}=eq.${ownerId}`);
  }
  return conteos;
}

/** Conteo de filas remanentes del owner por tabla (verificacion post-limpieza), via PostgREST. */
export async function contarRestosDeOwner(db, ownerId) {
  const conteos = {};
  for (const tabla of TABLAS_OWNER) {
    conteos[tabla] = await db.contar(tabla, `owner_id=eq.${ownerId}`);
  }
  for (const [tabla, col] of TABLAS_PROFILE) {
    conteos[tabla] = await db.contar(tabla, `${col}=eq.${ownerId}`);
  }
  return conteos;
}

export async function limpiezaFinal(ctx) {
  const { env, db, reporte, api } = ctx;
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
      const conteos = await limpiarRestosDeOwner(db, d.usuario.id);
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
    reporte.skip(F, 'barrido DB acotado al owner de prueba', 'sin acceso a la base');
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
      const restos = await contarRestosDeOwner(db, d.usuario.id);
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
