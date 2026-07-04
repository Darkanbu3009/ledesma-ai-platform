import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChefHat,
  Clock,
  CircleDollarSign,
  Coins,
  History,
  LayoutDashboard,
  Loader,
  Loader2,
  Webhook,
} from 'lucide-react';
import { useDashboard } from '../lib/queries';
import {
  dashboardRangeFromPreset,
  hasDashboardData,
  toActivitySeries,
  toModelSpendSeries,
  totalTokens,
  type DashboardActivity,
  type DashboardOperations,
  type DashboardRangePreset,
  type DashboardSpend,
  type DashboardSummary,
} from '../lib/dashboard';
import { formatRunDate, formatTokens, formatUSD } from '../lib/usage';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { Notice } from '../components/ui/Notice';
import { MetricCard } from '../components/dashboard/MetricCard';
import { RangeSelector } from '../components/dashboard/RangeSelector';
import { ActivityChart } from '../components/dashboard/ActivityChart';
import { SpendByModelChart } from '../components/dashboard/SpendByModelChart';

// Tope de barras en la grafica de gasto por modelo. Un owner casi nunca supera esto; si lo hace, se
// muestran los de mayor gasto (ya vienen ordenados desc) y se anota cuantos quedaron fuera (sin cap mudo).
const MAX_SPEND_MODELS = 8;

/** Titulo de seccion consistente (h2 + descripcion breve). */
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
    </div>
  );
}

/** Metrica compacta en linea (numero + etiqueta), para los totales y los cubos de tokens. */
function InlineStat({ label, value, emphasis }: { label: string; value: ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <p
        className={`font-display text-2xl font-bold tabular-nums ${emphasis ? 'text-brasa' : 'text-ink'}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

/** Numero grande, es-MX con separador de miles. */
function num(value: number): string {
  return value.toLocaleString('es-MX');
}

/** Pluraliza "modelo": 1 -> "modelo", n -> "modelos". */
function modelWord(count: number): string {
  return count === 1 ? 'modelo' : 'modelos';
}

/** EJE OPERACIONES: la foto actual de la cola + los recursos activos, arriba por ser lo mas escaneable. */
function OperationsSection({
  operations,
  lastRunAt,
}: {
  operations: DashboardOperations;
  lastRunAt: string | null;
}) {
  const { jobs, resources } = operations;
  return (
    <section>
      <SectionHeading
        title="Operaciones"
        description="Estado actual de tu cola de ejecucion y tus recursos activos."
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Pendientes" value={num(jobs.pending)} icon={<Clock className="h-4 w-4" />} />
        <MetricCard label="En curso" value={num(jobs.running)} icon={<Loader className="h-4 w-4" />} />
        <MetricCard
          label="Completadas"
          value={num(jobs.completed)}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Fallidas"
          value={num(jobs.failed)}
          emphasis={jobs.failed > 0}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Tareas activas"
          value={num(resources.scheduledTasksActive)}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <MetricCard
          label="Triggers activos"
          value={num(resources.triggersActive)}
          icon={<Webhook className="h-4 w-4" />}
        />
        <MetricCard
          label="Recetas"
          value={num(resources.recipesActive)}
          icon={<ChefHat className="h-4 w-4" />}
        />
        <MetricCard
          label="Ultima ejecucion"
          value={lastRunAt ? formatRunDate(lastRunAt) : '—'}
          hint={lastRunAt ? undefined : 'Sin ejecuciones aun'}
          icon={<History className="h-4 w-4" />}
          compact
        />
      </div>
    </section>
  );
}

/** EJE ACTIVIDAD: totales de corridas + la grafica de ejecuciones por dia. */
function ActivitySection({ activity }: { activity: DashboardActivity }) {
  const series = useMemo(() => toActivitySeries(activity.byDay), [activity.byDay]);
  const { totals } = activity;
  return (
    <section>
      <SectionHeading
        title="Actividad"
        description="Ejecuciones de tus agentes por dia en el rango seleccionado."
      />
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
        <InlineStat label="Corridas" value={num(totals.runs)} />
        <InlineStat label="Exitosas" value={num(totals.completed)} />
        <InlineStat label="Con error" value={num(totals.errors)} emphasis={totals.errors > 0} />
      </div>
      <ActivityChart data={series} />
    </section>
  );
}

/** EJE GASTO: tokens + dinero BYOK, con el desglose por modelo y la nota de transparencia. */
function SpendSection({ spend }: { spend: DashboardSpend }) {
  const series = useMemo(() => toModelSpendSeries(spend.byModel), [spend.byModel]);
  const shown = series.slice(0, MAX_SPEND_MODELS);
  const hidden = series.length - shown.length;
  const { tokens } = spend;
  return (
    <section>
      <SectionHeading
        title="Gasto"
        description="Consumo estimado sobre tu propia key del proveedor, desglosado por modelo."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Gasto estimado"
          value={formatUSD(spend.totalCostUsd)}
          hint={spend.costComplete ? undefined : 'Total parcial: hay modelos sin tarifa conocida'}
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <MetricCard
          label="Tokens totales"
          value={formatTokens(totalTokens(tokens))}
          icon={<Coins className="h-4 w-4" />}
        />
        <MetricCard
          label="Modelos usados"
          value={num(spend.byModel.length)}
          icon={<Boxes className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <InlineStat label="Entrada" value={formatTokens(tokens.inputTokens)} />
          <InlineStat label="Salida" value={formatTokens(tokens.outputTokens)} />
          <InlineStat label="Cache lectura" value={formatTokens(tokens.cacheReadTokens)} />
          <InlineStat label="Cache escritura" value={formatTokens(tokens.cacheWriteTokens)} />
        </div>
      </div>

      <Notice notice={{ kind: 'ok', text: spend.note }} className="mt-4" />

      <div className="mt-6">
        <h3 className="font-display text-[15px] font-semibold text-ink">Gasto por modelo</h3>
        <p className="mt-0.5 text-[13px] text-muted">
          Cada modelo se tarifa por separado; se muestran solo los que tienen tarifa conocida.
        </p>
        <div className="mt-3">
          <SpendByModelChart data={shown} />
        </div>
        {hidden > 0 && (
          <p className="mt-2 text-xs text-muted-soft">
            y {hidden} {modelWord(hidden)} mas con gasto menor.
          </p>
        )}
        {spend.untariffedModels.length > 0 && (
          <p className="mt-2 text-xs text-muted-soft">
            {spend.untariffedModels.length} {modelWord(spend.untariffedModels.length)} sin tarifa
            conocida (no se estima su costo en dinero): {spend.untariffedModels.join(', ')}.
          </p>
        )}
      </div>
    </section>
  );
}

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

/** Contenido con datos: las tres secciones en orden de escaneo (operaciones, actividad, gasto). */
function DashboardContent({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="mt-6 space-y-10">
      <OperationsSection operations={summary.operations} lastRunAt={summary.activity.lastRunAt} />
      <ActivitySection activity={summary.activity} />
      <SpendSection spend={summary.spend} />
    </div>
  );
}

/**
 * Pantalla PANEL (/dashboard): la vista que un owner usa para rastrear su ACTIVIDAD (ejecuciones),
 * OPERACIONES (estado de cola + recursos activos) y GASTO (tokens + su equivalente en dinero BYOK),
 * leyendo GET /v1/dashboard. Solo lectura, SIN gate por tier: cada quien ve su propio panel. Maneja los
 * estados de carga (SkeletonList), error (ErrorState con reintento) y vacio (EmptyState que guia).
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
        <DashboardContent summary={data} />
      )}
    </div>
  );
}
