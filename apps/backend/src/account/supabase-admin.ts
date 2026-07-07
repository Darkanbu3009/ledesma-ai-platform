import { createClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

/**
 * BORRADO DE auth.users via el ADMIN API de Supabase. auth.users vive en el sistema de AUTENTICACION de
 * Supabase (no en el esquema de negocio); no hay FK ni trigger que lo enlace a profiles (el vinculo es
 * SOLO convencion: profiles.id = auth.users.id = sub del JWT). Por eso el motor lo borra en un PASO
 * SEPARADO, con el ADMIN API, DESPUES de borrar los datos de negocio.
 *
 * La SERVICE_ROLE_KEY que este cliente usa es una llave MUY poderosa (bypasa RLS, acceso total). Se trata
 * como secreto de boveda: solo vive en env, NUNCA se loguea ni se expone. Este modulo jamas la imprime; el
 * unico lugar donde se usa es createClient. Los mensajes de error que propaga son los de Supabase (no
 * incluyen la key).
 */
export interface AuthUserDeleter {
  /**
   * Borra la fila de auth.users del usuario dado (por su id = sub del JWT). Resuelve si el borrado tuvo
   * exito; RECHAZA con un Error (sin secretos) si el API devuelve error, para que el orquestador lo
   * capture y lo reporte como reintento manual (los datos de negocio ya se borraron, no se revierten).
   */
  deleteUser(userId: string): Promise<void>;
}

/**
 * Construye el borrador de auth.users con el rol de servicio, o devuelve `null` si SUPABASE_SERVICE_ROLE_KEY
 * no esta configurada (feature desactivada, mismo patron opcional que WEB_WORKER_*). El orquestador trata
 * `null` como 'not_configured': los datos ya se borraron, pero auth.users no se puede tocar sin la llave.
 *
 * autoRefreshToken/persistSession en false: es un cliente server-side sin sesion de usuario (no hay nada
 * que refrescar ni persistir); solo se usa para el admin API.
 */
export function createSupabaseAuthUserDeleter(config: Env): AuthUserDeleter | null {
  const serviceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return null;
  }
  const client = createClient(config.SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async deleteUser(userId: string): Promise<void> {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) {
        // Solo el mensaje de Supabase (jamas la SERVICE_ROLE_KEY): identifica el fallo para el log de
        // reintento manual sin filtrar el secreto.
        throw new Error(`fallo al borrar auth.users: ${error.message}`);
      }
    },
  };
}
