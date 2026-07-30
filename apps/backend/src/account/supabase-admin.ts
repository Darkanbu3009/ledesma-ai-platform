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

  const getClient = lazyAdminClient(config, serviceRoleKey, 'borrar el usuario de auth.users');

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

/** Bucket PRIVADO donde el worker sube el screenshot de cada checkpoint de aprobacion (V027). */
const BUCKET_APROBACIONES = 'aprobaciones-web';

/**
 * BORRADO de los SCREENSHOTS de aprobacion en Supabase Storage. Son datos personales del titular (la
 * imagen de lo que el agente tenia en pantalla cuando pidio su autorizacion) que NO viven en el esquema
 * de negocio: el objeto esta en Storage y la fila de `aprobaciones_web` solo guarda su path. Borrar la
 * fila dentro de la transaccion NO se lleva el objeto, asi que sin este paso el erasure dejaria la imagen
 * en pie con la fila que la referenciaba ya borrada.
 */
export interface ScreenshotStorageDeleter {
  /**
   * Borra los objetos dados del bucket de aprobaciones. Resuelve si el borrado tuvo exito; RECHAZA con un
   * Error (sin secretos) si el API falla, para que el orquestador lo reporte como purga pendiente.
   */
  deleteObjects(paths: string[]): Promise<void>;
}

/**
 * Construye el borrador de screenshots con el rol de servicio, o `null` si SUPABASE_SERVICE_ROLE_KEY no
 * esta configurada (mismo patron opcional y misma inicializacion perezosa que createSupabaseAuthUserDeleter:
 * un problema de config del cliente admin NO puede afectar el arranque del servidor).
 */
export function createSupabaseScreenshotDeleter(config: Env): ScreenshotStorageDeleter | null {
  const serviceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return null;
  }

  const getClient = lazyAdminClient(
    config,
    serviceRoleKey,
    'borrar los screenshots de aprobacion del titular',
  );

  return {
    async deleteObjects(paths: string[]): Promise<void> {
      if (paths.length === 0) {
        return;
      }
      const { error } = await getClient().storage.from(BUCKET_APROBACIONES).remove(paths);
      if (error) {
        // Solo el mensaje de Supabase (jamas la SERVICE_ROLE_KEY): identifica el fallo para el log de
        // purga manual sin filtrar el secreto.
        throw new Error(`fallo al borrar los screenshots de aprobacion: ${error.message}`);
      }
    },
  };
}

/**
 * Cliente admin MEMOIZADO y PEREZOSO, compartido por los dos borradores de este modulo. Se crea la
 * PRIMERA vez que se usa, no al registrar la ruta: `createClient` lanza de forma SINCRONA con una url
 * vacia, y en el boot eso tumbaria el arranque del servidor (ver la nota de createSupabaseAuthUserDeleter).
 * `proposito` solo aparece en el mensaje de error de config; la SERVICE_ROLE_KEY jamas se imprime.
 */
function lazyAdminClient(
  config: Env,
  serviceRoleKey: string,
  proposito: string,
): () => ReturnType<typeof createClient> {
  let client: ReturnType<typeof createClient> | undefined;
  return () => {
    if (client) {
      return client;
    }
    // Guarda de robustez en TIEMPO DE USO (no de arranque): mensaje CLARO si la URL falta justo al intentar
    // borrar. La SERVICE_ROLE_KEY jamas aparece en el mensaje (secreto de boveda).
    if (!config.SUPABASE_URL) {
      throw new Error(`falta SUPABASE_URL para ${proposito}`);
    }
    client = createClient(config.SUPABASE_URL, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return client;
  };
}
