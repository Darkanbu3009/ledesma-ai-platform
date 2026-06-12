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
      runs: Number(row?.runs ?? 0),
      completed: Number(row?.completed ?? 0),
      errors: Number(row?.errors ?? 0),
      inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0),
    };
  }

  async recentForAgent(agentId: string, range?: AgentRunRange, limit = 20): Promise<AgentRunSummary[]> {
    const rows = await this.sql<{ id: string; status: string; error_code: string | null; input_tokens: number; output_tokens: number; duration_ms: number; created_at: Date | string }[]>`
      select id, status, error_code, input_tokens, output_tokens, duration_ms, created_at
      from agent_runs where agent_id = ${agentId}
      ${this.fromCondition(range)} ${this.toCondition(range)}
      order by created_at desc limit ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      errorCode: r.error_code,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      durationMs: r.duration_ms,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  /** Serie diaria de corridas y tokens dentro del rango, ordenada por dia ascendente. */
  async runsByDay(agentId: string, range?: AgentRunRange): Promise<AgentRunsByDay[]> {
    const rows = await this.sql<{ day: Date | string; runs: string; input_tokens: string; output_tokens: string }[]>`
      select date_trunc('day', created_at) as day,
             count(*) as runs,
             coalesce(sum(input_tokens), 0) as input_tokens,
             coalesce(sum(output_tokens), 0) as output_tokens
      from agent_runs where agent_id = ${agentId}
      ${this.fromCondition(range)} ${this.toCondition(range)}
      group by 1 order by 1
    `;
    return rows.map((r) => ({
      date: new Date(r.day).toISOString().slice(0, 10),
      runs: Number(r.runs),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
    }));
  }
}
