import { Link } from 'react-router-dom';
import { Bot, MessageCircle, Pencil, Wrench } from 'lucide-react';
import type { AgentConfig, ProviderId } from '../../lib/agents';
import { playgroundPath, providerLabel } from '../../lib/agents';

type Accent = {
  bar: string;
  iconBox: string;
  badge: string;
  hoverBorder: string;
};

/** Clases por proveedor (literales para que el JIT de Tailwind las detecte). */
const ACCENTS: Partial<Record<ProviderId, Accent>> = {
  anthropic: {
    bar: 'bg-anthropic',
    iconBox: 'bg-anthropic-soft text-anthropic',
    badge: 'border-anthropic-line bg-anthropic-soft text-anthropic',
    hoverBorder: 'hover:border-anthropic-line',
  },
  openai: {
    bar: 'bg-openai',
    iconBox: 'bg-openai-soft text-openai',
    badge: 'border-openai-line bg-openai-soft text-openai',
    hoverBorder: 'hover:border-openai-line',
  },
  'openai-compatible': {
    bar: 'bg-oss',
    iconBox: 'bg-oss-soft text-oss',
    badge: 'border-oss-line bg-oss-soft text-oss',
    hoverBorder: 'hover:border-oss-line',
  },
};

/** Proveedor no listado: cae al acento de marca (brasa). */
const FALLBACK_ACCENT: Accent = {
  bar: 'bg-brasa',
  iconBox: 'bg-brasa-soft text-brasa',
  badge: 'border-brasa-line bg-brasa-soft text-brasa',
  hoverBorder: 'hover:border-brasa-line',
};

export function AgentCard({ agent }: { agent: AgentConfig }) {
  const accent = ACCENTS[agent.providerId] ?? FALLBACK_ACCENT;
  const toolsCount = agent.tools.length;

  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-[22px] shadow-card transition duration-200 hover:-translate-y-[3px] hover:shadow-card-hover ${accent.hoverBorder}`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent.bar}`} aria-hidden="true" />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl ${accent.iconBox}`}
          >
            <Bot className="h-5 w-5" />
          </span>
          <h3 className="truncate font-display text-[17px] font-bold text-ink">{agent.name}</h3>
        </div>
        <span
          className={`flex-none whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide ${accent.badge}`}
        >
          {providerLabel(agent.providerId)}
        </span>
      </div>

      <span className="inline-block rounded-md border border-line bg-field px-2.5 py-1 font-mono text-xs text-ink-soft">
        {agent.model}
      </span>

      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted">
        {agent.description || 'Sin descripción'}
      </p>

      {/* Pie anclado al fondo (mt-auto) para que las acciones queden alineadas entre tarjetas, sin
          importar cuanto ocupe la descripcion. */}
      <div className="mt-auto pt-[18px]">
        <div className="flex items-center gap-3.5 border-t border-line-soft pt-3.5 text-[12.5px] text-muted-soft">
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            {toolsCount} {toolsCount === 1 ? 'herramienta' : 'herramientas'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-ok" aria-hidden="true" />
            Activo
          </span>
        </div>

        {/* Acciones de primera clase por agente: "Conversar" (ir a su Playground) junto a "Editar".
            Antes solo se llegaba al Playground desde el form o la pagina de uso; ahora es un clic
            directo desde la tarjeta. */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <Link
            to={`/agentes/${agent.id}`}
            aria-label={`Editar ${agent.name}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <Pencil className="h-[15px] w-[15px]" />
            Editar
          </Link>
          <Link
            to={playgroundPath(agent.id)}
            aria-label={`Conversar con ${agent.name}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-brasa-line bg-brasa-soft px-3 py-2 text-[13px] font-semibold text-brasa transition hover:bg-brasa hover:text-white"
          >
            <MessageCircle className="h-[15px] w-[15px]" />
            Conversar
          </Link>
        </div>
      </div>
    </div>
  );
}
