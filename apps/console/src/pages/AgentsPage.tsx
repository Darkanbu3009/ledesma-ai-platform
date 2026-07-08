import { Link } from 'react-router-dom';
import { ArrowRight, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useAgents } from '../lib/queries';
import { AgentCard } from '../components/agents/AgentCard';
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
// superior y chip/pill neutro sobre greige.
const cardLabelClass =
  'text-[11.5px] font-medium uppercase tracking-[0.12em]';
const neutralChipClass =
  'inline-flex items-center rounded-full bg-[#F1EFE8] px-[10px] py-1 text-xs text-[#5F5E5A]';

// Estado vacio: dos vias de creacion lado a lado. La tarjeta A (Configurador) es la
// protagonista y lleva el unico acento brasa de la pagina (su CTA); la tarjeta B (manual)
// queda en neutros. Ambos CTAs navegan a los mismos destinos que siempre:
// /configurador y /agentes/nuevo.
function AgentsEmptyState() {
  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Tarjeta A — Configurador (protagonista). La jerarquia sobre la tarjeta B es solo
            de superficie: fondo blanco y borde un punto mas firme. */}
        <div className="flex flex-col rounded-xl border border-[#D3D1C7] bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-[18px] w-[18px] text-[#5F5E5A]" aria-hidden="true" />
            <span className={`${cardLabelClass} text-[#5F5E5A]`}>Configurador</span>
            <span className="inline-flex items-center rounded-full bg-[#F1EFE8] px-[10px] py-1 text-[11px] font-medium text-[#444441]">
              Recomendado
            </span>
          </div>
          <h3 className="mt-4 text-[17px] font-medium text-ink">
            Descríbelo. Nosotros lo armamos.
          </h3>
          <p className="mt-2 text-[13px] leading-[1.5] text-[#5F5E5A]">
            Cuenta en tus palabras qué proceso quieres automatizar y el Configurador construye
            el agente conversando contigo.
          </p>
          <div className="mt-4 rounded-[10px] border-[0.5px] border-[#E9E7DF] bg-[#FAF9F5] px-3 py-[11px]">
            <p className="text-[13px] italic leading-[1.5] text-[#5F5E5A]">
              “Quiero un agente que revise las facturas que llegan a mi correo y las registre
              en mi sistema...”
            </p>
          </div>
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
        <div className="flex flex-col rounded-xl border-[0.5px] border-[#E9E7DF] bg-[#FAF9F5] p-5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-[18px] w-[18px] text-[#8A8880]" aria-hidden="true" />
            <span className={`${cardLabelClass} text-[#8A8880]`}>Manual</span>
          </div>
          <h3 className="mt-4 text-[17px] font-medium text-ink">
            Configúralo tú, campo por campo
          </h3>
          <p className="mt-2 text-[13px] leading-[1.5] text-[#8A8880]">
            Define modelo, system prompt, herramientas y límites con control total. Para cuando
            ya sabes exactamente qué quieres.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <span className={neutralChipClass}>modelo</span>
            <span className={neutralChipClass}>system prompt</span>
            <span className={neutralChipClass}>tools</span>
            <span className={neutralChipClass}>límites</span>
          </div>
          <div className="mt-auto pt-5">
            <Button variant="secondary-neutral" asChild>
              <Link to="/agentes/nuevo">Crear agente</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Fila "Como funciona un agente": tres pasos estaticos en linea, sin tarjeta
          contenedora. En pantallas angostas se apilan y las flechas se ocultan. */}
      <div className="mt-10 border-t-[0.5px] border-[#E3E1D9] pt-8">
        <div className="grid grid-cols-1 gap-6 md:[grid-template-columns:1fr_auto_1fr_auto_1fr] md:items-start md:gap-5">
          <HowItWorksStep
            number="01"
            title="Lo defines"
            description="Qué hace, con qué modelo y con qué herramientas."
          />
          <HowItWorksArrow />
          <HowItWorksStep
            number="02"
            title="Lo pruebas"
            description="En el Playground, con tu propia API key."
          />
          <HowItWorksArrow />
          <HowItWorksStep
            number="03"
            title="Lo sueltas"
            description="Corre solo con tareas, triggers y recetas — o embebido en tu sistema."
          />
        </div>
      </div>
    </div>
  );
}

function HowItWorksStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <span className="text-[13px] font-medium text-[#8A8880]">{number}</span>
      <h4 className="mt-1 text-[13px] font-medium text-ink">{title}</h4>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-[#8A8880]">{description}</p>
    </div>
  );
}

function HowItWorksArrow() {
  return (
    <ArrowRight
      className="mt-6 hidden h-4 w-4 text-[#D3D1C7] md:block"
      aria-hidden="true"
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
