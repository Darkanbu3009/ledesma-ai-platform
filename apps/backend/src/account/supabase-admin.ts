import { createClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

/**
 * BORRADO DE auth.users via el ADMIN API de Supabase. auth.users vive en el sistema de AUTENTICACION de
 * Supabase (no en el esquema de negocio); no hay FK ni trigger que lo enlace a profiles (el vinculo es
 * SOLO convencion: profiles.id = auth.users.id = sub del JWT). Por eso el motor lo borra en un PASO
 * SEPARADO, con el ADMIN API, DESPUES de borrar los datos de negocio.
 *
 * La SUPABASE_SERVICE_ROLE_KEY que este cliente usa es una llave MUY poderosa (bypasa RLS, acceso total).
 * Se trata como secreto de boveda: solo vive en env, NUNCA se loguea ni se expone. Este modulo jamas la
 * imprime; el unico lugar donde se usa es createClient. Los mensajes de error que propaga son estaticos o
 * los de Supabase (nunca incluyen la key).
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
 * INICIALIZACION PEREZOSA (lazy): el cliente de Supabase se crea la PRIMERA vez que se borra un usuario
 * (dentro de deleteUser), NO al cargar el modulo ni al registrar la ruta / arrancar el servidor. Esto es
 * DELIBERADO y CRITICO para el arranque: `createClient` lanza de forma SINCRONA si la url o la key son
 * vacias/undefined ("supabaseUrl is required." / "supabaseKey is required."). Si se ejecutara en el boot
 * (eager) con una config ausente o mal formada, tumbaria el REGISTRO del plugin y con el TODO el arranque
 * del servidor (el health check nunca pasa). Perezoso = un problema de config del cliente admin NO afecta
 * el arranque: se resuelve en TIEMPO DE USO (un camino que hoy nadie ejercita aun), y el servidor SIEMPRE
 * arranca.
 *
 * autoRefreshToken/persistSession en false: es un cliente server-side sin sesion de usuario (no hay nada
 * que refrescar ni persistir); solo se usa para el admin API.
 */
export function createSupabaseAuthUserDeleter(config: Env): AuthUserDeleter | null {
  // Decision de FEATURE, barata y SIN crear el cliente: si la key no esta configurada, la feature de
  // borrado de auth.users esta desactivada -> null (el orquestador lo trata como 'not_configured' y lo
  // loguea claramente al usarse). Esto es lo UNICO que corre al registrar la ruta (boot); no hay
  // createClient aqui, asi que el arranque no puede crashear por este camino. El `const` narrowed captura
  // la key ya validada como string para el closure de abajo (sin re-chequear ni assertions).
  const serviceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return null;
  }

  // Cliente MEMOIZADO: se crea una sola vez (la primera llamada a deleteUser) y se REUSA en las siguientes,
  // sin recrearlo en cada borrado.
  let client: ReturnType<typeof createClient> | undefined;
  const getClient = (): ReturnType<typeof createClient> => {
    if (client) {
      return client;
    }
    // Guarda de robustez en TIEMPO DE USO (no de arranque): mensaje CLARO si la URL falta justo al intentar
    // borrar. La SERVICE_ROLE_KEY jamas aparece en el mensaje (secreto de boveda).
    if (!config.SUPABASE_URL) {
      throw new Error('falta SUPABASE_URL para borrar el usuario de auth.users');
    }
    client = createClient(config.SUPABASE_URL, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return client;
  };

  return {
    async deleteUser(userId: string): Promise<void> {
      const { error } = await getClient().auth.admin.deleteUser(userId);
      if (error) {
        // Solo el mensaje de Supabase (jamas la SERVICE_ROLE_KEY): identifica el fallo para el log de
        // reintento manual sin filtrar el secreto.
        throw new Error(`fallo al borrar auth.users: ${error.message}`);
      }
    },
  };
}
