import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { providerLabel } from '../../lib/agents';
import { compatibleCredentials } from '../../lib/credentials';
import { useAgents, useCredentials } from '../../lib/queries';
import { useCreateScheduledTask } from '../../lib/mutations';
import {
  toScheduledTaskApiInput,
  validateScheduledTaskDraft,
  type ScheduledTaskDraftErrors,
} from '../../lib/scheduled-tasks';
import { scheduleToCron, DEFAULT_SCHEDULE } from '../../lib/schedule';
import { Field, inputClass } from '../ui/Field';
import { useDialog } from '../ui/useDialog';
import { ScheduleSelector, type ScheduleSelection } from './ScheduleSelector';

/** Traduce el error del backend a la CLAVE i18n del mensaje; se resuelve con t() en el render. */
function backendMessageKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'tareas.errores.sesionExpirada';
    if (error.status === 403) return 'tareas.errores.requierePlan';
    if (error.status === 404) return 'tareas.errores.noExisten';
    if (error.status === 400) return 'tareas.errores.rechazada';
  }
  return 'tareas.errores.generico';
}

/**
 * Modal de alta de una tarea programada (POST /v1/scheduled-tasks). Se monta solo cuando esta abierto,
 * asi el estado arranca limpio en cada apertura. Elige agente, credencial (filtrada por el proveedor
 * del agente, como en el Playground), el mensaje que ejecutara y el horario (selector amigable o cron
 * avanzado). Valida en cliente antes de enviar y muestra el error del backend si responde mal.
 */
export function ScheduledTaskFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: credentials, isLoading: credentialsLoading } = useCredentials();
  const createTask = useCreateScheduledTask();

  const [agentId, setAgentId] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState<ScheduleSelection>({
    cronExpression: scheduleToCron(DEFAULT_SCHEDULE),
    valid: true,
  });
  const [errors, setErrors] = useState<ScheduledTaskDraftErrors>({});

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

  function handleScheduleChange(selection: ScheduleSelection) {
    setSchedule(selection);
    setErrors((prev) => ({ ...prev, cronExpression: undefined }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const draft = { agentId, credentialId, message, cronExpression: schedule.cronExpression };
    const validation = validateScheduledTaskDraft(draft);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    createTask.mutate(toScheduledTaskApiInput(draft), {
      onSuccess: () => {
        onCreated();
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
        aria-labelledby="scheduled-task-form-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-5">
          <div>
            <h2 id="scheduled-task-form-title" className="font-display text-lg font-bold text-ink">
              {t('tareas.programarTarea')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('tareas.form.subtitulo')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('tareas.form.cerrar')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 overflow-y-auto px-6 py-6" noValidate>
          {createTask.isError && (
            <div
              role="alert"
              className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              {t(backendMessageKey(createTask.error))}
            </div>
          )}

          {noAgents ? (
            <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
              <Trans
                i18nKey="tareas.form.sinAgentes"
                components={{
                  enlace: <Link to="/agentes" className="font-medium text-brasa hover:underline" />,
                }}
              />
            </div>
          ) : (
            <Field label={t('tareas.form.agenteLabel')} error={errors.agentId}>
              <select
                ref={agentRef}
                value={agentId}
                onChange={(e) => handleAgentChange(e.target.value)}
                className={inputClass}
                disabled={agentsLoading}
              >
                <option value="">
                  {agentsLoading ? t('tareas.form.cargandoAgentes') : t('tareas.form.eligeAgente')}
                </option>
                {agents?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {providerLabel(agent.providerId)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={t('tareas.form.credencialLabel')} error={errors.credentialId}>
            {(field) =>
              !selectedAgent ? (
                <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
                  {t('tareas.form.eligePrimeroAgente')}
                </div>
              ) : credentialsLoading ? (
                <div className="h-11 animate-pulse rounded-xl border border-line bg-field" />
              ) : compatible.length === 0 ? (
                <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
                  <Trans
                    i18nKey="tareas.form.sinCredenciales"
                    values={{ proveedor: providerLabel(selectedAgent.providerId) }}
                    components={{
                      enlace: (
                        <Link to="/credenciales" className="font-medium text-brasa hover:underline" />
                      ),
                    }}
                  />
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
                  <option value="">{t('tareas.form.eligeCredencial')}</option>
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
            label={t('tareas.form.mensajeLabel')}
            error={errors.message}
            hint={t('tareas.form.mensajeHint')}
          >
            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setErrors((prev) => ({ ...prev, message: undefined }));
              }}
              className={`${inputClass} min-h-[96px] resize-y`}
              placeholder={t('tareas.form.mensajePlaceholder')}
              maxLength={10000}
            />
          </Field>

          <div>
            <ScheduleSelector onChange={handleScheduleChange} />
            {errors.cronExpression && (
              <p role="alert" className="mt-1.5 text-sm text-brasa">
                {errors.cronExpression}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
            >
              {t('tareas.cancelar')}
            </button>
            <button
              type="submit"
              disabled={createTask.isPending || noAgents}
              className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createTask.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {createTask.isPending ? t('tareas.form.programando') : t('tareas.programarTarea')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
