import type { Sql } from '../db/client.js';

/**
 * Acceso a datos de las SOLICITUDES DE DERECHOS DEL TITULAR (tabla `data_subject_requests`, V014): ARCO de
 * la ley mexicana (acceso/rectificacion/cancelacion/oposicion) + erasure de GDPR. Recibe el cliente sql por
 * inyeccion (testeable) y SIEMPRE acota por owner_id en lecturas del titular. La resolucion (updateStatus)
 * la hace la plataforma (self-service para 'access', admin para el resto) y opera por id.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *).
 */

export type DataSubjectRequestType =
  | 'access'
  | 'rectification'
  | 'cancellation'
  | 'opposition'
  | 'erasure';

export type DataSubjectRequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';

export interface DataSubjectRequest {
  id: string;
  ownerId: string;
  requestType: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  /** Detalle libre del titular. null = sin detalle. */
  details: string | null;
  createdAt: string;
  /** Cuando se resolvio. null mientras siga abierta. */
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface CreateDataSubjectRequestInput {
  ownerId: string;
  requestType: DataSubjectRequestType;
  /** null/ausente = sin detalle. */
  details?: string | null;
}

interface DataSubjectRequestRow {
  id: string;
  owner_id: string;
  request_type: string;
  status: string;
  details: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolution_note: string | null;
}

const EPOCH_ISO = new Date(0).toISOString();

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToRequest(row: DataSubjectRequestRow): DataSubjectRequest {
  return {
    id: row.id,
    ownerId: row.owner_id,
    requestType: row.request_type as DataSubjectRequestType,
    status: row.status as DataSubjectRequestStatus,
    details: row.details,
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
    resolvedAt: toIso(row.resolved_at),
    resolutionNote: row.resolution_note,
  };
}

export class DataSubjectRequestRepository {
  constructor(private readonly sql: Sql) {}

  /** Crea una solicitud del titular en estado 'pending'. status/timestamps los pone la base. */
  async createRequest(input: CreateDataSubjectRequestInput): Promise<DataSubjectRequest> {
    const rows = await this.sql<DataSubjectRequestRow[]>`
      insert into data_subject_requests (owner_id, request_type, details)
      values (${input.ownerId}, ${input.requestType}, ${input.details ?? null})
      returning id, owner_id, request_type, status, details, created_at, resolved_at, resolution_note
    `;
    return rowToRequest(rows[0] as DataSubjectRequestRow);
  }

  /** Lista las solicitudes del titular (mas nuevas primero). */
  async listRequestsByOwner(ownerId: string): Promise<DataSubjectRequest[]> {
    const rows = await this.sql<DataSubjectRequestRow[]>`
      select id, owner_id, request_type, status, details, created_at, resolved_at, resolution_note
      from data_subject_requests
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToRequest);
  }

  /** Resuelve UNA solicitud del titular por id (para el flujo self-service de 'access'). null si ajena. */
  async getRequestForOwner(id: string, ownerId: string): Promise<DataSubjectRequest | null> {
    const rows = await this.sql<DataSubjectRequestRow[]>`
      select id, owner_id, request_type, status, details, created_at, resolved_at, resolution_note
      from data_subject_requests
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToRequest(row) : null;
  }

  /** Resuelve UNA solicitud por id (para el panel admin: no acotado por owner). null si no existe. */
  async getRequestById(id: string): Promise<DataSubjectRequest | null> {
    const rows = await this.sql<DataSubjectRequestRow[]>`
      select id, owner_id, request_type, status, details, created_at, resolved_at, resolution_note
      from data_subject_requests
      where id = ${id}
    `;
    const row = rows[0];
    return row ? rowToRequest(row) : null;
  }

  /**
   * Actualiza el estado de una solicitud (resolucion). Setea resolved_at = now() cuando pasa a un estado
   * terminal (completed/rejected) y lo deja null si vuelve a un estado abierto. Opera por id (lo usa el
   * panel admin, que resuelve solicitudes de cualquier titular). Devuelve la solicitud actualizada o null.
   */
  async updateStatus(
    id: string,
    status: DataSubjectRequestStatus,
    resolutionNote: string | null,
  ): Promise<DataSubjectRequest | null> {
    // Un estado terminal (completed/rejected) fija resolved_at = now(); uno abierto lo limpia. El CASE
    // deja `now()` literal en SQL (sin fragmento anidado) y pasa el booleano como parametro.
    const terminal = status === 'completed' || status === 'rejected';
    const rows = await this.sql<DataSubjectRequestRow[]>`
      update data_subject_requests set
        status = ${status},
        resolution_note = ${resolutionNote},
        resolved_at = case when ${terminal} then now() else null end
      where id = ${id}
      returning id, owner_id, request_type, status, details, created_at, resolved_at, resolution_note
    `;
    const row = rows[0];
    return row ? rowToRequest(row) : null;
  }
}
