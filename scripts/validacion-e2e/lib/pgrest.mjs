import { pedirJson } from './http.mjs';

/**
 * Cliente PostgREST (la API REST que Supabase expone sobre HTTPS) con la SERVICE_ROLE_KEY, que
 * bypassa RLS. Se usa en lugar de una conexion postgres directa porque el entorno de ejecucion solo
 * permite salida HTTPS (443): los puertos del pooler (5432/6543) estan bloqueados. Cubre lo que la
 * validacion necesita de la base: leer/contar/borrar filas del owner de prueba y auditar la
 * existencia de tablas. Lo que PostgREST NO expone (catalogo pg_proc, schema cron) se audita de
 * forma FUNCIONAL en las fases (p.ej. que el scheduler encole un job prueba toda su cadena SQL).
 */
export function crearPgrest(supabaseUrl, serviceRoleKey) {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };

  /** GET de filas. `query` es la query string PostgREST ya armada (p.ej. 'owner_id=eq.x&select=id'). */
  async function get(tabla, query = '') {
    const res = await pedirJson(`${base}/${tabla}${query ? `?${query}` : ''}`, { headers });
    if (res.status >= 400) {
      throw new Error(`PostgREST GET ${tabla} -> ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    return Array.isArray(res.body) ? res.body : [];
  }

  /** Existencia + accesibilidad de una tabla del schema public (probe barato: limit=0). */
  async function existeTabla(tabla) {
    const res = await pedirJson(`${base}/${tabla}?limit=0`, { headers });
    return res.status === 200 || res.status === 206;
  }

  /** Conteo exacto de filas que cumplen la query, leido del header content-range (sin traer filas). */
  async function contarHeader(tabla, query = '') {
    const q = query ? `${query}&limit=0` : 'limit=0';
    const res = await fetch(`${base}/${tabla}?${q}`, { headers: { ...headers, Prefer: 'count=exact' } });
    const rango = res.headers.get('content-range') ?? '';
    const total = rango.split('/')[1];
    return Number(total ?? 0) || 0;
  }

  /** DELETE acotado por query (SIEMPRE con filtro; PostgREST rechaza un delete sin filtro). Devuelve
   * el numero de filas borradas (Prefer return=representation). */
  async function del(tabla, query) {
    if (!query || query.trim() === '') {
      throw new Error(`del(${tabla}) sin filtro: rechazado por seguridad`);
    }
    const res = await pedirJson(`${base}/${tabla}?${query}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=representation' },
    });
    if (res.status >= 400) {
      throw new Error(`PostgREST DELETE ${tabla} -> ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    return Array.isArray(res.body) ? res.body.length : 0;
  }

  return { base, get, existeTabla, contar: contarHeader, del };
}
