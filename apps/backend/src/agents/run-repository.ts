import type { Sql } from '../db/client.js';

/** Metadatos de una corrida a registrar. NUNCA contenido de mensajes, NUNCA llaves. */
export interface AgentRunRecord {
  agentId: string;
  ownerId: string | null;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  status: 'completed' | 'error' | 'aborted';
  errorCode: string | null;
  durationMs: number;
}

export interface AgentUsageTotals {
  runs: number;
  completed: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRunSummary {
  id: string;
  status: string;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  createdAt: string;
}

/** Rango opcional de fechas para acotar consultas por created_at. */
export interface AgentRunRange {
  from?: Date;
  to?: Date;
}

export interface AgentRunsByDay {
  date: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

/** ISO de epoch: fallback no-lanzante para timestamps ausentes o invalidos. */
const EPOCH_ISO = new Date(0).toISOString();

/**
 * Normaliza counts/sums de Postgres a un number FINITO. Postgres devuelve bigint (count/sum)
 * como string, las sumas sobre conjuntos vacios o los tokens de corridas de error pueden llegar
 * como null, y un campo ausente llega como undefined (-> NaN). En todos esos casos devuelve 0:
 * las metricas NUNCA propagan null ni NaN.
 */
function toCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convierte un timestamp de Postgres (Date o string) a ISO 8601 de forma tolerante: si el valor
 * es nulo o no parseable devuelve null en vez de lanzar `RangeError: Invalid time value`. Asi una
 * fila con created_at incompleto degrada en vez de tumbar todo el endpoint de uso con un 500.
 */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Acceso a datos de corridas de agentes. Recibe el cliente sql por inyeccion (testeable). */
export class AgentRunRepository {
  constructor(private readonly sql: Sql) {}

  /** Fragmento `and created_at >= from` o vacio; compone el where de forma segura. */
  private fromCondition(range?: AgentRunRange) {
    return range?.from ? this.sql`and created_at >= ${range.from}` : this.sql``;
  }

  /** Fragmento `and created_at <= to` o vacio; compone el where de forma segura. */
  private toCondition(range?: AgentRunRange) {
    return range?.to ? this.sql`and created_at <= ${range.to}` : this.sql``;
  }

  async record(run: AgentRunRecord): Promise<void> {
    await this.sql`
      insert into agent_runs
        (agent_id, owner_id, provider_id, model, input_tokens, output_tokens, stop_reason, status, error_code, duration_ms)
      values (${run.agentId}, ${run.ownerId}, ${run.providerId}, ${run.model}, ${run.inputTokens},
        ${run.outputTokens}, ${run.stopReason}, ${run.status}, ${run.errorCode}, ${run.durationMs})
    `;
  }

  async totalsForAgent(agentId: string, range?: AgentRunRange): Promise<AgentUsageTotals> {
    // counts/sums de postgres llegan como string (bigint): se mapean a number aqui.
    const rows = await this.sql<{ runs: string; completed: string; errors: string; input_tokens: string; output_tokens: string }[]>`
      select count(*) as runs,
             count(*) filter (where status = 'completed') as completed,
             count(*) filter (where status = 'error') as errors,
             coalesce(sum(input_tokens), 0) as input_tokens,
             coalesce(sum(output_tokens), 0) as output_tokens
      from agent_runs where agent_id = ${agentId}
      ${this.fromCondition(range)} ${this.toCondition(range)}
    `;
    const row = rows[0];
    return {
      runs: toCount(row?.runs),
      completed: toCount(row?.completed),
      errors: toCount(row?.errors),
      inputTokens: toCount(row?.input_tokens),
      outputTokens: toCount(row?.output_tokens),
    };
  }

  async recentForAgent(agentId: string, range?: AgentRunRange, limit = 20): Promise<AgentRunSummary[]> {
    // coalesce a 0 en los tokens: las corridas de error pueden haber guardado NULL y el contrato
    // (AgentRunSummary) promete numbers. Defensa en SQL + normalizacion en el mapeo (toCount).
    const rows = await this.sql<{ id: string; status: string; error_code: string | null; input_tokens: number | null; output_tokens: number | null; duration_ms: number | null; created_at: Date | string | null }[]>`
      select id, status, error_code,
             coalesce(input_tokens, 0) as input_tokens,
             coalesce(output_tokens, 0) as output_tokens,
             coalesce(duration_ms, 0) as duration_ms,
             created_at
      from agent_runs where agent_id = ${agentId}
      ${this.fromCondition(range)} ${this.toCondition(range)}
      order by created_at desc limit ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      errorCode: r.error_code,
      inputTokens: toCount(r.input_tokens),
      outputTokens: toCount(r.output_tokens),
      durationMs: toCount(r.duration_ms),
      // created_at es not-null en el esquema; el fallback a epoch evita un 500 si una fila vieja o
      // incompleta trae el timestamp ausente/invalido (sin descartar la corrida de la lista).
      createdAt: toIso(r.created_at) ?? EPOCH_ISO,
    }));
  }

  /** Serie diaria de corridas y tokens dentro del rango, ordenada por dia ascendente. */
  async runsByDay(agentId: string, range?: AgentRunRange): Promise<AgentRunsByDay[]> {
    const rows = await this.sql<{ day: Date | string | null; runs: string; input_tokens: string | null; output_tokens: string | null }[]>`
      select date_trunc('day', created_at) as day,
             count(*) as runs,
             coalesce(sum(input_tokens), 0) as input_tokens,
             coalesce(sum(output_tokens), 0) as output_tokens
      from agent_runs where agent_id = ${agentId}
      ${this.fromCondition(range)} ${this.toCondition(range)}
      group by 1 order by 1
    `;
    // Un bucket con fecha no parseable se OMITE (no rompe la serie): los tokens ya vienen
    // coalesce'ados en SQL y toCount blinda contra null/NaN en el mapeo.
    const series: AgentRunsByDay[] = [];
    for (const r of rows) {
      const day = toIso(r.day);
      if (day === null) continue;
      series.push({
        date: day.slice(0, 10),
        runs: toCount(r.runs),
        inputTokens: toCount(r.input_tokens),
        outputTokens: toCount(r.output_tokens),
      });
    }
    return series;
  }
}
