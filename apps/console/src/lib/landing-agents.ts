export type AgentId = 'ap' | 'quotations' | 'cs';

export interface LandingAgent {
  id: AgentId;
  name: string;
}

/**
 * Lista minima de agentes de ejemplo de la landing (id + nombre). Es propia de la landing
 * y NO se acopla a `lib/agents.ts` de la consola (que tiene otra forma y otro proposito):
 * la seccion "Ejemplos en vivo" solo necesita el id (para mapear icono/copy) y el nombre.
 */
export const AGENTS: LandingAgent[] = [
  { id: 'ap', name: 'Cuentas por Pagar' },
  { id: 'quotations', name: 'Cotizaciones' },
  { id: 'cs', name: 'Customer Success' },
];
