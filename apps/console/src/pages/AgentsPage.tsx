import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useAgents } from '../lib/queries';
import { AgentCard } from '../components/agents/AgentCard';

const gridClass =
  'grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr))]';

function CreateAgentButton() {
  return (
    <Link
      to="/agentes/nuevo"
      className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-[#C8460F] hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]"
    >
      <Plus className="h-[17px] w-[17px]" />
      Crear agente
    </Link>
  );
}

// Entrada al alta CONVERSACIONAL (Configurador). Es aditiva: convive con el alta manual
// (CreateAgentButton -> /agentes/nuevo) sin reemplazarla.
function ConfiguratorButton() {
  return (
    <Link
      to="/configurador"
      className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface px-[20px] py-[11px] text-sm font-semibold text-ink transition hover:border-brasa-line hover:text-brasa"
    >
      <Sparkles className="h-[17px] w-[17px]" />
      Crear con el Configurador
    </Link>
  );
}

// Boton pildora con flecha, usado en el estado vacio. Dispara la misma accion
// que CreateAgentButton (navegar a /agentes/nuevo).
function CreateAgentPill() {
  return (
    <Link
      to="/agentes/nuevo"
      className="group inline-flex h-11 items-center gap-3 rounded-full bg-brasa pl-6 pr-[7px] text-sm font-medium text-white transition hover:bg-brasa-hover"
    >
      Crear agente
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-brasa transition group-hover:translate-x-0.5">
        <ArrowRight className="h-[18px] w-[18px]" />
      </span>
    </Link>
  );
}

function AgentsEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {/* Hero (arriba): maqueta decorativa de "asi se vera tu agente". No es
          interactiva (sin texto real, solo barras/chips placeholder); ancla el
          bloque centrado y anticipa el resultado. Conserva su ancho (no se
          estira) y se separa del texto con el margen inferior. Oculta en movil
          para no recargar pantallas chicas. */}
      <div className="mb-10 hidden md:block">
        <div
          aria-hidden="true"
          className="w-[230px] rounded-2xl border border-line-soft bg-surface p-[18px] shadow-card"
        >
          {/* Encabezado: icono de agente + nombre y subtitulo (placeholder). */}
          <div className="flex items-center gap-3">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa-soft text-brasa">
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-2.5 w-[90px] rounded-full bg-line" />
              <span className="block h-2 w-[60px] rounded-full bg-line-soft" />
            </div>
          </div>
          {/* Cuerpo: dos lineas de descripcion (placeholder). */}
          <div className="mt-[18px] space-y-2">
            <span className="block h-[7px] w-full rounded-full bg-line-soft" />
            <span className="block h-[7px] w-4/5 rounded-full bg-line-soft" />
          </div>
          {/* Pie: chips de tags/acciones (placeholder). */}
          <div className="mt-[18px] flex items-center gap-2">
            <span className="block h-[22px] w-[54px] rounded-full bg-brasa-soft" />
            <span className="block h-[22px] w-[40px] rounded-full bg-line-soft" />
          </div>
        </div>
      </div>
      <span className="inline-flex items-center rounded-md bg-brasa-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#993C1D]">
        EMPIEZA AQUI
      </span>
      <h2 className="mt-4 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        El trabajo repetitivo, en piloto automático
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.5] text-muted">
        Configura un agente una vez y deja que ejecute tus procesos en tus propios sistemas.
      </p>
      <div className="mt-7">
        <CreateAgentPill />
      </div>
      {/* Alternativa conversacional, sin quitar el alta manual de arriba. */}
      <Link
        to="/configurador"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-brasa"
      >
        <Sparkles className="h-4 w-4" />
        o crealo conversando con el Configurador
      </Link>
    </div>
  );
}

export function AgentsPage() {
  const { data: agents, isLoading, isError, refetch } = useAgents();
  const hasAgents = Array.isArray(agents) && agents.length > 0;

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Agentes</h1>
          <p className="mt-1.5 text-[15px] text-muted">Configura y administra tus agentes de IA.</p>
        </div>
        {hasAgents && (
          <div className="flex flex-wrap items-center gap-2.5">
            <ConfiguratorButton />
            <CreateAgentButton />
          </div>
        )}
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
        <AgentsEmptyState />
      ) : (
        <div className={`mt-8 ${gridClass}`}>
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
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
