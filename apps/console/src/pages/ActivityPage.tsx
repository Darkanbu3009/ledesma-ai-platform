import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Loader2 } from 'lucide-react';
import { useAgents, useAprobacionesPendientes, useJobs } from '../lib/queries';
import { AprobacionDialog } from '../components/aprobaciones/AprobacionDialog';
import { playgroundPath } from '../lib/agents';
import { JOB_STATUS_FILTERS, type JobStatusFilter } from '../lib/jobs';
import { unirPaginasPorId } from '../hooks/useInfiniteScroll';
import { ActivityGhostTable } from '../components/activity/ActivityGhostTable';
import { JobActivityCard } from '../components/activity/JobActivityCard';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { InfiniteListFooter } from '../components/ui/InfiniteListFooter';

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
 * fallo. Filtrable por estado y con SCROLL INFINITO (useInfiniteScroll + InfiniteListFooter: la pagina
 * siguiente entra sola al acercarse el final de la lista). Auto-refresh prudente (lo maneja useJobs: solo
 * reconsulta si hay jobs en vuelo). SIN gate por tier: ver el historial propio es para todos los planes.
 */
export function ActivityPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<JobStatusFilter>('all');
  // CHECKPOINT DE APROBACION (7.1e): en la vista de la tarea, la aprobacion pendiente mas reciente
  // abre el modal (screenshot + descripcion + Aprobar/Rechazar). Cerrar sin decidir la DESCARTA solo
  // visualmente (por id, estado derivado del click, sin useEffect): la aprobacion sigue pendiente y
  // una NUEVA (otro id) vuelve a abrir el modal.
  const { data: pendientes } = useAprobacionesPendientes();
  const [aprobacionDescartadaId, setAprobacionDescartadaId] = useState<string | null>(null);
  const aprobacionActiva = (pendientes ?? []).find((a) => a.id !== aprobacionDescartadaId) ?? null;

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

  // La paginacion del backend es por OFFSET sobre una lista que crece por arriba: si entra una
  // corrida nueva mientras el usuario lee, la ventana se corre y un job puede repetirse entre dos
  // paginas. Se deduplica por id al concatenar (ver unirPaginasPorId).
  const jobs = useMemo(() => unirPaginasPorId(data?.pages.map((page) => page.jobs)), [data]);
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
      ) : !hasJobs ? (
        isError ? (
          <ErrorState title={t('actividad.errorCargar')} onRetry={() => void refetch()} />
        ) : (
          <ActivityEmptyState filtered={status !== 'all'} ctaTo={emptyCtaTo} />
        )
      ) : (
        // Con tarjetas ya visibles, un fallo NO reemplaza la lista por el ErrorState: es el fallo de
        // UNA pagina y se resuelve en el pie, con Reintentar. El ErrorState de arriba queda para el
        // caso en que no se pudo cargar nada.
        <div className="mt-6 space-y-3">
          {jobs.map((job) => (
            <JobActivityCard
              key={job.id}
              job={job}
              agentName={job.agentId !== null ? (agentsById.get(job.agentId) ?? null) : null}
            />
          ))}
          <InfiniteListFooter
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={() => void fetchNextPage()}
            hasError={isError}
          />
        </div>
      )}

      {aprobacionActiva && (
        <AprobacionDialog
          aprobacion={aprobacionActiva}
          onCerrar={() => setAprobacionDescartadaId(aprobacionActiva.id)}
        />
      )}
    </div>
  );
}
