import { useTranslation } from 'react-i18next';
import { AlertCircle, Bot, ChefHat, Clock, Loader2, MessageSquare } from 'lucide-react';
import { formatRunAt } from '../../lib/schedule';
import { jobStatusLabel, jobTypeLabel, type JobActivity, type JobStatus } from '../../lib/jobs';

/**
 * Pill de estado de una ejecucion. Colores por estado: completada = verde (ok), fallida = rojo
 * (destructivo, mismo tono que las acciones de borrado), pendiente/en curso = neutro. "En curso" ademas
 * lleva un spinner sutil para comunicar que sigue corriendo.
 */
function StatusBadge({ status }: { status: JobStatus }) {
  const tone: Record<JobStatus, string> = {
    completed: 'border-ok/30 bg-ok/10 text-ok',
    failed: 'border-[rgba(192,73,43,0.3)] bg-[rgba(192,73,43,0.08)] text-[#C0492B]',
    pending: 'border-line bg-line-soft text-muted',
    running: 'border-line bg-line-soft text-muted',
  };
  return (
    <span
      className={[
        'inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone[status],
      ].join(' ')}
    >
      {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {jobStatusLabel(status)}
    </span>
  );
}

/**
 * Tarjeta de UNA ejecucion en el historial (/actividad). Muestra el agente que corrio, el tipo (receta o
 * mensaje), cuando se encolo y, si termino, cuando finalizo, los intentos y —si fallo— el error truncado.
 * Espeja la estructura de RecipeCard / ScheduledTaskCard. El nombre del agente lo resuelve la pantalla
 * (useAgents); null = agente ya eliminado.
 */
export function JobActivityCard({ job, agentName }: { job: JobActivity; agentName: string | null }) {
  const { t } = useTranslation();
  const TypeIcon = job.type === 'recipe' ? ChefHat : MessageSquare;
  const created = formatRunAt(job.createdAt) ?? '—';
  const finished = formatRunAt(job.finishedAt);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
          <TypeIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="inline-flex min-w-0 items-center gap-1.5 truncate font-display text-[15px] font-bold text-ink">
              <Bot className="h-4 w-4 flex-none text-muted" />
              <span className="truncate">{agentName ?? t('actividad.card.agenteEliminado')}</span>
            </h3>
            <span className="flex-none rounded-full border border-line bg-line-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {jobTypeLabel(job.type)}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 flex-none" />
              {created}
            </span>
            {finished && (
              <span className="text-muted-soft">{t('actividad.card.fin', { fecha: finished })}</span>
            )}
            <span className="text-muted-soft">
              {t('actividad.card.intentos', { count: job.attempts })}
            </span>
          </div>

          {job.status === 'failed' && job.lastError && (
            <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-[rgba(192,73,43,0.25)] bg-[rgba(192,73,43,0.05)] px-2.5 py-1.5 text-[12px] text-[#C0492B]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span className="whitespace-pre-wrap break-words">{job.lastError}</span>
            </div>
          )}
        </div>
      </div>

      <StatusBadge status={job.status} />
    </div>
  );
}
