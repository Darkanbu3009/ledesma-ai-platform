import { Plus } from 'lucide-react';
import type { AgentSummary } from '../lib/agents';
import { AgentCard } from '../components/agents/AgentCard';

// Datos de ejemplo (vista previa de diseno). Los agentes reales se conectaran al backend en una
// etapa proxima (requiere validacion de JWT en el backend).
const sampleAgents: AgentSummary[] = [
  { id: '1', name: 'Cotizador', description: 'Genera cotizaciones a partir de solicitudes de clientes.', providerId: 'anthropic', model: 'claude-sonnet-4-6', toolCount: 2 },
  { id: '2', name: 'Soporte N1', description: 'Responde preguntas frecuentes y clasifica tickets entrantes.', providerId: 'openai', model: 'gpt-5.5', toolCount: 1 },
  { id: '3', name: 'Conciliador', description: 'Concilia facturas contra ordenes de compra automaticamente.', providerId: 'openai-compatible', model: 'llama-3.3-70b', toolCount: 3 },
];

export function AgentsPage() {
  const agents = sampleAgents;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-hueso">Agentes</h1>
          <p className="mt-1 text-sm text-hueso-muted">Configura y administra tus agentes de IA.</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-brasa px-4 py-2.5 text-sm font-semibold text-carbon transition hover:bg-brasa-hover"
        >
          <Plus className="h-4 w-4" />
          Crear agente
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-grafito-border bg-grafito/40 px-4 py-2.5 text-xs text-hueso-muted">
        Vista previa de diseno. Los agentes reales apareceran aqui cuando se conecte el backend en la proxima etapa.
      </div>

      {agents.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-grafito-border py-16 text-center">
          <p className="font-display text-lg text-hueso">Aun no tienes agentes</p>
          <p className="mt-2 text-sm text-hueso-muted">Crea tu primer agente para empezar.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
