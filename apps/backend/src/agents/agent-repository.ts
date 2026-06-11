import type { Sql } from '../db/client.js';
import type { AgentConfig, AgentConfigInput } from './types.js';

interface AgentRow {
  id: string;
  name: string;
  description: string;
  provider_id: string;
  model: string;
  system_prompt: string;
  max_tokens: number;
  temperature: number | null;
  base_url: string | null;
  tools: unknown;
  webhook_secret: string;
  owner_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function rowToConfig(row: AgentRow): AgentConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    providerId: row.provider_id as AgentConfig['providerId'],
    model: row.model,
    systemPrompt: row.system_prompt,
    maxTokens: row.max_tokens,
    temperature: row.temperature,
    baseUrl: row.base_url,
    tools: (Array.isArray(row.tools) ? row.tools : []) as AgentConfig['tools'],
    // webhook_secret nunca se inserta ni se actualiza desde aqui: lo genera el default de la base.
    webhookSecret: row.webhook_secret,
    ownerId: row.owner_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Acceso a datos de agentes. Recibe el cliente sql por inyeccion (testeable). */
export class AgentRepository {
  constructor(private readonly sql: Sql) {}

  async list(): Promise<AgentConfig[]> {
    const rows = await this.sql<AgentRow[]>`
      select * from agents order by created_at desc
    `;
    return rows.map(rowToConfig);
  }

  async getById(id: string): Promise<AgentConfig | null> {
    const rows = await this.sql<AgentRow[]>`
      select * from agents where id = ${id}
    `;
    const row = rows[0];
    return row ? rowToConfig(row) : null;
  }

  async create(input: AgentConfigInput): Promise<AgentConfig> {
    const rows = await this.sql<AgentRow[]>`
      insert into agents
        (name, description, provider_id, model, system_prompt, max_tokens, temperature, base_url, tools, owner_id)
      values (
        ${input.name},
        ${input.description ?? ''},
        ${input.providerId},
        ${input.model},
        ${input.systemPrompt ?? ''},
        ${input.maxTokens ?? 1024},
        ${input.temperature ?? null},
        ${input.baseUrl ?? null},
        ${this.sql.json((input.tools ?? []) as unknown as Parameters<Sql['json']>[0])},
        ${input.ownerId ?? null}
      )
      returning *
    `;
    return rowToConfig(rows[0] as AgentRow);
  }

  async update(id: string, input: AgentConfigInput): Promise<AgentConfig | null> {
    const rows = await this.sql<AgentRow[]>`
      update agents set
        name = ${input.name},
        description = ${input.description ?? ''},
        provider_id = ${input.providerId},
        model = ${input.model},
        system_prompt = ${input.systemPrompt ?? ''},
        max_tokens = ${input.maxTokens ?? 1024},
        temperature = ${input.temperature ?? null},
        base_url = ${input.baseUrl ?? null},
        tools = ${this.sql.json((input.tools ?? []) as unknown as Parameters<Sql['json']>[0])},
        owner_id = ${input.ownerId ?? null},
        updated_at = now()
      where id = ${id}
      returning *
    `;
    const row = rows[0];
    return row ? rowToConfig(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.sql<AgentRow[]>`
      delete from agents where id = ${id} returning id
    `;
    return rows.length > 0;
  }

  async listByOwner(ownerId: string): Promise<AgentConfig[]> {
    const rows = await this.sql<AgentRow[]>`
      select * from agents where owner_id = ${ownerId} order by created_at desc
    `;
    return rows.map(rowToConfig);
  }

  async getByIdForOwner(id: string, ownerId: string): Promise<AgentConfig | null> {
    const rows = await this.sql<AgentRow[]>`
      select * from agents where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToConfig(row) : null;
  }

  async updateForOwner(id: string, ownerId: string, input: AgentConfigInput): Promise<AgentConfig | null> {
    const rows = await this.sql<AgentRow[]>`
      update agents set
        name = ${input.name},
        description = ${input.description ?? ''},
        provider_id = ${input.providerId},
        model = ${input.model},
        system_prompt = ${input.systemPrompt ?? ''},
        max_tokens = ${input.maxTokens ?? 1024},
        temperature = ${input.temperature ?? null},
        base_url = ${input.baseUrl ?? null},
        tools = ${this.sql.json((input.tools ?? []) as unknown as Parameters<Sql['json']>[0])},
        updated_at = now()
      where id = ${id} and owner_id = ${ownerId}
      returning *
    `;
    const row = rows[0];
    return row ? rowToConfig(row) : null;
  }

  async removeForOwner(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<AgentRow[]>`
      delete from agents where id = ${id} and owner_id = ${ownerId} returning id
    `;
    return rows.length > 0;
  }
}
