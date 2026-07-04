import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Plus, Sparkles } from 'lucide-react';
import { useAgents } from '../lib/queries';
import { AgentCard } from '../components/agents/AgentCard';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';

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
    <EmptyState
      media={
        // Hero (arriba): maqueta decorativa de "asi se vera tu agente". No es
        // interactiva (sin texto real, solo barras/chips placeholder); ancla el
        // bloque centrado y anticipa el resultado. Conserva su ancho (no se
        // estira) y se separa del texto con el margen inferior. Oculta en movil
        // para no recargar pantallas chicas.
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
      }
      eyebrow="EMPIEZA AQUI"
      title="El trabajo repetitivo, en piloto automático"
      description="Configura un agente una vez y deja que ejecute tus procesos en tus propios sistemas."
      action={<CreateAgentPill />}
      footer={
        // Alternativa conversacional, sin quitar el alta manual de arriba.
        <Link
          to="/configurador"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-brasa"
        >
          <Sparkles className="h-4 w-4" />
          o crealo conversando con el Configurador
        </Link>
      }
    />
  );
}

export function AgentsPage() {
  const { data: agents, isLoading, isError, refetch } = useAgents();
  const hasAgents = Array.isArray(agents) && agents.length > 0;

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col">
      <PageHeader
        title="Agentes"
        subtitle="Configura y administra tus agentes de IA."
        action={
          hasAgents && (
            <div className="flex flex-wrap items-center gap-2.5">
              <ConfiguratorButton />
              <CreateAgentButton />
            </div>
          )
        }
      />

      {isLoading ? (
        <SkeletonList cardClassName="h-[212px]" className={`mt-8 ${gridClass}`} />
      ) : isError ? (
        <ErrorState title="No pudimos cargar tus agentes" onRetry={() => void refetch()} />
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
