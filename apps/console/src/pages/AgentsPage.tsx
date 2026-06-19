import { Link } from 'react-router-dom';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import { useAgents } from '../lib/queries';
import { AgentCard } from '../components/agents/AgentCard';

const gridClass =
  'grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr))]';

function CreateAgentButton() {
  return (
    <Link
      to="/agentes/nuevo"
      className="inline-flex items-center gap-2 rounded-xl bg-brasa px-[18px] py-3 text-sm font-semibold text-white shadow-brasa transition hover:bg-brasa-hover"
    >
      <Plus className="h-[17px] w-[17px]" />
      Crear agente
    </Link>
  );
}

export function AgentsPage() {
  const { data: agents, isLoading, isError, refetch } = useAgents();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Agentes</h1>
          <p className="mt-1.5 text-[15px] text-muted">Configura y administra tus agentes de IA.</p>
        </div>
        <CreateAgentButton />
      </div>

      {isLoading ? (
        <div className={`mt-8 ${gridClass}`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[212px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">No pudimos cargar tus agentes</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexión e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : !agents || agents.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-line bg-surface px-6 py-16 text-center shadow-card">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
            <Bot className="h-7 w-7" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink">Aún no tienes agentes</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Crea tu primer agente para automatizar trabajo dentro de las plataformas que tu empresa
            ya usa.
          </p>
          <div className="mt-6">
            <CreateAgentButton />
          </div>
        </div>
      ) : (
        <div className={`mt-8 ${gridClass}`}>
          {agents.map((agent) => (
            <Link key={agent.id} to={`/agentes/${agent.id}`} className="block h-full">
              <AgentCard agent={agent} />
            </Link>
          ))}
          <Link
            to="/agentes/nuevo"
            className="flex min-h-[212px] flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed border-line p-[22px] text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa"
          >
            <span className="flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-brasa-soft text-brasa">
              <Plus className="h-[22px] w-[22px]" />
            </span>
            <span className="text-sm font-semibold">Crear agente</span>
          </Link>
        </div>
      )}
    </div>
  );
}
