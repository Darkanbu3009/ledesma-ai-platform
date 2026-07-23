import type { Sql } from '../db/client.js';

/**
 * Acceso a datos de la COORDINACION DEL RELAY (tablas `relay_jti_consumidos` y `relay_conexiones_activas`,
 * V031): el estado COMPARTIDO por todas las instancias del servicio relay que hace del uso unico del jti y
 * del lock por conexion INVARIANTES DE SEGURIDAD reales, no por-proceso (B-1). Recibe el cliente sql por
 * inyeccion (testeable), mismo patron que el resto de los repos.
 *
 * MINIMO CONOCIMIENTO: de un jti se guarda solo su SHA-256 (lo hashea el relay antes de enviarlo); del
 * lock, solo el connection_id, un nonce opaco de la sesion del relay y la expiracion. Cero contenido de
 * pulsaciones, cero credenciales. Todas las operaciones son ATOMICAS (una sentencia): dos instancias que
 * compiten por el mismo jti o la misma conexion no pueden ganar las dos.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (V031 sin
 * aplicar), Postgres falla ruidosamente en vez de devolver campos undefined.
 */
export class RelayCoordinacionRepository {
  constructor(
    private readonly sql: Sql,
    /** Reloj inyectable (epoch segundos); default = ahora. */
    private readonly ahoraSec: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /**
   * Consume el jti (uso UNICO atomico). INSERT con ON CONFLICT DO NOTHING: solo la PRIMERA instancia
   * inserta y recibe la fila (true = autorizado); una segunda choca contra la PK y no inserta (false =
   * reuso). El hash se retiene hasta `exp` (la purga lo limpia despues).
   */
  async consumirJti(jtiHash: string, exp: number): Promise<boolean> {
    const filas = await this.sql<{ jti_hash: string }[]>`
      insert into relay_jti_consumidos (jti_hash, exp)
      values (${jtiHash}, ${exp})
      on conflict (jti_hash) do nothing
      returning jti_hash
    `;
    return filas.length > 0;
  }

  /**
   * Toma el LOCK por conexion (exclusion mutua atomica). INSERT que, ante conflicto, SOLO pisa un lock
   * VENCIDO (exp <= ahora): un lock vigente de otra sesion NO se actualiza y no se devuelve nada (false =
   * conexion ocupada). Si no hay fila, o la habia pero vencida, se toma (true). Asi un crash del relay no
   * deja la conexion trabada mas alla de la vida del token.
   */
  async tomarConexion(connectionId: string, lockNonce: string, exp: number): Promise<boolean> {
    const ahora = this.ahoraSec();
    const filas = await this.sql<{ connection_id: string }[]>`
      insert into relay_conexiones_activas (connection_id, lock_nonce, exp)
      values (${connectionId}, ${lockNonce}, ${exp})
      on conflict (connection_id) do update
        set lock_nonce = excluded.lock_nonce, exp = excluded.exp, tomado_en = now()
        where relay_conexiones_activas.exp <= ${ahora}
      returning connection_id
    `;
    return filas.length > 0;
  }

  /**
   * Libera el lock por conexion. Solo borra si el `lockNonce` coincide con el que lo tomo: una sesion
   * vieja jamas libera un lock ya retomado por otra. Idempotente (si no hay fila, no borra nada).
   */
  async liberarConexion(connectionId: string, lockNonce: string): Promise<void> {
    await this.sql`
      delete from relay_conexiones_activas
      where connection_id = ${connectionId} and lock_nonce = ${lockNonce}
    `;
  }
}
