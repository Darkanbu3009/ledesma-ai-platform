import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react';
import { providerLabel } from '../lib/agents';
import { readApiEnv } from '../lib/env';
import { useAgent } from '../lib/queries';
import {
  agentEndpoint,
  curlSnippet,
  mobileWebGuide,
  nodeSnippet,
  proxyServerSnippet,
  widgetDirectSnippet,
  widgetProxySnippet,
  type SnippetParams,
} from '../lib/snippets';
import { CopyButton } from '../components/ui/CopyButton';

const preClass =
  'overflow-x-auto rounded-xl border border-grafito-border bg-carbon p-4 font-mono text-xs leading-relaxed text-hueso';

const widgetThemeExample = `ledesma-agent {
  --la-accent: #2563eb; --la-radius: 16px; --la-height: 560px;
}`;

export function ConnectPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, isError, refetch } = useAgent(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="h-12 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
        <div className="h-28 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
        <div className="h-72 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mt-10 rounded-xl border border-grafito-border bg-grafito p-8 text-center">
          <p className="font-display text-lg text-hueso">No pudimos cargar el agente</p>
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
      </div>
    );
  }

  const { apiUrl } = readApiEnv(import.meta.env as Record<string, string | undefined>);
  const params: SnippetParams = { apiUrl, agentId: agent.id };
  const endpoint = agentEndpoint(params);

  const snippets = [
    { title: 'cURL', content: curlSnippet(params) },
    { title: 'Node.js', content: nodeSnippet(params) },
    { title: 'Movil y web', content: mobileWebGuide(params) },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-hueso">
            Conectar — {agent.name}
          </h1>
          <p className="mt-1 text-sm text-hueso-muted">
            {providerLabel(agent.providerId)} · <span className="font-mono">{agent.model}</span>
          </p>
        </div>
        <Link
          to={`/agentes/${agent.id}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
      </div>

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold text-hueso">Endpoint</h2>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-grafito-border bg-grafito p-5">
          <p className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm text-hueso">
            <span className="mr-2 font-semibold text-brasa">POST</span>
            <span className="select-all">{endpoint}</span>
          </p>
          <CopyButton text={endpoint} />
        </div>
      </section>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-brasa/40 bg-brasa/10 p-5">
        <ShieldAlert className="h-5 w-5 shrink-0 text-brasa" />
        <div className="text-sm">
          <p className="text-brasa">
            La API key del proveedor es de tu cliente y debe vivir en su servidor. Nunca la
            incluyas en una app movil o pagina publica.
          </p>
          <p className="mt-1 text-hueso-muted">
            Proximamente: tokens publicables por agente para integrar directo desde clientes.
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-hueso">Snippets</h2>
        <div className="mt-3 space-y-6">
          {snippets.map((snippet) => (
            <div key={snippet.title}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-hueso">{snippet.title}</h3>
                <CopyButton text={snippet.content} />
              </div>
              <pre className={preClass}>{snippet.content}</pre>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-hueso">Widget embebible</h2>
        <p className="mt-3 text-sm text-hueso-muted">
          Incrusta tu agente en cualquier sitio con una etiqueta HTML.
        </p>

        <div className="mt-4 space-y-8">
          <div>
            <h3 className="text-sm font-medium text-hueso">Modo proxy (produccion)</h3>
            <p className="mt-1 text-sm text-hueso-muted">
              El widget apunta a TU backend; tu backend agrega la key (variable de entorno) y
              reenvia a la plataforma. La key nunca llega al navegador.
            </p>
            <div className="mt-3 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-hueso-muted">HTML de tu pagina</p>
                  <CopyButton text={widgetProxySnippet(params)} />
                </div>
                <pre className={preClass}>{widgetProxySnippet(params)}</pre>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-hueso-muted">Servidor proxy de ejemplo (Node)</p>
                  <CopyButton text={proxyServerSnippet(params)} />
                </div>
                <pre className={preClass}>{proxyServerSnippet(params)}</pre>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-hueso">Modo directo (solo pruebas)</h3>
            <div className="mt-2 flex items-start gap-3 rounded-xl border border-brasa/40 bg-brasa/10 p-4">
              <ShieldAlert className="h-5 w-5 shrink-0 text-brasa" />
              <p className="text-sm text-brasa">
                La key queda visible en el HTML. Usalo solo en pruebas o herramientas internas;
                nunca en una pagina publica.
              </p>
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs text-hueso-muted">HTML</p>
                <CopyButton text={widgetDirectSnippet(params)} />
              </div>
              <pre className={preClass}>{widgetDirectSnippet(params)}</pre>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-hueso">Personalizacion</h3>
            <p className="mt-1 text-sm text-hueso-muted">
              El tema se ajusta desde tu pagina con CSS custom properties (
              <span className="font-mono">--la-accent</span>,{' '}
              <span className="font-mono">--la-bg</span>,{' '}
              <span className="font-mono">--la-radius</span>,{' '}
              <span className="font-mono">--la-height</span>, ...):
            </p>
            <pre className={`${preClass} mt-3`}>{widgetThemeExample}</pre>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-hueso">Como funciona</h2>
        <p className="mt-3 text-sm text-hueso-muted">
          La configuracion del agente (modelo, system prompt, parametros) vive en la plataforma. Si
          cambias el cerebro desde la consola, todas tus integraciones lo usan de inmediato sin
          cambiar codigo.
        </p>
      </section>
    </div>
  );
}
