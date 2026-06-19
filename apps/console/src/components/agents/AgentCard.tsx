import { ArrowRight, Bot, Wrench } from 'lucide-react';
import type { AgentConfig, ProviderId } from '../../lib/agents';
import { providerLabel } from '../../lib/agents';

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
      className={`group relative h-full overflow-hidden rounded-2xl border border-line bg-surface p-[22px] shadow-card transition duration-200 hover:-translate-y-[3px] hover:shadow-card-hover ${accent.hoverBorder}`}
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

      <p className="mb-[18px] mt-3 line-clamp-2 text-sm leading-relaxed text-muted">
        {agent.description || 'Sin descripción'}
      </p>

      <div className="flex items-center justify-between border-t border-line-soft pt-3.5">
        <div className="flex items-center gap-3.5 text-[12.5px] text-muted-soft">
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            {toolsCount} {toolsCount === 1 ? 'herramienta' : 'herramientas'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-ok" aria-hidden="true" />
            Activo
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-brasa opacity-0 transition group-hover:opacity-100">
          Editar
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}
