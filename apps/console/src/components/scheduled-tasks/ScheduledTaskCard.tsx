import { useTranslation } from 'react-i18next';
import { CalendarClock, Clock, KeyRound, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import type { ScheduledTask } from '../../lib/scheduled-tasks';
import { describeCron, formatRunAt } from '../../lib/schedule';
import { focusRing } from '../../lib/utils';

/** Pill de estado: activa (verde) o pausada (neutra). */
function StatusBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={[
        'flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide',
        active ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-line-soft text-muted',
      ].join(' ')}
    >
      {active ? t('tareas.card.estadoActiva') : t('tareas.card.estadoPausada')}
    </span>
  );
}

/**
 * Tarjeta de una tarea programada en la lista. Muestra el agente, el horario en lenguaje legible, el
 * estado, el proximo y el ultimo run, y las acciones pausar/activar (PATCH is_active) y borrar. Espeja
 * la estructura de CredentialCard. El nombre del agente y de la credencial los resuelve la pantalla.
 */
export function ScheduledTaskCard({
  task,
  agentName,
  credentialLabel,
  toggling,
  onToggle,
  onDelete,
}: {
  task: ScheduledTask;
  agentName: string | null;
  credentialLabel: string | null;
  toggling: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const human = describeCron(task.cronExpression);
  const nextRun = task.isActive ? (formatRunAt(task.nextRunAt) ?? '—') : t('tareas.card.enPausa');
  const lastRun = formatRunAt(task.lastRunAt) ?? t('tareas.card.nunca');

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-[16px] font-bold text-ink">
              {agentName ?? t('tareas.card.agenteEliminado')}
            </h3>
            <StatusBadge active={task.isActive} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 flex-none" />
              {human ? (
                <span>{human}</span>
              ) : (
                <span className="font-mono">{task.cronExpression}</span>
              )}
              <span className="text-muted-soft">· UTC</span>
            </span>
            {credentialLabel && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 flex-none" />
                <span className="truncate">{credentialLabel}</span>
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-muted-soft">
            <span>
              {t('tareas.card.proximo')} <span className="text-muted">{nextRun}</span>
            </span>
            <span>
              {t('tareas.card.ultimo')} <span className="text-muted">{lastRun}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={toggling}
          aria-label={task.isActive ? t('tareas.card.pausarTarea') : t('tareas.card.activarTarea')}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-muted transition hover:border-brasa-line hover:text-brasa disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
        >
          {toggling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : task.isActive ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {task.isActive ? t('tareas.card.pausar') : t('tareas.card.activar')}
          </span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('tareas.eliminar.titulo')}
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-[rgba(192,73,43,0.35)] hover:bg-[rgba(192,73,43,0.05)] hover:text-[#C0492B] ${focusRing}`}
        >
          <Trash2 className="h-[17px] w-[17px]" />
        </button>
      </div>
    </div>
  );
}
