import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { useAgents, useJobs } from '../lib/queries';
import { playgroundPath } from '../lib/agents';
import { JOB_STATUS_FILTERS, type JobStatusFilter } from '../lib/jobs';
import { ActivityGhostTable } from '../components/activity/ActivityGhostTable';
import { JobActivityCard } from '../components/activity/JobActivityCard';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';

/** Fila de chips para filtrar el historial por estado. */
function StatusFilterBar({
  value,
  onChange,
}: {
  value: JobStatusFilter;
  onChange: (next: JobStatusFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {JOB_STATUS_FILTERS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={[
              'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
              active
                ? 'border-brasa-line bg-brasa-soft text-brasa'
                : 'border-line bg-surface text-muted hover:border-ink-soft hover:text-ink',
            ].join(' ')}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Estado vacio. Sin filtro activo muestra la tabla fantasma con velo y CTA (ActivityGhostTable);
 * con filtro activo conserva el estado centrado que invita a quitar el filtro.
 */
function ActivityEmptyState({ filtered, ctaTo }: { filtered: boolean; ctaTo: string }) {
  const { t } = useTranslation();
  if (!filtered) {
    return <ActivityGhostTable ctaTo={ctaTo} />;
  }
  return (
    <EmptyState
      variant="centered"
      media={
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
          <Activity className="h-6 w-6" />
        </span>
      }
      title={t('actividad.vacioFiltrado.titulo')}
      description={t('actividad.vacioFiltrado.descripcion')}
    />
  );
}

/**
 * Pagina ACTIVIDAD (/actividad): historial de ejecuciones autonomas (jobs) del usuario, SOLO LECTURA.
 * Muestra que agente corrio, el tipo (receta/mensaje), el estado, las fechas, los intentos y el error si
 * fallo. Filtrable por estado y paginada con "cargar mas". Auto-refresh prudente (lo maneja useJobs: solo
 * reconsulta si hay jobs en vuelo). SIN gate por tier: ver el historial propio es para todos los planes.
 */
export function ActivityPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<JobStatusFilter>('all');

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useJobs(status);
  const { data: agents, isLoading: agentsLoading } = useAgents();

  const agentsById = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const jobs = useMemo(() => data?.pages.flatMap((page) => page.jobs) ?? [], [data]);
  // Destino del CTA del estado vacio: el Playground pide un agente existente, asi que va al del
  // primer agente si ya hay alguno (useAgents ya esta cargado arriba) y a /agentes si no.
  const [firstAgent] = agents ?? [];
  const emptyCtaTo = firstAgent ? playgroundPath(firstAgent.id) : '/agentes';
  const hasJobs = jobs.length > 0;
  const listLoading = isLoading || agentsLoading;
  // Refetch silencioso en curso (auto-refresh o cambio de filtro) con datos ya visibles.
  const refreshing = isFetching && !isLoading && !isFetchingNextPage;

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <PageHeader
        title={t('actividad.header.titulo')}
        subtitle={t('actividad.header.subtitulo')}
        action={
          hasJobs &&
          refreshing && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-soft"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('actividad.actualizando')}
            </span>
          )
        }
      />

      <StatusFilterBar value={status} onChange={setStatus} />

      {listLoading ? (
        <SkeletonList cardClassName="h-[104px]" />
      ) : isError ? (
        <ErrorState title={t('actividad.errorCargar')} onRetry={() => void refetch()} />
      ) : !hasJobs ? (
        <ActivityEmptyState filtered={status !== 'all'} ctaTo={emptyCtaTo} />
      ) : (
        <div className="mt-6 space-y-3">
          {jobs.map((job) => (
            <JobActivityCard
              key={job.id}
              job={job}
              agentName={job.agentId !== null ? (agentsById.get(job.agentId) ?? null) : null}
            />
          ))}
          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line p-4 text-sm font-semibold text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFetchingNextPage ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <RefreshCw className="h-[18px] w-[18px]" />
              )}
              {t('actividad.cargarMas')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
