import type { Sql } from '../db/client.js';
import { cutoffIso, DEFAULT_RETENTION_POLICY, type RetentionPolicy } from './retention-policy.js';

/**
 * Mecanismo de RETENCION Y BORRADO (Fase 5.6). Borra datos de EJECUCION mas viejos que la politica, de
 * forma CONSERVADORA: solo agent_runs (metadatos) mas viejos que la ventana y jobs en estado TERMINAL
 * (completed/failed) ya finalizados; NUNCA toca jobs pending/running ni nada reciente. Recibe el cliente
 * sql por inyeccion (testeable) igual que el resto de los repos.
 *
 * NO reescribe el worker ni el scheduler: es un mecanismo APARTE que se dispara a mano (endpoint admin) o
 * via cron pg_cron opt-in (V016). Reusa el mismo cliente/pool que el resto del backend.
 *
 * El derecho de ERASURE (ARCO/GDPR) ya NO vive aqui: se movio al MOTOR DE BORRADO ATOMICO
 * (account/account-deletion-repository.ts), que cubre las 22 tablas en UNA transaccion (superconjunto
 * atomico del viejo eraseOwnerOperationalData, que borraba 6 tablas sueltas -> hallazgo H-01 auditoria 8).
 * Esta clase conserva SOLO la purga periodica conservadora por retencion.
 */

/** Cantidad de filas borradas por la purga periodica, por tabla. */
export interface PurgeResult {
  agentRuns: number;
  terminalJobs: number;
  trayectoriasWeb: number;
}

export class RetentionRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Borra agent_runs con created_at ANTERIOR al corte. Devuelve cuantas filas borro. El corte es una
   * fecha en el pasado: lo reciente jamas entra al DELETE.
   */
  async purgeAgentRunsOlderThan(cutoff: string): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from agent_runs
      where created_at < ${cutoff}
      returning id
    `;
    return rows.length;
  }

  /**
   * Borra jobs en estado TERMINAL (completed/failed) cuyo finished_at es ANTERIOR al corte. El filtro por
   * status es la salvaguarda clave: un job pending o running NUNCA se borra, sin importar su antiguedad.
   * finished_at is not null protege ademas contra filas terminales sin marca de cierre.
   */
  async purgeTerminalJobsOlderThan(cutoff: string): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from jobs
      where status in ('completed', 'failed')
        and finished_at is not null
        and finished_at < ${cutoff}
      returning id
    `;
    return rows.length;
  }

  /**
   * Borra trayectorias de tareas web (V030) TERMINADAS antes del corte. El on delete cascade de
   * pasos_trayectoria arrastra los pasos de cada trayectoria borrada. Toda trayectoria persistida ya
   * esta terminada (el worker la escribe al cerrar la ejecucion): no hay estado "en vuelo" que
   * proteger; la salvaguarda es el corte en el pasado.
   */
  async purgeTrayectoriasWebOlderThan(cutoff: string): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from trayectorias_web
      where terminada_en < ${cutoff}
      returning id
    `;
    return rows.length;
  }

  /**
   * Purga periodica: aplica la politica (cortes calculados desde `now`) a agent_runs, jobs terminales
   * y trayectorias de tareas web. Recibe `now` (no lo lee) para ser determinista y testeable.
   * Conservadora: solo lo mas viejo que la ventana; nada reciente.
   */
  async purgeExpired(now: Date, policy: RetentionPolicy = DEFAULT_RETENTION_POLICY): Promise<PurgeResult> {
    const agentRuns = await this.purgeAgentRunsOlderThan(cutoffIso(policy.agentRunsDays, now));
    const terminalJobs = await this.purgeTerminalJobsOlderThan(cutoffIso(policy.terminalJobsDays, now));
    const trayectoriasWeb = await this.purgeTrayectoriasWebOlderThan(
      cutoffIso(policy.trayectoriasWebDays, now),
    );
    return { agentRuns, terminalJobs, trayectoriasWeb };
  }
}
