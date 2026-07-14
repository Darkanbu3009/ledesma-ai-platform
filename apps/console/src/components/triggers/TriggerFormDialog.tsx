import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, ShieldCheck, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import i18n from '../../i18n';
import { providerLabel } from '../../lib/agents';
import { compatibleCredentials } from '../../lib/credentials';
import { useAgents, useCredentials } from '../../lib/queries';
import { useCreateTrigger } from '../../lib/mutations';
import {
  DEFAULT_AUTH_MODE,
  toTriggerApiInput,
  validateTriggerDraft,
  type CreateTriggerResponse,
  type TriggerAuthMode,
  type TriggerDraftErrors,
} from '../../lib/triggers';
import { Field, inputClass } from '../ui/Field';
import { useDialog } from '../ui/useDialog';

/** Traduce el error del backend a un mensaje en espanol. */
function backendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return i18n.t('triggers.form.errorSesion');
    if (error.status === 403) return i18n.t('triggers.form.errorPlan');
    if (error.status === 404) return i18n.t('triggers.form.errorNoExiste');
    if (error.status === 400) return i18n.t('triggers.form.errorRechazo');
  }
  return i18n.t('triggers.form.errorCrear');
}

/** Una opcion del selector de modo de auth (los textos son CLAVES de traduccion; se resuelven en el render). */
const AUTH_OPTIONS: Array<{
  value: TriggerAuthMode;
  titleKey: string;
  tagKey: string;
  tagTone: 'good' | 'warn';
  descriptionKey: string;
  icon: typeof ShieldCheck;
}> = [
  {
    value: 'hmac',
    titleKey: 'triggers.form.authHmacTitulo',
    tagKey: 'triggers.form.authHmacTag',
    tagTone: 'good',
    descriptionKey: 'triggers.form.authHmacDescripcion',
    icon: ShieldCheck,
  },
  {
    value: 'url_token',
    titleKey: 'triggers.form.authTokenTitulo',
    tagKey: 'triggers.form.authTokenTag',
    tagTone: 'warn',
    descriptionKey: 'triggers.form.authTokenDescripcion',
    icon: Link2,
  },
];

/**
 * Modal de alta de un trigger por evento (POST /v1/triggers). Se monta solo cuando esta abierto, asi
 * el estado arranca limpio en cada apertura. Elige agente, credencial (filtrada por el proveedor del
 * agente, como en /tareas), el mensaje base que ejecutara y el MODO DE AUTH (HMAC por defecto). Al
 * crear, `onCreated` recibe la respuesta con el secreto/URL para mostrarlo UNA sola vez.
 */
