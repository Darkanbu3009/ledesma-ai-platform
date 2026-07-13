import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  Loader,
  Webhook,
} from 'lucide-react';
import {
  toActivitySeries,
  toModelSpendSeries,
  totalTokens,
  type DashboardActivity,
  type DashboardOperations,
  type DashboardSpend,
  type DashboardSummary,
} from '../../lib/dashboard';
import { formatRunDate, formatTokens, formatUSD } from '../../lib/usage';
import { Notice } from '../ui/Notice';
import { MetricCard } from './MetricCard';
import { ActivityChart } from './ActivityChart';
import { SpendByModelChart } from './SpendByModelChart';

// Vista PRESENTACIONAL de un DashboardSummary: las tres secciones (operaciones, actividad, gasto) que antes
// vivian dentro de DashboardPage. Se extrajo para REUSARLA sin duplicar las graficas: la consume tanto el
// dashboard del propio usuario (DashboardPage, ownerId = el token) como la ficha de actividad del panel de
// admin (AdminUserDetailPage, ownerId = el :id objetivo). Es agnostica de quien es el resumen: recibe un
// DashboardSummary por props y lo pinta. NO decide carga/error/vacio (eso lo maneja cada pantalla).

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

/** EJE OPERACIONES: la foto actual de la cola + los recursos activos, arriba por ser lo mas escaneable. */
function OperationsSection({
  operations,
  lastRunAt,
}: {
  operations: DashboardOperations;
  lastRunAt: string | null;
}) {
  const { t } = useTranslation();
  const { jobs, resources } = operations;
  return (
    <section>
      <SectionHeading
        title={t('panel.operaciones.titulo')}
        description={t('panel.operaciones.descripcion')}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label={t('panel.operaciones.pendientes')}
          value={num(jobs.pending)}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.operaciones.enCurso')}
          value={num(jobs.running)}
          icon={<Loader className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.operaciones.completadas')}
          value={num(jobs.completed)}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.operaciones.fallidas')}
          value={num(jobs.failed)}
          emphasis={jobs.failed > 0}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label={t('panel.operaciones.tareasActivas')}
          value={num(resources.scheduledTasksActive)}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.operaciones.triggersActivos')}
          value={num(resources.triggersActive)}
          icon={<Webhook className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.operaciones.recetas')}
          value={num(resources.recipesActive)}
          icon={<ChefHat className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.operaciones.ultimaEjecucion')}
          value={lastRunAt ? formatRunDate(lastRunAt) : '—'}
          hint={lastRunAt ? undefined : t('panel.operaciones.sinEjecuciones')}
          icon={<History className="h-4 w-4" />}
          compact
        />
      </div>
    </section>
  );
}

/** EJE ACTIVIDAD: totales de corridas + la grafica de ejecuciones por dia. */
function ActivitySection({ activity }: { activity: DashboardActivity }) {
  const { t } = useTranslation();
  const series = useMemo(() => toActivitySeries(activity.byDay), [activity.byDay]);
  const { totals } = activity;
  return (
    <section>
      <SectionHeading
        title={t('panel.actividad.titulo')}
        description={t('panel.actividad.descripcion')}
      />
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
        <InlineStat label={t('panel.actividad.corridas')} value={num(totals.runs)} />
        <InlineStat label={t('panel.actividad.exitosas')} value={num(totals.completed)} />
        <InlineStat
          label={t('panel.actividad.conError')}
          value={num(totals.errors)}
          emphasis={totals.errors > 0}
        />
      </div>
      <ActivityChart data={series} />
    </section>
  );
}

/** EJE GASTO: tokens + dinero BYOK, con el desglose por modelo y la nota de transparencia. */
function SpendSection({ spend }: { spend: DashboardSpend }) {
  const { t } = useTranslation();
  const series = useMemo(() => toModelSpendSeries(spend.byModel), [spend.byModel]);
  const shown = series.slice(0, MAX_SPEND_MODELS);
  const hidden = series.length - shown.length;
  const { tokens } = spend;
  return (
    <section>
      <SectionHeading title={t('panel.gasto.titulo')} description={t('panel.gasto.descripcion')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label={t('panel.gasto.gastoEstimado')}
          value={formatUSD(spend.totalCostUsd)}
          hint={spend.costComplete ? undefined : t('panel.gasto.totalParcial')}
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.gasto.tokensTotales')}
          value={formatTokens(totalTokens(tokens))}
          icon={<Coins className="h-4 w-4" />}
        />
        <MetricCard
          label={t('panel.gasto.modelosUsados')}
          value={num(spend.byModel.length)}
          icon={<Boxes className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <InlineStat label={t('panel.gasto.entrada')} value={formatTokens(tokens.inputTokens)} />
          <InlineStat label={t('panel.gasto.salida')} value={formatTokens(tokens.outputTokens)} />
          <InlineStat label={t('panel.gasto.cacheLectura')} value={formatTokens(tokens.cacheReadTokens)} />
          <InlineStat label={t('panel.gasto.cacheEscritura')} value={formatTokens(tokens.cacheWriteTokens)} />
        </div>
      </div>

      <Notice notice={{ kind: 'ok', text: spend.note }} className="mt-4" />

      <div className="mt-6">
        <h3 className="font-display text-[15px] font-semibold text-ink">
          {t('panel.gasto.porModeloTitulo')}
        </h3>
        <p className="mt-0.5 text-[13px] text-muted">{t('panel.gasto.porModeloDescripcion')}</p>
        <div className="mt-3">
          <SpendByModelChart data={shown} />
        </div>
        {hidden > 0 && (
          <p className="mt-2 text-xs text-muted-soft">
            {t('panel.gasto.masModelos', { count: hidden })}
          </p>
        )}
        {spend.untariffedModels.length > 0 && (
          <p className="mt-2 text-xs text-muted-soft">
            {t('panel.gasto.sinTarifa', {
              count: spend.untariffedModels.length,
              lista: spend.untariffedModels.join(', '),
            })}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Las tres secciones en orden de escaneo (operaciones, actividad, gasto) para un DashboardSummary dado.
 * Componente puro de presentacion: reutiliza las graficas del dashboard (MetricCard/ActivityChart/
 * SpendByModelChart) sin reimplementarlas.
 */
export function DashboardSummaryView({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="space-y-10">
      <OperationsSection operations={summary.operations} lastRunAt={summary.activity.lastRunAt} />
      <ActivitySection activity={summary.activity} />
      <SpendSection spend={summary.spend} />
    </div>
  );
}
