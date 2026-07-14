export type AgentId = 'ap' | 'quotations' | 'cs';

export interface LandingAgent {
  id: AgentId;
  nameKey: string;
}

/**
 * Lista minima de agentes de ejemplo de la landing (id + clave del nombre, resuelta con t() en el
 * render). Es propia de la landing y NO se acopla a `lib/agents.ts` de la consola (que tiene otra
 * forma y otro proposito): la seccion "Ejemplos en vivo" solo necesita el id (para mapear
 * icono/copy) y el nombre.
 */
export const AGENTS: LandingAgent[] = [
  { id: 'ap', nameKey: 'landing.ejemplos.agentes.ap.nombre' },
  { id: 'quotations', nameKey: 'landing.ejemplos.agentes.quotations.nombre' },
  { id: 'cs', nameKey: 'landing.ejemplos.agentes.cs.nombre' },
];
