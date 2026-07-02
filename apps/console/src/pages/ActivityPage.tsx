import { useMemo, useState } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { useAgents, useJobs } from '../lib/queries';
import { JOB_STATUS_FILTERS, type JobStatusFilter } from '../lib/jobs';
import { JobActivityCard } from '../components/activity/JobActivityCard';

/** Fila de chips para filtrar el historial por estado. */
function StatusFilterBar({
  value,
  onChange,
}: {
  value: JobStatusFilter;
  onChange: (next: JobStatusFilter) => void;
}) {
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
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Estado vacio. El texto depende de si hay un filtro activo. */
function ActivityEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="mt-10 flex flex-1 flex-col items-center justify-center text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
        <Activity className="h-6 w-6" />
      </span>
      <h2 className="mt-5 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        {filtered ? 'Sin ejecuciones con este estado' : 'Aun no hay ejecuciones'}
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.6] text-muted">
        {filtered
          ? 'Prueba con otro estado o quita el filtro para ver todo el historial.'
          : 'Cuando tus recetas, tareas programadas o triggers ejecuten a un agente, vas a ver aqui cada corrida: que agente, cuando y en que estado termino.'}
      </p>
    </div>
  );
}

/**
 * Pagina ACTIVIDAD (/actividad): historial de ejecuciones autonomas (jobs) del usuario, SOLO LECTURA.
 * Muestra que agente corrio, el tipo (receta/mensaje), el estado, las fechas, los intentos y el error si
 * fallo. Filtrable por estado y paginada con "cargar mas". Auto-refresh prudente (lo maneja useJobs: solo
 * reconsulta si hay jobs en vuelo). SIN gate por tier: ver el historial propio es para todos los planes.
 */
export function ActivityPage() {
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
  const hasJobs = jobs.length > 0;
  const listLoading = isLoading || agentsLoading;
  // Refetch silencioso en curso (auto-refresh o cambio de filtro) con datos ya visibles.
  const refreshing = isFetching && !isLoading && !isFetchingNextPage;

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Actividad</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Historial de ejecuciones de tus agentes: recetas, tareas programadas y triggers.
          </p>
        </div>
        {hasJobs && refreshing && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-soft">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Actualizando
          </span>
        )}
      </div>

      <StatusFilterBar value={status} onChange={setStatus} />

      {listLoading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">No pudimos cargar tu actividad</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : !hasJobs ? (
        <ActivityEmptyState filtered={status !== 'all'} />
      ) : (
        <div className="mt-6 space-y-3">
          {jobs.map((job) => (
            <JobActivityCard key={job.id} job={job} agentName={agentsById.get(job.agentId) ?? null} />
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
              Cargar mas
            </button>
          )}
        </div>
      )}
    </div>
  );
}
