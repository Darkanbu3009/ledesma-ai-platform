import { Plus, RefreshCw } from 'lucide-react';
import { useAgents } from '../lib/queries';
import { AgentCard } from '../components/agents/AgentCard';

export function AgentsPage() {
  const { data: agents, isLoading, isError, refetch } = useAgents();

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

      {isLoading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 rounded-xl border border-grafito-border bg-grafito p-8 text-center">
          <p className="font-display text-lg text-hueso">No pudimos cargar tus agentes</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : !agents || agents.length === 0 ? (
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