export function TriggerFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateTriggerResponse) => void;
}) {
  const { t } = useTranslation();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: credentials, isLoading: credentialsLoading } = useCredentials();
  const createTrigger = useCreateTrigger();

  const [agentId, setAgentId] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [message, setMessage] = useState('');
  const [authMode, setAuthMode] = useState<TriggerAuthMode>(DEFAULT_AUTH_MODE);
  const [errors, setErrors] = useState<TriggerDraftErrors>({});

  // Foco inicial en el primer campo, trampa de foco, Escape y retorno del foco al cerrar, via el hook
  // compartido (antes tenia foco+Escape+retorno pero NO trampa de foco).
  const agentRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useDialog({ onClose, initialFocus: agentRef });

  const selectedAgent = useMemo(
    () => agents?.find((agent) => agent.id === agentId) ?? null,
    [agents, agentId],
  );

  // Credenciales elegibles: solo las del proveedor del agente (el backend rechaza las de otro).
  const compatible = useMemo(() => {
    if (!selectedAgent || !credentials) return [];
    return compatibleCredentials(credentials, selectedAgent.providerId);
  }, [selectedAgent, credentials]);

  function handleAgentChange(nextAgentId: string) {
    setAgentId(nextAgentId);
    setErrors((prev) => ({ ...prev, agentId: undefined }));
    // Si la credencial elegida ya no es compatible con el nuevo agente, se limpia.
    const nextAgent = agents?.find((agent) => agent.id === nextAgentId) ?? null;
    if (credentialId && nextAgent && credentials) {
      const stillValid = compatibleCredentials(credentials, nextAgent.providerId).some(
        (cred) => cred.id === credentialId,
      );
      if (!stillValid) setCredentialId('');
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const draft = { agentId, credentialId, message, authMode };
    const validation = validateTriggerDraft(draft);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    createTrigger.mutate(toTriggerApiInput(draft), {
      onSuccess: (result) => {
        onCreated(result);
        onClose();
      },
    });
  }

  const noAgents = !agentsLoading && (agents?.length ?? 0) === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trigger-form-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-5">
          <div>
            <h2 id="trigger-form-title" className="font-display text-lg font-bold text-ink">
              {t('triggers.crearTrigger')}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('triggers.form.subtitulo')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('triggers.form.cerrarAria')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 overflow-y-auto px-6 py-6" noValidate>
          {createTrigger.isError && (
            <div
              role="alert"
              className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              {backendMessage(createTrigger.error)}
            </div>
          )}

          {noAgents ? (
            <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
              {t('triggers.form.sinAgentes')}{' '}
              <Link to="/agentes" className="font-medium text-brasa hover:underline">
                {t('triggers.form.sinAgentesLink')}
              </Link>
              .
            </div>
          ) : (
            <Field label={t('triggers.form.agenteLabel')} error={errors.agentId}>
              <select
                ref={agentRef}
                value={agentId}
                onChange={(e) => handleAgentChange(e.target.value)}
                className={inputClass}
                disabled={agentsLoading}
              >
                <option value="">
                  {agentsLoading ? t('triggers.form.cargandoAgentes') : t('triggers.form.eligeAgente')}
                </option>
                {agents?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {providerLabel(agent.providerId)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={t('triggers.form.credencialLabel')} error={errors.credentialId}>
            {(field) =>
              !selectedAgent ? (
                <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
                  {t('triggers.form.eligePrimeroAgente')}
                </div>
              ) : credentialsLoading ? (
                <div className="h-11 animate-pulse rounded-xl border border-line bg-field" />
              ) : compatible.length === 0 ? (
                <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
                  {t('triggers.form.sinCredenciales', { proveedor: providerLabel(selectedAgent.providerId) })}{' '}
                  <Link to="/credenciales" className="font-medium text-brasa hover:underline">
                    {t('triggers.form.sinCredencialesLink')}
                  </Link>
                  .
                </div>
              ) : (
                <select
                  {...field}
                  value={credentialId}
                  onChange={(e) => {
                    setCredentialId(e.target.value);
                    setErrors((prev) => ({ ...prev, credentialId: undefined }));
                  }}
                  className={inputClass}
                >
                  <option value="">{t('triggers.form.eligeCredencial')}</option>
                  {compatible.map((cred) => (
                    <option key={cred.id} value={cred.id}>
                      {cred.label}
                    </option>
                  ))}
                </select>
              )
            }
          </Field>

          <Field
            label={t('triggers.form.mensajeLabel')}
            error={errors.message}
            hint={t('triggers.form.mensajeHint')}
          >
            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setErrors((prev) => ({ ...prev, message: undefined }));
              }}
              className={`${inputClass} min-h-[96px] resize-y`}
              placeholder={t('triggers.form.mensajePlaceholder')}
              maxLength={10000}
            />
          </Field>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-ink">{t('triggers.form.modoAuthLegend')}</legend>
            <div className="space-y-2.5">
              {AUTH_OPTIONS.map((option) => {
                const selected = authMode === option.value;
                return (
                  <label
                    key={option.value}
                    className={[
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition',
                      selected
                        ? 'border-brasa-line bg-brasa-soft'
                        : 'border-line bg-field hover:border-ink-soft',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="authMode"
                      value={option.value}
                      checked={selected}
                      onChange={() => setAuthMode(option.value)}
                      className="mt-1 h-4 w-4 flex-none accent-brasa"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold text-ink">
                          <option.icon className="h-4 w-4 text-muted" />
                          {t(option.titleKey)}
                        </span>
                        <span
                          className={[
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                            option.tagTone === 'good'
                              ? 'bg-ok/10 text-ok'
                              : 'bg-[#FBF3D9] text-[#7A5600]',
                          ].join(' ')}
                        >
                          {t(option.tagKey)}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">
                        {t(option.descriptionKey)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.authMode && (
              <p role="alert" className="mt-1.5 text-sm text-brasa">
                {errors.authMode}
              </p>
            )}
          </fieldset>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
            >
              {t('triggers.comunes.cancelar')}
            </button>
            <button
              type="submit"
              disabled={createTrigger.isPending || noAgents}
              className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createTrigger.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {createTrigger.isPending ? t('triggers.form.creando') : t('triggers.crearTrigger')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
