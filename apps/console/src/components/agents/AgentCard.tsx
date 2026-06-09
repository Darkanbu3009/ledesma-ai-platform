import type { AgentConfig } from '../../lib/agents';
import { providerLabel } from '../../lib/agents';

export function AgentCard({ agent }: { agent: AgentConfig }) {
  return (
    <div className="rounded-xl border border-grafito-border bg-grafito p-5 transition hover:border-hueso-muted/40">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-hueso">{agent.name}</h3>
        <span className="shrink-0 rounded-full border border-grafito-border bg-carbon px-2.5 py-0.5 text-xs text-hueso-muted">
          {providerLabel(agent.providerId)}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-hueso-muted">{agent.model}</p>
      <p className="mt-3 line-clamp-2 text-sm text-hueso-muted">{agent.description || 'Sin descripcion'}</p>
      <p className="mt-4 text-xs text-hueso-muted">
        {agent.tools.length} {agent.tools.length === 1 ? 'herramienta' : 'herramientas'}
      </p>
    </div>
  );
}
