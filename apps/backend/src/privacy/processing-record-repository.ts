import type { Sql } from '../db/client.js';

/**
 * Acceso a datos del REGISTRO DE ACTIVIDADES DE TRATAMIENTO (tabla `processing_records`, V014). Espeja el
 * Art 30 GDPR y el principio de responsabilidad de la LFPDPPP: que trata cada agente y para que. Recibe el
 * cliente sql por inyeccion (testeable) y SIEMPRE acota por owner_id.
 *
 * Puede poblarse al crear/ejecutar agentes (accountability), pero esta capa solo persiste/lee; el enganche
 * con /v1/agents queda fuera de este PR para no reescribir esa ruta. Columnas SIEMPRE explicitas.
 */

export interface ProcessingRecord {
  id: string;
  ownerId: string;
  /** Agente asociado (opcional). null = tratamiento no ligado a un agente concreto. */
  agentId: string | null;
  /** Finalidad del tratamiento. */
  purpose: string;
  /** Categorias de datos tratados (texto descriptivo). */
  dataCategories: string;
  createdAt: string;
}

export interface CreateProcessingRecordInput {
  ownerId: string;
  /** null/ausente = tratamiento sin agente asociado. */
  agentId?: string | null;
  purpose: string;
  dataCategories: string;
}

interface ProcessingRecordRow {
  id: string;
  owner_id: string;
  agent_id: string | null;
  purpose: string;
  data_categories: string;
  created_at: Date | string;
}

const EPOCH_ISO = new Date(0).toISOString();

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToRecord(row: ProcessingRecordRow): ProcessingRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    purpose: row.purpose,
    dataCategories: row.data_categories,
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
  };
}

export class ProcessingRecordRepository {
  constructor(private readonly sql: Sql) {}

  /** Registra una actividad de tratamiento. created_at lo pone la base. */
  async createRecord(input: CreateProcessingRecordInput): Promise<ProcessingRecord> {
    const rows = await this.sql<ProcessingRecordRow[]>`
      insert into processing_records (owner_id, agent_id, purpose, data_categories)
      values (${input.ownerId}, ${input.agentId ?? null}, ${input.purpose}, ${input.dataCategories})
      returning id, owner_id, agent_id, purpose, data_categories, created_at
    `;
    return rowToRecord(rows[0] as ProcessingRecordRow);
  }

  /** Lista los registros de tratamiento del owner (mas nuevos primero). */
  async listRecordsByOwner(ownerId: string): Promise<ProcessingRecord[]> {
    const rows = await this.sql<ProcessingRecordRow[]>`
      select id, owner_id, agent_id, purpose, data_categories, created_at
      from processing_records
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToRecord);
  }
}
