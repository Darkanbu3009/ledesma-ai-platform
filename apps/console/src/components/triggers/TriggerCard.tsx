import { KeyRound, Link2, Loader2, Pause, Play, RotateCcw, ShieldCheck, Trash2, Webhook } from 'lucide-react';
import { authModeLabel, type Trigger } from '../../lib/triggers';
import { formatRunAt } from '../../lib/schedule';
import { CopyButton } from '../ui/CopyButton';

/** Pill de estado: activo (verde) o pausado (neutra). */
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        'flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide',
        active ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-line-soft text-muted',
      ].join(' ')}
    >
      {active ? 'ACTIVO' : 'PAUSADO'}
    </span>
  );
}

/** Pill del modo de auth, con icono coherente (escudo = HMAC, enlace = token en URL). */
function AuthModeBadge({ mode }: { mode: Trigger['authMode'] }) {
  const Icon = mode === 'hmac' ? ShieldCheck : Link2;
  return (
    <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full border border-line bg-field px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted">
      <Icon className="h-3 w-3" />
      {authModeLabel(mode)}
    </span>
  );
}

/**
 * Tarjeta de un trigger en la lista. Muestra el agente que ejecuta, el modo de auth, el estado, la
 * ultima vez que disparo, la URL entrante (con copiar) y las acciones pausar/activar (PATCH isActive),
 * rotar el secreto (PATCH rotate) y borrar (DELETE). Espeja la estructura de ScheduledTaskCard.
 *
 * Para 'url_token' la URL de la lista es la BASE (sin el token): el token en claro solo se vio al
 * crear/rotar y el backend no lo re-expone, asi que se avisa que hay que rotar si se perdio.
 */
export function TriggerCard({
  trigger,
  agentName,
  credentialLabel,
  toggling,
  onToggle,
  onRotate,
  onDelete,
}: {
  trigger: Trigger;
  agentName: string | null;
  credentialLabel: string | null;
  toggling: boolean;
  onToggle: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const lastTriggered = formatRunAt(trigger.lastTriggeredAt) ?? 'Nunca';

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
            <Webhook className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-display text-[16px] font-bold text-ink">
                {agentName ?? 'Agente eliminado'}
              </h3>
              <StatusBadge active={trigger.isActive} />
              <AuthModeBadge mode={trigger.authMode} />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
              {credentialLabel && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 flex-none" />
                  <span className="truncate">{credentialLabel}</span>
                </span>
              )}
              <span>
                Ultimo disparo: <span className="text-muted">{lastTriggered}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            disabled={toggling}
            aria-label={trigger.isActive ? 'Pausar trigger' : 'Activar trigger'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-muted transition hover:border-brasa-line hover:text-brasa disabled:cursor-not-allowed disabled:opacity-60"
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : trigger.isActive ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{trigger.isActive ? 'Pausar' : 'Activar'}</span>
          </button>
          <button
            type="button"
            onClick={onRotate}
            aria-label="Rotar secreto"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-muted transition hover:border-brasa-line hover:text-brasa"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Rotar</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Eliminar trigger"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-[rgba(192,73,43,0.35)] hover:bg-[rgba(192,73,43,0.05)] hover:text-[#C0492B]"
          >
            <Trash2 className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>

      <div className="mt-4 border-t border-line-soft pt-3.5">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-field px-3 py-2 font-mono text-xs text-ink">
            {trigger.webhookUrl}
          </code>
          <CopyButton text={trigger.webhookUrl} />
        </div>
        <p className="mt-1.5 text-xs text-muted-soft">
          {trigger.authMode === 'hmac'
            ? 'Tu sistema hace POST aqui, firmado con el secreto HMAC.'
            : 'URL base. El token va en la URL y solo se mostro al crear o rotar: si lo perdiste, rota el token.'}
        </p>
      </div>
    </div>
  );
}
