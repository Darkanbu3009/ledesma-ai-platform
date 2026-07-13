import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowLeft, Eye, EyeOff, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { providerLabel } from '../lib/agents';
import { readApiEnv } from '../lib/env';
import { useAgent } from '../lib/queries';
import { useRotateWebhookSecret } from '../lib/mutations';
import {
  agentEndpoint,
  curlSnippet,
  mobileWebGuide,
  nodeSnippet,
  tokenServerSnippet,
  webhookVerifySnippet,
  widgetDirectSnippet,
  widgetReactSnippet,
  widgetTokenSnippet,
  type SnippetParams,
} from '../lib/snippets';
import { CopyButton } from '../components/ui/CopyButton';
import { RotateSecretDialog } from '../components/agents/RotateSecretDialog';

const preClass =
  'overflow-x-auto rounded-xl border border-grafito-border bg-grafito p-4 font-mono text-xs leading-relaxed text-hueso';

const widgetThemeExample = `ledesma-agent {
  --la-accent: #2563eb; --la-radius: 16px; --la-height: 560px;
}`;

const webhookHeadersExample = `x-ledesma-timestamp: 1718000000
x-ledesma-signature: v1=<hmac-sha256 hex de "{timestamp}.{body}">`;

export function ConnectPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, isError, refetch } = useAgent(id);
  const [showSecret, setShowSecret] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotatedNotice, setRotatedNotice] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);
  const rotateSecret = useRotateWebhookSecret(id ?? '');

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const handleRotate = () => {
    rotateSecret.mutate(undefined, {
      onSuccess: () => {
        setRotateOpen(false);
        // Revelamos el secreto nuevo de inmediato para que se pueda copiar sin otro click.
        setShowSecret(true);
        setRotatedNotice(true);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setRotatedNotice(false), 6000);
      },
    });
  };

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
          <p className="font-display text-lg text-hueso">{t('auth.conectar.errorCargaAgente')}</p>
          <p className="mt-2 text-sm text-hueso-muted">{t('auth.comun.revisaConexion')}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className="h-4 w-4" />
            {t('auth.comun.reintentar')}
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
    { title: t('auth.conectar.movilYWeb'), content: mobileWebGuide(params) },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-hueso">
            {t('auth.conectar.titulo', { nombre: agent.name })}
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
          {t('auth.conectar.volver')}
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
          <p className="text-brasa">{t('auth.conectar.avisoKey')}</p>
          <p className="mt-1 text-hueso-muted">{t('auth.conectar.avisoTokens')}</p>
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

      {agent.webhookSecret ? (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold text-hueso">
            {t('auth.conectar.webhooks.titulo')}
          </h2>
          <p className="mt-3 text-sm text-hueso-muted">
            {t('auth.conectar.webhooks.descripcion')}
          </p>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-grafito-border bg-grafito p-5">
            <p className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm text-hueso">
              {showSecret ? (
                <span className="select-all">{agent.webhookSecret}</span>
              ) : (
                'whsec_••••••••'
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? t('auth.conectar.webhooks.ocultarSecreto') : t('auth.conectar.webhooks.mostrarSecreto')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showSecret ? t('auth.conectar.webhooks.ocultar') : t('auth.conectar.webhooks.revelar')}
              </button>
              <CopyButton text={agent.webhookSecret} />
              <button
                type="button"
                onClick={() => setRotateOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-brasa transition hover:border-brasa hover:text-brasa-hover"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('auth.conectar.webhooks.rotarSecreto')}
              </button>
            </div>
          </div>

          {rotatedNotice ? (
            <p role="status" className="mt-2 text-sm text-brasa">
              {t('auth.conectar.webhooks.secretoRotado')}
            </p>
          ) : null}

          <div className="mt-4">
            <p className="text-xs text-hueso-muted">{t('auth.conectar.webhooks.headersEnviados')}</p>
            <pre className={`${preClass} mt-2`}>{webhookHeadersExample}</pre>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-hueso-muted">{t('auth.conectar.webhooks.verificacionServidor')}</p>
              <CopyButton text={webhookVerifySnippet()} />
            </div>
            <pre className={preClass}>{webhookVerifySnippet()}</pre>
            <p className="mt-2 text-sm text-hueso-muted">
              {t('auth.conectar.webhooks.guardaSecreto')}
            </p>
          </div>

          <RotateSecretDialog
            open={rotateOpen}
            busy={rotateSecret.isPending}
            onConfirm={handleRotate}
            onCancel={() => setRotateOpen(false)}
          />
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-hueso">{t('auth.conectar.widget.titulo')}</h2>
        <p className="mt-3 text-sm text-hueso-muted">
          {t('auth.conectar.widget.descripcion')}
        </p>

        <div className="mt-4 space-y-8">
          <div>
            <h3 className="text-sm font-medium text-hueso">{t('auth.conectar.widget.modoTokenTitulo')}</h3>
            <p className="mt-1 text-sm text-hueso-muted">
              {t('auth.conectar.widget.modoTokenCuerpo')}
            </p>
            <div className="mt-3 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-hueso-muted">{t('auth.conectar.widget.htmlPagina')}</p>
                  <CopyButton text={widgetTokenSnippet(params)} />
                </div>
                <pre className={preClass}>{widgetTokenSnippet(params)}</pre>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-hueso-muted">{t('auth.conectar.widget.servidorTokens')}</p>
                  <CopyButton text={tokenServerSnippet(params)} />
                </div>
                <pre className={preClass}>{tokenServerSnippet(params)}</pre>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-hueso">{t('auth.conectar.widget.modoDirectoTitulo')}</h3>
            <div className="mt-2 flex items-start gap-3 rounded-xl border border-brasa/40 bg-brasa/10 p-4">
              <ShieldAlert className="h-5 w-5 shrink-0 text-brasa" />
              <p className="text-sm text-brasa">
                {t('auth.conectar.widget.modoDirectoAviso')}
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
            <h3 className="text-sm font-medium text-hueso">{t('auth.conectar.widget.usoReactTitulo')}</h3>
            <p className="mt-1 text-sm text-hueso-muted">
              <Trans
                i18nKey="auth.conectar.widget.usoReactCuerpo"
                components={{ paquete: <span className="font-mono" /> }}
              />
            </p>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs text-hueso-muted">{t('auth.conectar.widget.componenteEjemplo')}</p>
                <CopyButton text={widgetReactSnippet(params)} />
              </div>
              <pre className={preClass}>{widgetReactSnippet(params)}</pre>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-hueso">{t('auth.conectar.widget.personalizacionTitulo')}</h3>
            <p className="mt-1 text-sm text-hueso-muted">
              <Trans
                i18nKey="auth.conectar.widget.personalizacionCuerpo"
                components={{ codigo: <span className="font-mono" /> }}
              />
            </p>
            <pre className={`${preClass} mt-3`}>{widgetThemeExample}</pre>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-hueso">{t('auth.conectar.comoFuncionaTitulo')}</h2>
        <p className="mt-3 text-sm text-hueso-muted">
          {t('auth.conectar.comoFuncionaCuerpo')}
        </p>
      </section>
    </div>
  );
}
