/**
 * AUTORIDAD COMPARTIDA de uso unico del token y lock por conexion (B-1). El uso unico del jti y el lock
 * "un solo canal por conexion" son INVARIANTES DE SEGURIDAD: si viven en la memoria de cada proceso, en
 * un rolling deploy de Railway (dos instancias solapadas) un token se consume una vez POR INSTANCIA y se
 * abre un segundo canal a la misma sesion de login. Para cerrar esa ventana estos dos estados se delegan
 * a una autoridad COMPARTIDA por todas las instancias.
 *
 * En produccion la implementacion es `AutoridadRemota` (media el backend, atomico en su base; el relay
 * sigue SIN DATABASE_URL). En dev/tests se usa `AutoridadEnMemoria` (una sola instancia, sin red).
 *
 * FAIL-CLOSED: si la autoridad no responde, el metodo LANZA y el llamador rechaza el handshake. Jamas se
 * degrada en silencio a estado por proceso: preferimos negar un canal antes que operar con estado
 * dividido. Lo que NO es invariante de seguridad (contadores de flood y concurrencia por owner) queda en
 * memoria por instancia a proposito (ver rate-limit.ts); con N instancias esos limites se multiplican.
 */
export interface AutoridadRelay {
  /**
   * Consume el jti (uso UNICO, atomico y compartido). Devuelve true si es la PRIMERA vez (canal
   * autorizado) y false si ya fue consumido (reuso -> el llamador rechaza). Lanza si la autoridad no
   * responde (fail-closed). El jti se retiene hasta `expEpochSec` (el token ya no verifica pasado eso).
   */
  consumirJti(jti: string, expEpochSec: number): Promise<boolean>;

  /**
   * Toma o RENUEVA el LOCK por conexion (exclusion mutua atomica y compartida): nunca dos canales vivos
   * sobre la misma `connectionId`. Devuelve true si lo tomo/renovo y false si ya estaba tomado por OTRA
   * sesion vigente (conexion ocupada -> rechazo). `lockNonce` identifica a ESTA sesion: solo ella libera su
   * lock, y volver a llamar con el MISMO nonce RENUEVA el lease (extiende `expEpochSec`). Lanza si la
   * autoridad no responde (fail-closed). Un lock vencido (mas alla de `expEpochSec`) se puede retomar; por
   * eso el relay pasa un lease CORTO y lo renueva mientras el canal vive (NEW-2), no el exp del token.
   */
  tomarConexion(connectionId: string, lockNonce: string, expEpochSec: number): Promise<boolean>;

  /**
   * Libera el lock por conexion (idempotente, best-effort). Solo libera si el `lockNonce` coincide con el
   * que lo tomo (no pisa un lock ya retomado por otra sesion). No lanza: un fallo aqui no rompe el cierre;
   * el lock caduca solo por `expEpochSec`.
   */
  liberarConexion(connectionId: string, lockNonce: string): Promise<void>;
}

/**
 * Implementacion EN MEMORIA (una sola instancia). Autoritativa solo si el proceso es unico; por eso en
 * produccion se exige `AutoridadRemota` (el arranque falla ruidoso sin ella). Util en dev/tests.
 */
export class AutoridadEnMemoria implements AutoridadRelay {
  private readonly jtiConsumidos = new Map<string, number>(); // jti -> exp epoch segundos
  private readonly conexiones = new Map<string, { nonce: string; exp: number }>(); // connectionId -> lock

  constructor(private readonly ahoraSec: () => number = () => Math.floor(Date.now() / 1000)) {}

  async consumirJti(jti: string, expEpochSec: number): Promise<boolean> {
    this.purgarVencidos();
    if (this.jtiConsumidos.has(jti)) return false;
    this.jtiConsumidos.set(jti, expEpochSec);
    return true;
  }

  async tomarConexion(connectionId: string, lockNonce: string, expEpochSec: number): Promise<boolean> {
    const ahora = this.ahoraSec();
    const actual = this.conexiones.get(connectionId);
    // Ocupada y vigente por OTRA sesion: rechazo. La MISMA sesion (mismo nonce) puede RENOVAR su lease, y
    // un lock vencido lo puede retomar cualquiera. Espeja el ON CONFLICT del repositorio del backend.
    if (actual !== undefined && actual.exp > ahora && actual.nonce !== lockNonce) return false;
    this.conexiones.set(connectionId, { nonce: lockNonce, exp: expEpochSec });
    return true;
  }

  async liberarConexion(connectionId: string, lockNonce: string): Promise<void> {
    const actual = this.conexiones.get(connectionId);
    if (actual !== undefined && actual.nonce === lockNonce) {
      this.conexiones.delete(connectionId);
    }
  }

  /**
   * Purga las entradas VENCIDAS (jti y locks cuyo exp ya paso). En produccion esta limpieza la hace el
   * pg_cron sobre las tablas (V032, NEW-4); aca se replica para la autoridad en memoria (dev/single
   * instance) de modo que NINGUN mapa crezca sin limite y para poder verificar por test que la purga
   * elimina lo vencido. Idempotente.
   */
  purgarVencidos(nowSec: number = this.ahoraSec()): void {
    for (const [jti, exp] of this.jtiConsumidos) {
      if (exp <= nowSec) this.jtiConsumidos.delete(jti);
    }
    for (const [connectionId, lock] of this.conexiones) {
      if (lock.exp <= nowSec) this.conexiones.delete(connectionId);
    }
  }

  /** Solo para tests/observabilidad: cantidad de jti retenidos. */
  get jtiRetenidos(): number {
    return this.jtiConsumidos.size;
  }

  /** Solo para tests/observabilidad: cantidad de locks por conexion retenidos. */
  get conexionesRetenidas(): number {
    return this.conexiones.size;
  }
}
