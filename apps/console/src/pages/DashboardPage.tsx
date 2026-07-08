import { useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { useDashboard } from '../lib/queries';
import {
  dashboardRangeFromPreset,
  hasDashboardData,
  type DashboardRangePreset,
  type DashboardSummary,
} from '../lib/dashboard';
import { formatUSD } from '../lib/usage';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { RangeSelector } from '../components/dashboard/RangeSelector';
import { DashboardSummaryView } from '../components/dashboard/DashboardSummaryView';
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist';

/** Tarjeta de metrica del estado inicial: etiqueta muted + valor compacto, sin sombra. */
function ZeroMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border-[0.5px] border-line bg-surface px-4 py-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-medium tabular-nums text-ink">{value}</p>
    </div>
  );
}

/**
 * Fila de metricas del estado inicial (todo en cero), entre el selector de rango y el estado vacio.
 * Corridas y gasto salen del resumen que esta pantalla YA recibe (GET /v1/dashboard); el conteo de
 * agentes activos no viaja en ese resumen, asi que se muestra 0 estatico de presentacion.
 */
function ZeroMetricsRow({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <ZeroMetricCard label="Corridas" value={summary.activity.totals.runs.toLocaleString('es-MX')} />
      {/* TODO: conectar a GET /v1/dashboard */}
      <ZeroMetricCard label="Agentes activos" value="0" />
      <ZeroMetricCard label="Gasto estimado" value={formatUSD(summary.spend.totalCostUsd)} />
    </div>
  );
}

/** Estado vacio compacto y horizontal: el owner aun no ejecuto nada. La accion de crear un agente ya
 * vive en el paso 2 del checklist (y en /agentes), asi que aqui no se repite el CTA. Todo el estado
 * inicial del Panel debe caber sin scroll en un viewport de laptop (1366x768). */
function DashboardEmptyState() {
  return (
    <div className="mt-3 flex items-center gap-3.5 rounded-[10px] border-[0.5px] border-dashed border-[#D3D1C7] bg-[#FAF9F5] p-4">
      {/* Icono neutro: la firma brasa de la pagina es el spark del banner, no este badge. */}
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#F1EFE8] text-[#8A8880]">
        <BarChart3 className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-medium text-ink">Aun no hay actividad</h2>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
          Cuando crees un agente y lo ejecutes, aqui vas a ver tu actividad, tus operaciones y el gasto
          estimado.
        </p>
      </div>
    </div>
  );
}

/**
 * Pantalla PANEL (/dashboard): la vista que un owner usa para rastrear su ACTIVIDAD (ejecuciones),
 * OPERACIONES (estado de cola + recursos activos) y GASTO (tokens + su equivalente en dinero BYOK),
 * leyendo GET /v1/dashboard. Solo lectura, SIN gate por tier: cada quien ve su propio panel. Maneja los
 * estados de carga (SkeletonList), error (ErrorState con reintento) y vacio (fila de metricas en cero +
 * estado vacio compacto). El contenido con datos lo pinta DashboardSummaryView (compartido con la ficha
 * de admin).
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

      {/* Hilo guiado de primeros pasos (bienvenida + checklist), justo debajo del titulo del Panel. No
          intrusivo: se autooculta (devuelve null) mientras carga, ante error y cuando el onboarding esta
          completo, asi un usuario establecido no lo ve ni deja hueco (el margen vive en el propio componente). */}
      <OnboardingChecklist />

      {/* Titulo de la zona de actividad a la izquierda, selector de rango alineado a la derecha. */}
      <div className="mt-4 flex items-center justify-between gap-4">
        <h2 className="text-[14px] font-medium text-ink">Actividad</h2>
        <RangeSelector value={preset} onChange={setPreset} />
      </div>

      {isLoading ? (
        <SkeletonList count={3} cardClassName="h-40" className="mt-6 space-y-4" />
      ) : isError || !data ? (
        <ErrorState title="No pudimos cargar tu panel" onRetry={() => void refetch()} />
      ) : !hasDashboardData(data) ? (
        <>
          <ZeroMetricsRow summary={data} />
          <DashboardEmptyState />
        </>
      ) : (
        <div className="mt-6">
          <DashboardSummaryView summary={data} />
        </div>
      )}
    </div>
  );
}
