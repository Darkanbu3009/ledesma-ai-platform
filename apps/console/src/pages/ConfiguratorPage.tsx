import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, Pencil, Sparkles, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { ApiError } from '../lib/api';
import { playgroundPath, providerLabel } from '../lib/agents';
import { cn } from '../lib/utils';
import {
  type AgentSpecDraft,
  type ConfiguratorMessage,
  type ConfiguratorMode,
  type ConfiguratorValidation,
  type CredentialSession,
} from '../lib/configurator';
import { sendConfiguratorMessage } from '../lib/configurator-client';
import { useCreateAgentFromSpec } from '../lib/mutations';
import { useMe } from '../lib/queries';
import { CredentialSessionForm } from '../components/configurator/CredentialSessionForm';
import { ConfiguratorChat } from '../components/configurator/ConfiguratorChat';
import { AgentPreview } from '../components/configurator/AgentPreview';
import { ChoosePlanCta } from '../components/upgrade/ChoosePlanCta';
import { tierAllowsAutonomy } from '../lib/plans';

/** Traduce el error de un turno del Configurador a un mensaje en espanol para el chat. */
function turnErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return i18n.t('configurador.errores.sesionExpirada');
    if (error.status === 403)
      return i18n.t('configurador.errores.autonomoRequierePlan');
    if (error.status === 404)
      return i18n.t('configurador.errores.credencialNoDisponible');
    if (error.status === 400) return i18n.t('configurador.errores.peticionRechazada');
  }
  return i18n.t('configurador.errores.sinContacto');
}

/** Traduce el error de la creacion del agente (POST /v1/agents). */
function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return i18n.t('configurador.errores.sesionExpirada');
    if (error.status === 400) return i18n.t('configurador.errores.agenteRechazado');
  }
  return i18n.t('configurador.errores.crearFallo');
}

type MobileTab = 'chat' | 'preview';

/**
 * Pantalla CONVERSACIONAL del Configurador: un chat donde el usuario describe el agente y, en
 * paralelo, un preview EN VIVO del AgentSpec que el backend va construyendo.
 *
 * Tiene dos modos:
 *  - ASISTENTE (default, para todos): cuando validation.ok es true el usuario confirma con el boton
 *    "Crear agente" (POST /v1/agents). Sin cambios respecto del comportamiento previo.
 *  - AUTONOMO (solo planes con autonomia, ver modulo central de planes): el backend crea el agente automaticamente apenas el spec
 *    pasa la validacion ESTRICTA, sin boton de confirmacion. El gate es server-side; aca solo se
 *    ofrece elegir el modo a quien lo tiene habilitado.
 *
 * Todo el estado (sesion de credencial, historial, spec) vive en React; nada se persiste en el cliente.
 */
