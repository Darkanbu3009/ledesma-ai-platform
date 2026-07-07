import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Loader2 } from 'lucide-react';
import { useDashboard } from '../lib/queries';
import {
  dashboardRangeFromPreset,
  hasDashboardData,
  type DashboardRangePreset,
} from '../lib/dashboard';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { RangeSelector } from '../components/dashboard/RangeSelector';
import { DashboardSummaryView } from '../components/dashboard/DashboardSummaryView';
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist';

/** Estado vacio: el owner aun no ejecuto nada. Guia a crear y ejecutar un agente. Reusa EmptyState. */
function DashboardEmptyState() {
  return (
    <EmptyState
      variant="centered"
      media={
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
          <LayoutDashboard className="h-6 w-6" />
        </span>
      }
      title="Aun no hay actividad"
      description="Cuando crees un agente y lo ejecutes —desde el Playground, una receta, una tarea programada o un trigger— vas a ver aqui tu actividad, el estado de tus operaciones y el gasto estimado."
      action={
        <Link
          to="/agentes"
          className="inline-flex items-center gap-2 rounded-xl bg-brasa px-4 py-2 text-sm font-semibold text-white shadow-brasa transition hover:bg-brasa-hover"
        >
          Crear un agente
        </Link>
      }
    />
  );
}

/**
 * Pantalla PANEL (/dashboard): la vista que un owner usa para rastrear su ACTIVIDAD (ejecuciones),
 * OPERACIONES (estado de cola + recursos activos) y GASTO (tokens + su equivalente en dinero BYOK),
 * leyendo GET /v1/dashboard. Solo lectura, SIN gate por tier: cada quien ve su propio panel. Maneja los
 * estados de carga (SkeletonList), error (ErrorState con reintento) y vacio (EmptyState que guia). El
 * contenido con datos lo pinta DashboardSummaryView (compartido con la ficha de admin).
 */
export function DashboardPage() {
  const [preset, setPreset] = useState<DashboardRangePreset>('30d');
  // Memoizado por preset: evita recalcular un `from` distinto en cada render (y refetches en cadena).
  const range = useMemo(() => dashboardRangeFromPreset(preset), [preset]);
  const { data, isLoading, isError, refetch, isFetching } = useDashboard(range);
  // Refetch silencioso (cambio de rango) con datos ya visibles: se anuncia sin bloquear la vista.
  const refreshing = isFetching && !isLoading;

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col">
      {/* Hilo guiado de primeros pasos (bienvenida + checklist). No intrusivo: se autooculta mientras
          carga y cuando el onboarding esta completo, asi un usuario establecido no lo ve. */}
      <OnboardingChecklist />

      <PageHeader
        title="Panel"
        subtitle="Tu actividad, operaciones y gasto en un vistazo."
        action={
          // Region viva SIEMPRE montada (aunque vacia): asi el lector de pantalla la registra al inicio
          // y anuncia el refresco cuando aparece. Si solo se montara al refrescar, el AT no lo anunciaria.
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-soft"
          >
            {refreshing && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Actualizando
              </>
            )}
          </span>
        }
      />

      <div className="mt-5">
        <RangeSelector value={preset} onChange={setPreset} />
      </div>

      {isLoading ? (
        <SkeletonList count={3} cardClassName="h-40" className="mt-6 space-y-4" />
      ) : isError || !data ? (
        <ErrorState title="No pudimos cargar tu panel" onRetry={() => void refetch()} />
      ) : !hasDashboardData(data) ? (
        <DashboardEmptyState />
      ) : (
        <div className="mt-6">
          <DashboardSummaryView summary={data} />
        </div>
      )}
    </div>
  );
}
