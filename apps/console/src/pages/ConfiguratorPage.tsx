import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Sparkles } from 'lucide-react';
import { ApiError } from '../lib/api';
import { providerLabel } from '../lib/agents';
import { cn } from '../lib/utils';
import {
  type AgentSpecDraft,
  type ConfiguratorMessage,
  type ConfiguratorValidation,
  type CredentialSession,
} from '../lib/configurator';
import { sendConfiguratorMessage } from '../lib/configurator-client';
import { useCreateAgentFromSpec } from '../lib/mutations';
import { CredentialSessionForm } from '../components/configurator/CredentialSessionForm';
import { ConfiguratorChat } from '../components/configurator/ConfiguratorChat';
import { AgentPreview } from '../components/configurator/AgentPreview';

/** Traduce el error de un turno del Configurador a un mensaje en espanol para el chat. */
function turnErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesion expiro. Volve a iniciar sesion.';
    if (error.status === 404)
      return 'La credencial guardada no esta disponible. Elegi otra o pega una al momento.';
    if (error.status === 400) return 'El Configurador rechazo la peticion. Revisa la credencial y el modelo.';
  }
  return 'No pudimos contactar al Configurador. Intenta de nuevo.';
}

/** Traduce el error de la creacion del agente (POST /v1/agents). */
function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesion expiro. Volve a iniciar sesion.';
    if (error.status === 400) return 'El backend rechazo el agente. Revisa el preview.';
  }
  return 'No pudimos crear el agente. Intenta de nuevo.';
}

type MobileTab = 'chat' | 'preview';

/**
 * Pantalla CONVERSACIONAL del Configurador: un chat donde el usuario describe el agente y, en
 * paralelo, un preview EN VIVO del AgentSpec que el backend va construyendo. Cuando validation.ok es
 * true, el usuario confirma y se crea el agente via POST /v1/agents (modo asistente). Todo el estado
 * (sesion de credencial, historial, spec) vive en React; nada se persiste en el cliente.
 */
export function ConfiguratorPage() {
  const navigate = useNavigate();
  const createAgent = useCreateAgentFromSpec();

  const [session, setSession] = useState<CredentialSession | null>(null);
  const [editingSession, setEditingSession] = useState(true);

  const [messages, setMessages] = useState<ConfiguratorMessage[]>([]);
  const [spec, setSpec] = useState<AgentSpecDraft | null>(null);
  const [validation, setValidation] = useState<ConfiguratorValidation | null>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  const abortRef = useRef<AbortController | null>(null);
  // Si el usuario navega fuera con un turno en vuelo, lo cortamos.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    if (!session || loading) return;
    const trimmed = text.trim();
    if (trimmed === '') return;

    const history: ConfiguratorMessage[] = [...messages, { role: 'user', content: trimmed }];
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(trimmed);
    setChatError(null);
    setLoading(true);

    try {
      const response = await sendConfiguratorMessage(session, history, controller.signal);
      // El historial enviable es transaccional: el par (user, assistant) solo se confirma cuando el
      // turno termina bien, asi el siguiente envio nunca produce dos user seguidos.
      setMessages([...history, { role: 'assistant', content: response.reply }]);
      // spec es null si el modelo no fue interpretable: en ese caso conservamos el ultimo preview
      // bueno (el endpoint es stateless y el proximo turno lo reconstruye desde el historial).
      if (response.spec !== null) {
        setSpec(response.spec);
        setValidation(response.validation);
      }
      setPending(null);
      setLoading(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      setChatError(turnErrorMessage(error));
      setLoading(false);
      // pending se mantiene: el mensaje del usuario sigue visible junto al error y el reintento.
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function handleReady(next: CredentialSession) {
    setSession(next);
    setEditingSession(false);
  }

  function handleCreate() {
    if (!spec || validation?.ok !== true) return;
    createAgent.mutate(spec, { onSuccess: () => navigate('/agentes') });
  }

  const sessionLabel =
    session === null
      ? ''
      : session.mode === 'saved'
        ? session.label
        : `${providerLabel(session.providerId)} (al momento)`;
  const readyForPreview = validation?.ok === true;

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-3xl font-extrabold tracking-tight text-ink">
            <Sparkles className="h-7 w-7 text-brasa" />
            Configurador
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Describi el agente que queres y armalo conversando. Vos confirmas antes de crearlo.
          </p>
        </div>
        <Link
          to="/agentes"
          className="inline-flex flex-none items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
      </div>

      {editingSession || session === null ? (
        <div className="mt-8 max-w-xl">
          <CredentialSessionForm
            initial={session}
            onReady={handleReady}
            onCancel={session !== null ? () => setEditingSession(false) : undefined}
          />
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
            <p className="text-sm text-muted">
              Usando: <span className="font-medium text-ink">{sessionLabel}</span>
              <span className="mx-2 text-muted-soft">·</span>
              <span className="font-mono text-ink">{session.model}</span>
            </p>
            <button
              type="button"
              onClick={() => setEditingSession(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:border-ink-soft hover:text-ink"
            >
              <Pencil className="h-3.5 w-3.5" />
              Cambiar
            </button>
          </div>

          {/* Tabs en pantallas chicas: chat y preview se apilan detras de una pestana cada uno. */}
          <div className="mt-6 flex gap-2 lg:hidden" role="tablist" aria-label="Vistas del configurador">
            <TabButton active={mobileTab === 'chat'} onClick={() => setMobileTab('chat')}>
              Chat
            </TabButton>
            <TabButton
              active={mobileTab === 'preview'}
              onClick={() => setMobileTab('preview')}
              dot={readyForPreview && mobileTab === 'chat'}
            >
              Vista previa
            </TabButton>
          </div>

          <div className="mt-4 grid gap-6 lg:mt-6 lg:grid-cols-2">
            <section
              aria-label="Chat"
              className={cn(
                'h-[34rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:flex lg:h-[38rem]',
                mobileTab === 'chat' ? 'flex' : 'hidden',
              )}
            >
              <ConfiguratorChat
                messages={messages}
                pending={pending}
                loading={loading}
                errorText={chatError}
                onSend={(text) => void send(text)}
                onRetry={() => {
                  if (pending !== null) void send(pending);
                }}
              />
            </section>

            <section
              aria-label="Vista previa del agente"
              className={cn(
                'h-[34rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:flex lg:h-[38rem]',
                mobileTab === 'preview' ? 'flex' : 'hidden',
              )}
            >
              <AgentPreview
                spec={spec}
                validation={validation}
                creating={createAgent.isPending}
                createError={createAgent.isError ? createErrorMessage(createAgent.error) : null}
                onCreate={handleCreate}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition',
        active
          ? 'border-brasa-line bg-brasa-soft text-brasa'
          : 'border-line bg-surface text-muted hover:border-ink-soft hover:text-ink',
      )}
    >
      {children}
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-brasa" aria-hidden="true" />}
    </button>
  );
}