export function ConfiguratorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createAgent = useCreateAgentFromSpec();
  const me = useMe();
  // Capacidad derivada del modulo central de planes (Pro y Business la tienen), no de un tier literal.
  const canUseAutonomous = tierAllowsAutonomy(me.data?.profile?.tier);

  const [session, setSession] = useState<CredentialSession | null>(null);
  const [editingSession, setEditingSession] = useState(true);

  const [mode, setMode] = useState<ConfiguratorMode>('assistant');

  const [messages, setMessages] = useState<ConfiguratorMessage[]>([]);
  const [spec, setSpec] = useState<AgentSpecDraft | null>(null);
  const [validation, setValidation] = useState<ConfiguratorValidation | null>(null);
  // Validacion ESTRICTA del ultimo turno autonomo: lista lo que falta para que el agente se cree solo.
  const [autonomousValidation, setAutonomousValidation] = useState<ConfiguratorValidation | null>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  const abortRef = useRef<AbortController | null>(null);
  // Si el usuario navega fuera con un turno en vuelo, lo cortamos.
  useEffect(() => () => abortRef.current?.abort(), []);

  // El modo autonomo solo se ENVIA si el usuario lo tiene habilitado (el gate real es server-side;
  // esto evita mandar un mode que el backend rechazaria con 403 si el tier cambio).
  const effectiveMode: ConfiguratorMode = canUseAutonomous ? mode : 'assistant';
  const autonomousActive = effectiveMode === 'autonomous';

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
      const response = await sendConfiguratorMessage(session, history, controller.signal, effectiveMode);
      // El historial enviable es transaccional: el par (user, assistant) solo se confirma cuando el
      // turno termina bien, asi el siguiente envio nunca produce dos user seguidos.
      setMessages([...history, { role: 'assistant', content: response.reply }]);
      // spec es null si el modelo no fue interpretable: en ese caso conservamos el ultimo preview
      // bueno (el endpoint es stateless y el proximo turno lo reconstruye desde el historial).
      if (response.spec !== null) {
        setSpec(response.spec);
        setValidation(response.validation);
      }

      // MODO AUTONOMO: el backend pudo haber creado el agente en este mismo turno.
      if (response.autonomous) {
        setAutonomousValidation(response.autonomous.validation);
        if (response.autonomous.created) {
          // Creado server-side: refrescamos la lista de agentes y vamos DIRECTO a conversar con el
          // agente recien creado (su Playground), igual que el modo asistente tras crear. El backend
          // devuelve el agente en autonomous.agent; si por algun motivo no llegara su id, caemos a la
          // lista como antes para no dejar al usuario sin destino.
          void qc.invalidateQueries({ queryKey: ['agents'] });
          setPending(null);
          setLoading(false);
          const createdId = response.autonomous.agent?.id;
          navigate(createdId ? playgroundPath(createdId) : '/agentes');
          return;
        }
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
    // Al confirmar y crear con exito vamos DIRECTO a conversar con el agente recien creado (su
    // Playground), sin pasar por la lista. La mutacion resuelve al AgentConfig creado (con su id).
    createAgent.mutate(spec, { onSuccess: (agent) => navigate(playgroundPath(agent.id)) });
  }

  const sessionLabel =
    session === null
      ? ''
      : session.mode === 'saved'
        ? session.label
        : t('configurador.pagina.sesionAlMomento', { provider: providerLabel(session.providerId) });
  const readyForPreview = validation?.ok === true;

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-3xl font-extrabold tracking-tight text-ink">
            <Sparkles className="h-7 w-7 text-brasa" />
            {t('configurador.pagina.titulo')}
          </h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {autonomousActive
              ? t('configurador.pagina.subtituloAutonomo')
              : t('configurador.pagina.subtituloAsistente')}
          </p>
        </div>
        <Link
          to="/agentes"
          className="inline-flex flex-none items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('configurador.pagina.volver')}
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
              {t('configurador.pagina.usando')} <span className="font-medium text-ink">{sessionLabel}</span>
              <span className="mx-2 text-muted-soft">·</span>
              <span className="font-mono text-ink">{session.model}</span>
            </p>
            <button
              type="button"
              onClick={() => setEditingSession(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:border-ink-soft hover:text-ink"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('configurador.pagina.cambiar')}
            </button>
          </div>

          {/* Selector de modo: solo para planes con autonomia. El resto ve la nota del gate + el CTA
              "Elegir plan" que lleva al catalogo self-service (el desbloqueo ya no pasa por
              upgrade_requests). El modo asistente sigue disponible para 'free': esto solo gatea el
              autonomo. */}
          {canUseAutonomous ? (
            <ModeSelector mode={mode} onChange={setMode} disabled={loading} />
          ) : (
            <div className="mt-4 flex flex-col items-start gap-3">
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-soft">
                <Lock className="h-3.5 w-3.5" />
                {t('configurador.pagina.gateAutonomo')}
              </p>
              <ChoosePlanCta className="items-start text-left" />
            </div>
          )}

          {/* Tabs en pantallas chicas: chat y preview se apilan detras de una pestana cada uno. */}
          <div className="mt-6 flex gap-2 lg:hidden" role="tablist" aria-label={t('configurador.pagina.tabsAriaLabel')}>
            <TabButton active={mobileTab === 'chat'} onClick={() => setMobileTab('chat')}>
              Chat
            </TabButton>
            <TabButton
              active={mobileTab === 'preview'}
              onClick={() => setMobileTab('preview')}
              dot={readyForPreview && mobileTab === 'chat'}
            >
              {t('configurador.pagina.tabVistaPrevia')}
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
              aria-label={t('configurador.preview.titulo')}
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
                autonomous={autonomousActive}
                autonomousValidation={autonomousValidation}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** Selector segmentado Asistente / Autonomo (solo visible para tier autonomous). */
function ModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: ConfiguratorMode;
  onChange: (mode: ConfiguratorMode) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4">
      <div
        className="inline-flex rounded-xl border border-line bg-field p-1"
        role="radiogroup"
        aria-label={t('configurador.pagina.modoAriaLabel')}
      >
        <ModeButton
          active={mode === 'assistant'}
          onClick={() => onChange('assistant')}
          disabled={disabled}
          icon={<Pencil className="h-3.5 w-3.5" />}
          title={t('configurador.pagina.modoAsistente')}
          hint={t('configurador.pagina.modoAsistenteHint')}
        />
        <ModeButton
          active={mode === 'autonomous'}
          onClick={() => onChange('autonomous')}
          disabled={disabled}
          icon={<Zap className="h-3.5 w-3.5" />}
          title={t('configurador.pagina.modoAutonomo')}
          hint={t('configurador.pagina.modoAutonomoHint')}
        />
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
      )}
    >
      {icon}
      <span>
        {title} <span className="font-normal text-muted-soft">({hint})</span>
      </span>
    </button>
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
