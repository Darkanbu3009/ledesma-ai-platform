import { type ReactNode, useState } from 'react';
import { AlertCircle, Bot, CheckCircle2, Loader2, Plug, Wrench } from 'lucide-react';
import { providerLabel, type ProviderId } from '../../lib/agents';
import type {
  AgentSpecDraft,
  AgentSpecTool,
  ConfiguratorValidation,
} from '../../lib/configurator';

/** Clases de badge por proveedor (literales para que el JIT de Tailwind las detecte). */
const PROVIDER_BADGE: Partial<Record<ProviderId, string>> = {
  anthropic: 'border-anthropic-line bg-anthropic-soft text-anthropic',
  openai: 'border-openai-line bg-openai-soft text-openai',
  'openai-compatible': 'border-oss-line bg-oss-soft text-oss',
};

const PROMPT_PREVIEW_CHARS = 220;

/**
 * Preview EN VIVO del agente que el Configurador va armando. Lee el AgentSpec parcial/completo y la
 * validacion del backend (no revalida en cliente). Cuando validation.ok es true habilita "Crear
 * agente" (modo asistente: el humano confirma); mientras sea false, lista que falta y el boton queda
 * deshabilitado.
 */
export function AgentPreview({
  spec,
  validation,
  creating,
  createError,
  onCreate,
}: {
  spec: AgentSpecDraft | null;
  validation: ConfiguratorValidation | null;
  creating: boolean;
  createError: string | null;
  onCreate: () => void;
}) {
  const ready = validation?.ok === true;
  const hasSpec = spec !== null && Object.keys(spec).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <Bot className="h-[18px] w-[18px] text-muted" />
        <h2 className="font-display text-sm font-bold text-ink">Vista previa del agente</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!hasSpec ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="max-w-xs text-sm text-muted">
              El agente va a aparecer aca a medida que converses. Empeza describiendo para que lo
              queres.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <SpecHeader spec={spec} />

            {spec.description && <PreviewBlock label="Descripcion">{spec.description}</PreviewBlock>}

            {spec.systemPrompt && (
              <PreviewBlock label="System prompt">
                <CollapsibleText text={spec.systemPrompt} />
              </PreviewBlock>
            )}

            <ParamsRow spec={spec} />

            {spec.baseUrl && (
              <PreviewBlock label="Base URL">
                <span className="break-all font-mono text-[13px]">{spec.baseUrl}</span>
              </PreviewBlock>
            )}

            <ToolsBlock tools={spec.tools ?? []} />
          </div>
        )}
      </div>

      <div className="border-t border-line px-5 py-4">
        <ValidationSummary validation={validation} hasSpec={hasSpec} />

        {createError && (
          <p className="mt-3 rounded-lg border border-brasa-line bg-brasa-soft px-3 py-2 text-sm text-brasa">
            {createError}
          </p>
        )}

        <button
          type="button"
          onClick={onCreate}
          disabled={!ready || creating}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted disabled:shadow-none"
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          {creating ? 'Creando agente...' : 'Crear agente'}
        </button>
      </div>
    </div>
  );
}

function SpecHeader({ spec }: { spec: AgentSpecDraft }) {
  const badge = spec.providerId ? PROVIDER_BADGE[spec.providerId] : undefined;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-bold text-ink">
          {spec.name || <span className="text-muted-soft">Sin nombre todavia</span>}
        </h3>
        {spec.providerId && (
          <span
            className={`flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-wide ${
              badge ?? 'border-brasa-line bg-brasa-soft text-brasa'
            }`}
          >
            {providerLabel(spec.providerId)}
          </span>
        )}
      </div>
      {spec.model && (
        <p className="mt-1 font-mono text-[13px] text-muted">{spec.model}</p>
      )}
    </div>
  );
}

function ParamsRow({ spec }: { spec: AgentSpecDraft }) {
  const params: { label: string; value: string }[] = [];
  if (spec.maxTokens !== undefined) params.push({ label: 'Max tokens', value: String(spec.maxTokens) });
  if (spec.temperature !== undefined && spec.temperature !== null) {
    params.push({ label: 'Temperature', value: String(spec.temperature) });
  }
  if (params.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {params.map((param) => (
        <span
          key={param.label}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-field px-2.5 py-1 text-xs text-muted"
        >
          {param.label}: <span className="font-mono text-ink">{param.value}</span>
        </span>
      ))}
    </div>
  );
}

function ToolsBlock({ tools }: { tools: AgentSpecTool[] }) {
  if (tools.length === 0) return null;
  return (
    <PreviewBlock label={`Herramientas (${tools.length})`}>
      <ul className="space-y-2">
        {tools.map((tool, i) => (
          <li
            key={`${tool.name}-${i}`}
            className="rounded-xl border border-line bg-field px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              {tool.kind === 'webhook' ? (
                <Plug className="h-3.5 w-3.5 flex-none text-muted" />
              ) : (
                <Wrench className="h-3.5 w-3.5 flex-none text-muted" />
              )}
              <span className="font-mono text-[13px] text-ink">{tool.name}</span>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {tool.kind === 'webhook' ? 'Webhook' : 'Nativa'}
              </span>
            </div>
            {tool.kind === 'webhook' && tool.description && (
              <p className="mt-1.5 text-xs text-muted">{tool.description}</p>
            )}
          </li>
        ))}
      </ul>
    </PreviewBlock>
  );
}

function ValidationSummary({
  validation,
  hasSpec,
}: {
  validation: ConfiguratorValidation | null;
  hasSpec: boolean;
}) {
  if (validation?.ok) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2.5 text-sm font-medium text-ok">
        <CheckCircle2 className="h-4 w-4 flex-none" />
        Listo para crear.
      </div>
    );
  }
  const errors = validation && !validation.ok ? validation.errors : [];
  if (!hasSpec && errors.length === 0) {
    return (
      <p className="text-sm text-muted">Segui conversando para completar el agente.</p>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-field px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <AlertCircle className="h-4 w-4 flex-none text-muted" />
        Falta para poder crear:
      </div>
      {errors.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-7 text-xs text-muted">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 pl-7 text-xs text-muted">
          Completa el nombre, el proveedor y el modelo del agente.
        </p>
      )}
    </div>
  );
}

function PreviewBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-soft">
        {label}
      </p>
      <div className="whitespace-pre-wrap text-sm text-ink-soft">{children}</div>
    </div>
  );
}

function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PROMPT_PREVIEW_CHARS;
  const shown = expanded || !isLong ? text : `${text.slice(0, PROMPT_PREVIEW_CHARS)}...`;
  return (
    <div>
      <p className="whitespace-pre-wrap">{shown}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-brasa hover:underline"
        >
          {expanded ? 'Ver menos' : 'Ver mas'}
        </button>
      )}
    </div>
  );
}
