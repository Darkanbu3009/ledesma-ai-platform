import { Link } from 'react-router-dom';
import { ArrowRight, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useAgents } from '../lib/queries';
import { AgentCard } from '../components/agents/AgentCard';
import { ChatDemoConfigurador } from '../components/agents/ChatDemoConfigurador';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { Button } from '../components/ui/button';

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

// Estilos compartidos entre las dos tarjetas del estado vacio: label uppercase de la fila
// superior y titulo.
const cardLabelClass =
  'text-[11.5px] font-medium uppercase tracking-[0.12em]';
const cardTitleClass = 'mt-4 text-[19px] font-medium tracking-[-0.01em] text-ink';

// Filas del mini-formulario estatico de la tarjeta Manual: puro contenido de muestra.
const manualFormRows: Array<[label: string, value: string]> = [
  ['Modelo', 'Claude Sonnet'],
  ['System prompt', 'Tu definición'],
  ['Herramientas', 'HTTP · web · archivos'],
  ['Límites', 'Presupuesto y pasos'],
];

// Estado vacio: dos vias de creacion lado a lado. La tarjeta A (Configurador) es la
// protagonista y concentra el brasa de la pagina (su CTA, el icono sparkles y el tinte
// de las burbujas de usuario de la demo); la tarjeta B (manual)
// queda en neutros. Ambos CTAs navegan a los mismos destinos que siempre:
// /configurador y /agentes/nuevo.
function AgentsEmptyState() {
  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Tarjeta A — Configurador (protagonista). La jerarquia sobre la tarjeta B es solo
            de superficie: fondo blanco y borde un punto mas firme. */}
        <div className="flex flex-col rounded-[14px] border border-[#D3D1C7] bg-white p-[22px]">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-[17px] w-[17px] text-brasa" aria-hidden="true" />
            <span className={`${cardLabelClass} text-[#5F5E5A]`}>Configurador</span>
            <span className="inline-flex items-center rounded-full bg-[#F1EFE8] px-[10px] py-1 text-[11px] font-medium text-[#444441]">
              Recomendado
            </span>
          </div>
          <h3 className={cardTitleClass}>Descríbelo. Nosotros lo armamos.</h3>
          <p className="mt-2 text-[13px] leading-[1.5] text-[#5F5E5A]">
            Cuenta qué proceso quieres automatizar y el Configurador construye el agente
            conversando contigo.
          </p>
          {/* Mini-conversacion animada (decorativa) que muestra el flujo del Configurador. */}
          <ChatDemoConfigurador />
          <div className="mt-auto pt-5">
            <Button asChild>
              <Link to="/configurador">
                Conversar con el Configurador
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Tarjeta B — Manual (secundaria): superficie marfil y borde suave. */}
        <div className="flex flex-col rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-[#FAF9F5] p-[22px]">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-[17px] w-[17px] text-[#8A8880]" aria-hidden="true" />
            <span className={`${cardLabelClass} text-[#8A8880]`}>Manual</span>
          </div>
          <h3 className={cardTitleClass}>Configúralo tú, campo por campo</h3>
          <p className="mt-2 text-[13px] leading-[1.5] text-[#8A8880]">
            Control total sobre cada parámetro. Para cuando ya sabes exactamente qué quieres.
          </p>
          {/* Mini-formulario estatico: tarjeta blanca interna con filas campo/valor
              separadas por hairlines, como muestra de lo que se configura. */}
          <div className="mt-4 rounded-[10px] border-[0.5px] border-[#E9E7DF] bg-white px-[14px] py-[6px]">
            {manualFormRows.map(([label, value], index) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-3 py-[6px] ${
                  index < manualFormRows.length - 1
                    ? 'border-b-[0.5px] border-[#F1EFE8]'
                    : ''
                }`}
              >
                <span className="text-[12.5px] text-[#8A8880]">{label}</span>
                <span className="text-right text-[12.5px] font-medium text-ink">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto pt-5">
            <Button variant="secondary-neutral" asChild>
              <Link to="/agentes/nuevo">Crear agente</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Fila "Como funciona": tres mini-cards estaticas, sin flechas ni separador.
          En pantallas angostas se apilan a una columna. */}
      <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <HowItWorksCard
          number="01"
          title="Lo defines"
          description="Qué hace, modelo y herramientas."
        />
        <HowItWorksCard
          number="02"
          title="Lo pruebas"
          description="En el Playground, con tu API key."
        />
        <HowItWorksCard
          number="03"
          title="Lo sueltas"
          description="Tareas, triggers, recetas o embebido."
        />
      </div>
    </div>
  );
}

function HowItWorksCard({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-baseline gap-3 rounded-[10px] border-[0.5px] border-[#E9E7DF] bg-white px-4 py-3">
      <span className="text-[13px] font-medium text-[#B4B2A9] [font-variant-numeric:tabular-nums]">
        {number}
      </span>
      <div>
        <h4 className="text-[13px] font-medium text-ink">{title}</h4>
        <p className="mt-0.5 text-[12px] leading-[1.5] text-[#8A8880]">{description}</p>
      </div>
    </div>
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
