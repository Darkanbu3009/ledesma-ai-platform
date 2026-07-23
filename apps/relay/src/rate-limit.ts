/**
 * Rate limiting del relay, EN MEMORIA, por OWNER y por SESION. Frena abuso sin tocar disco ni base:
 *  - una sola sesion de relay activa por conexion (connectionId): nunca dos canales a la misma sesion,
 *  - un techo de sesiones concurrentes por owner,
 *  - un techo de sesiones NUEVAS por owner en una ventana deslizante (anti flood).
 *
 * `intentar` RESERVA el cupo si lo concede; el llamador DEBE llamar `liberar` exactamente una vez al
 * cerrar (en finally), pase lo que pase. Autoritativo por instancia unica (ver single-use.ts).
 */

export interface OpcionesLimitador {
  /** Sesiones de relay concurrentes por owner. */
  maxPorOwner: number;
  /** Sesiones NUEVAS por owner dentro de la ventana. */
  maxNuevasPorVentana: number;
  /** Tamano de la ventana deslizante (ms). */
  ventanaMs: number;
}

export type MotivoRechazo = 'flood' | 'concurrencia_owner' | 'conexion_ocupada';

export type ResultadoIntento = { ok: true } | { ok: false; motivo: MotivoRechazo };

const DEFAULTS: OpcionesLimitador = {
  maxPorOwner: 5,
  maxNuevasPorVentana: 30,
  ventanaMs: 60_000,
};

export class LimitadorRelay {
  private readonly opciones: OpcionesLimitador;
  private readonly activasPorOwner = new Map<string, number>();
  private readonly conexionesActivas = new Set<string>();
  private readonly nuevasPorOwner = new Map<string, number[]>();

  constructor(opciones: Partial<OpcionesLimitador> = {}) {
    this.opciones = { ...DEFAULTS, ...opciones };
  }

  intentar(ownerId: string, connectionId: string, nowMs: number = Date.now()): ResultadoIntento {
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
    if (this.conexionesActivas.has(connectionId)) {
      this.nuevasPorOwner.set(ownerId, recientes);
      return { ok: false, motivo: 'conexion_ocupada' };
    }
    recientes.push(nowMs);
    this.nuevasPorOwner.set(ownerId, recientes);
    this.activasPorOwner.set(ownerId, (this.activasPorOwner.get(ownerId) ?? 0) + 1);
    this.conexionesActivas.add(connectionId);
    return { ok: true };
  }

  liberar(ownerId: string, connectionId: string): void {
    const restantes = (this.activasPorOwner.get(ownerId) ?? 1) - 1;
    if (restantes <= 0) this.activasPorOwner.delete(ownerId);
    else this.activasPorOwner.set(ownerId, restantes);
    this.conexionesActivas.delete(connectionId);
  }
}
