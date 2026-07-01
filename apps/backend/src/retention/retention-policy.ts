// POLITICA DE RETENCION (Fase 5.6). Alineada al principio de calidad/proporcionalidad de la LFPDPPP y a
// la minimizacion del GDPR: los datos se conservan SOLO el tiempo necesario. La politica es CONSERVADORA
// y EXPLICITA a proposito: no borra nada por defecto de forma agresiva; el borrado se dispara a mano
// (endpoint admin) o via un cron pg_cron OPT-IN (V015/V016). Estos son los defaults elegidos:
//
//   - agentRunsDays = 365: agent_runs guarda SOLO metadatos (V003: sin contenido de mensajes, sin llaves).
//     Un ano cubre reporteria de uso anual antes de purgar. Generoso porque el dato es poco sensible.
//   - terminalJobsDays = 90: jobs es la COLA (V008); una corrida TERMINAL (completed/failed) ya cumplio su
//     proposito. 90 dias deja margen de auditoria/debug. NUNCA se tocan jobs pending/running.
//
// Ningun dato RECIENTE se borra: el corte es una fecha en el pasado (now - dias). Subir estos numeros solo
// retiene mas; bajarlos retiene menos. La eliminacion real vive en RetentionRepository (testeable).

export interface RetentionPolicy {
  /** Dias que se conservan las corridas de agentes (agent_runs, solo metadatos). */
  agentRunsDays: number;
  /** Dias que se conservan los jobs en estado TERMINAL (completed/failed) desde que finalizaron. */
  terminalJobsDays: number;
}

/** Default conservador de la plataforma. Explicito para que sea auditable. */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  agentRunsDays: 365,
  terminalJobsDays: 90,
};

/**
 * Fecha de corte (ISO) para una ventana de retencion: `now - days`. Todo lo ANTERIOR a este instante es
 * elegible para borrado; lo posterior (reciente) se conserva. Pura y testeable (recibe `now`, no lo lee).
 */
export function cutoffIso(days: number, now: Date): string {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}
