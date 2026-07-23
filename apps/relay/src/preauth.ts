/**
 * PORTERO PRE-AUTENTICACION (B-2): acota los handshakes EN VUELO (todavia sin autenticar) ANTES de que el
 * servidor complete el upgrade WebSocket, genere el par X25519 efimero y retenga una sesion. Sin este
 * cupo, CADA upgrade cuesta un par de llaves y una sesion retenida durante toda la ventana de handshake,
 * aunque el cliente jamas presente credenciales: un atacante SIN token podria agotar memoria y sesiones.
 *
 * Dos topes, ambos evaluados ANTES de aceptar el upgrade (antes de generar llaves):
 *  - GLOBAL: techo duro de handshakes simultaneos sin autenticar. Es la GARANTIA: no depende de ningun
 *    dato controlable por el cliente, asi que ningun atacante lo evade.
 *  - POR IP: techo por IP de cliente, para que una sola fuente no consuma sola el cupo global. La IP se
 *    toma del primer valor de X-Forwarded-For (lo pone el proxy de borde de Railway); ese valor es
 *    CLIENT-CLAIMED y por lo tanto falsificable, por eso el tope por IP es defensa en profundidad y el
 *    tope GLOBAL es la garantia real. Usar la IP del socket en su lugar agruparia a TODOS los usuarios
 *    detras del proxy bajo una sola clave (y a los moviles detras de CGNAT), lo que castigaria el flujo
 *    legitimo; por eso se prefiere la IP declarada, holgada, con el global como respaldo.
 *
 * El cupo se toma al aceptar el upgrade y se libera cuando la sesion AUTENTICA (deja de ser anonima) o
 * cierra, lo que ocurra primero: asi el tope cuenta handshakes EN VUELO y no sesiones ya autenticadas,
 * y una sesion legitima libera su cupo en cuanto prueba el token (no lo retiene mientras teclea).
 */

export type MotivoRechazoPreAuth = 'cap_global' | 'cap_ip';

export interface OpcionesPortero {
  /** Techo global de handshakes sin autenticar simultaneos. Garantia (no evadible). */
  maxGlobal: number;
  /** Techo por IP de cliente de handshakes sin autenticar simultaneos. Defensa en profundidad. */
  maxPorIp: number;
}

/**
 * Defaults holgados a proposito: un usuario real abre UN handshake que se resuelve en sub-segundos, asi
 * que estos topes solo se activan ante un flood. maxPorIp deja margen para muchos moviles detras de una
 * misma IP de CGNAT sin bloquear a ninguno; maxGlobal es el respaldo duro contra el agotamiento.
 */
export const PORTERO_DEFAULTS: OpcionesPortero = {
  maxGlobal: 256,
  maxPorIp: 32,
};

export type ResultadoAdmision = { ok: true } | { ok: false; motivo: MotivoRechazoPreAuth };

export class PorteroPreAuth {
  private readonly opciones: OpcionesPortero;
  private enVuelo = 0;
  private readonly porIp = new Map<string, number>();

  constructor(opciones: Partial<OpcionesPortero> = {}) {
    this.opciones = { ...PORTERO_DEFAULTS, ...opciones };
  }

  /**
   * Reserva un cupo pre-auth para `ip` si hay lugar bajo ambos topes. Devuelve `{ ok: true }` y cuenta el
   * handshake, o el motivo del rechazo SIN contar nada. Se evalua ANTES de generar el par de llaves.
   */
  admitir(ip: string): ResultadoAdmision {
    if (this.enVuelo >= this.opciones.maxGlobal) return { ok: false, motivo: 'cap_global' };
    if ((this.porIp.get(ip) ?? 0) >= this.opciones.maxPorIp) return { ok: false, motivo: 'cap_ip' };
    this.enVuelo += 1;
    this.porIp.set(ip, (this.porIp.get(ip) ?? 0) + 1);
    return { ok: true };
  }

  /**
   * Libera el cupo pre-auth de `ip`. El llamador DEBE invocarlo exactamente una vez por cada `admitir`
   * que devolvio ok (al autenticar o al cerrar, lo que ocurra primero). Es defensivo ante subdesbordes.
   */
  liberar(ip: string): void {
    if (this.enVuelo > 0) this.enVuelo -= 1;
    const n = this.porIp.get(ip);
    if (n === undefined) return;
    if (n <= 1) this.porIp.delete(ip);
    else this.porIp.set(ip, n - 1);
  }

  /** Cantidad de handshakes sin autenticar en vuelo (para auditoria/tests). */
  get enVueloTotal(): number {
    return this.enVuelo;
  }
}
