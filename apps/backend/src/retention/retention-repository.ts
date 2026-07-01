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
 * Ademas conecta el derecho de ERASURE (ARCO/GDPR, Parte D): eraseOwnerOperationalData borra los datos
 * OPERATIVOS de un titular (runs, jobs, tareas, triggers, recetas, registros de tratamiento). El borrado
 * de perfil/credenciales/agentes es MANUAL (fuera de este mecanismo) por su mayor impacto.
 */

/** Cantidad de filas borradas por la purga periodica, por tabla. */
export interface PurgeResult {
  agentRuns: number;
  terminalJobs: number;
}

/** Cantidad de filas borradas al ejercer erasure sobre los datos operativos de un titular. */
export interface EraseResult {
  agentRuns: number;
  jobs: number;
  scheduledTasks: number;
  triggers: number;
  recipes: number;
  processingRecords: number;
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
   * Purga periodica: aplica la politica (cortes calculados desde `now`) a agent_runs y jobs terminales.
   * Recibe `now` (no lo lee) para ser determinista y testeable. Conservadora: solo lo mas viejo que la
   * ventana; nada reciente.
   */
  async purgeExpired(now: Date, policy: RetentionPolicy = DEFAULT_RETENTION_POLICY): Promise<PurgeResult> {
    const agentRuns = await this.purgeAgentRunsOlderThan(cutoffIso(policy.agentRunsDays, now));
    const terminalJobs = await this.purgeTerminalJobsOlderThan(cutoffIso(policy.terminalJobsDays, now));
    return { agentRuns, terminalJobs };
  }

  /**
   * ERASURE (Parte D): borra los datos OPERATIVOS de un titular, acotado por owner_id en cada tabla. NO
   * borra el perfil, las credenciales ni los agentes (borrado manual, mayor impacto). El borrado de jobs
   * aqui SI incluye pending/running: es una solicitud explicita de supresion del titular, no la purga
   * periodica. Devuelve el conteo por tabla para la nota de resolucion.
   */
  async eraseOwnerOperationalData(ownerId: string): Promise<EraseResult> {
    const agentRuns = await this.sql<Array<{ id: string }>>`
      delete from agent_runs where owner_id = ${ownerId} returning id
    `;
    const jobs = await this.sql<Array<{ id: string }>>`
      delete from jobs where owner_id = ${ownerId} returning id
    `;
    const scheduledTasks = await this.sql<Array<{ id: string }>>`
      delete from scheduled_tasks where owner_id = ${ownerId} returning id
    `;
    const triggers = await this.sql<Array<{ id: string }>>`
      delete from triggers where owner_id = ${ownerId} returning id
    `;
    const recipes = await this.sql<Array<{ id: string }>>`
      delete from recipes where owner_id = ${ownerId} returning id
    `;
    const processingRecords = await this.sql<Array<{ id: string }>>`
      delete from processing_records where owner_id = ${ownerId} returning id
    `;
    return {
      agentRuns: agentRuns.length,
      jobs: jobs.length,
      scheduledTasks: scheduledTasks.length,
      triggers: triggers.length,
      recipes: recipes.length,
      processingRecords: processingRecords.length,
    };
  }
}
