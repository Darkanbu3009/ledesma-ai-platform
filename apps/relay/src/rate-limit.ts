/**
 * Rate limiting del relay, EN MEMORIA, por OWNER. Frena abuso sin tocar disco ni base:
 *  - un techo de sesiones concurrentes por owner,
 *  - un techo de sesiones NUEVAS por owner en una ventana deslizante (anti flood).
 *
 * BEST-EFFORT, NO invariante de seguridad. Estos contadores viven en la memoria de CADA instancia a
 * proposito: NO son un control de seguridad, son un amortiguador de abuso. Con MULTIPLES instancias
 * (p.ej. la ventana de un rolling deploy en Railway) estos limites se MULTIPLICAN por la cantidad de
 * instancias: un owner podria abrir hasta `maxPorOwner * N` canales concurrentes. Es aceptable porque
 * frenar abuso masivo no exige exactitud; lo que SI es invariante de seguridad (uso unico del jti y un
 * solo canal por conexion) NO vive aca sino en la autoridad COMPARTIDA (ver autoridad.ts), justamente
 * para que no se multiplique. Documentado tambien en docs/despliegue-relay.md.
 *
 * `intentar` RESERVA el cupo del owner si lo concede; el llamador DEBE llamar `liberar` exactamente una
 * vez al cerrar (en finally), pase lo que pase.
 */

export interface OpcionesLimitador {
  /** Sesiones de relay concurrentes por owner (best-effort por instancia). */
  maxPorOwner: number;
  /** Sesiones NUEVAS por owner dentro de la ventana (best-effort por instancia). */
  maxNuevasPorVentana: number;
  /** Tamano de la ventana deslizante (ms). */
  ventanaMs: number;
}

export type MotivoRechazo = 'flood' | 'concurrencia_owner';

export type ResultadoIntento = { ok: true } | { ok: false; motivo: MotivoRechazo };

const DEFAULTS: OpcionesLimitador = {
  maxPorOwner: 5,
  maxNuevasPorVentana: 30,
  ventanaMs: 60_000,
};

export class LimitadorRelay {
  private readonly opciones: OpcionesLimitador;
  private readonly activasPorOwner = new Map<string, number>();
  private readonly nuevasPorOwner = new Map<string, number[]>();

  constructor(opciones: Partial<OpcionesLimitador> = {}) {
    this.opciones = { ...DEFAULTS, ...opciones };
  }

  intentar(ownerId: string, nowMs: number = Date.now()): ResultadoIntento {
    const recientes = (this.nuevasPorOwner.get(ownerId) ?? []).filter(
      (t) => t > nowMs - this.opciones.ventanaMs,
    );
    if (recientes.length >= this.opciones.maxNuevasPorVentana) {
      this.nuevasPorOwner.set(ownerId, recientes);
      return { ok: false, motivo: 'flood' };
    }
    if ((this.activasPorOwner.get(ownerId) ?? 0) >= this.opciones.maxPorOwner) {
      this.nuevasPorOwner.set(ownerId, recientes);
      return { ok: false, motivo: 'concurrencia_owner' };
    }
    recientes.push(nowMs);
    this.nuevasPorOwner.set(ownerId, recientes);
    this.activasPorOwner.set(ownerId, (this.activasPorOwner.get(ownerId) ?? 0) + 1);
    return { ok: true };
  }

  liberar(ownerId: string): void {
    const restantes = (this.activasPorOwner.get(ownerId) ?? 1) - 1;
    if (restantes <= 0) this.activasPorOwner.delete(ownerId);
    else this.activasPorOwner.set(ownerId, restantes);
  }
}
