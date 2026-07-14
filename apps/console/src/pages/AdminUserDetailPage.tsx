import { type ReactNode, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdminUser, useAdminUserActivity } from '../lib/queries';
import { accountTypeLabel, formatUserDate, roleLabel, type AdminUserDetail } from '../lib/admin';
import {
  dashboardRangeFromPreset,
  hasDashboardData,
  type DashboardRangePreset,
} from '../lib/dashboard';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { RangeSelector } from '../components/dashboard/RangeSelector';
import { DashboardSummaryView } from '../components/dashboard/DashboardSummaryView';
import { AdminBadge, TierBadge } from '../components/admin/UserBadges';
import { ChangeTierSection } from '../components/admin/ChangeTierSection';

/** Enlace de regreso a la lista, arriba del encabezado. */
function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/admin"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-brasa"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('admin.ficha.volver')}
    </Link>
  );
}

/** Titulo de seccion consistente con el dashboard (h2 + descripcion). */
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
    </div>
  );
}

/** Fila etiqueta -> valor de una lista de definiciones (dl). */
function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-soft py-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4">
      <dt className="text-[13px] text-muted sm:w-44 sm:flex-none">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

/** Badge Si/No para banderas booleanas (identidad verificada). */
function BoolBadge({ value }: { value: boolean }) {
  const { t } = useTranslation();
  return value ? (
    <span className="inline-flex items-center rounded-md border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
      {t('admin.ficha.si')}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-md border border-line bg-line-soft px-2 py-0.5 text-xs font-medium text-muted">
      {t('admin.ficha.no')}
    </span>
  );
}

/** SECCION DATOS: perfil + email + suscripcion + uso. */
function DataSection({ detail }: { detail: AdminUserDetail }) {
  const { t } = useTranslation();
  const { profile, email, subscription, usageCounter } = detail;
  return (
    <section>
      <SectionHeading title={t('admin.ficha.datosTitulo')} description={t('admin.ficha.datosDescripcion')} />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <dl>
          <DataRow label={t('admin.ficha.nombre')} value={profile.fullName || t('admin.comun.sinNombre')} />
          <DataRow label={t('admin.ficha.email')} value={email ?? t('admin.comun.sinEmail')} />
          <DataRow label={t('admin.ficha.tipoCuenta')} value={accountTypeLabel(profile.accountType)} />
          <DataRow label={t('admin.comun.rol')} value={roleLabel(profile.role)} />
          <DataRow label={t('admin.ficha.identidadVerificada')} value={<BoolBadge value={profile.identityVerified} />} />
          <DataRow label={t('admin.comun.registro')} value={formatUserDate(profile.createdAt)} />
        </dl>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-soft">
            {t('admin.ficha.suscripcion')}
          </h3>
          {subscription ? (
            <dl className="mt-3">
              <DataRow label={t('admin.comun.plan')} value={subscription.plan} />
              <DataRow label={t('admin.ficha.estado')} value={subscription.status} />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted">{t('admin.ficha.sinSuscripcion')}</p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-soft">{t('admin.ficha.uso')}</h3>
          {usageCounter ? (
            <>
              <p className="mt-3 font-display text-2xl font-bold tabular-nums text-ink">
                {usageCounter.runsUsed.toLocaleString('es-MX')}
                <span className="text-muted"> / {usageCounter.runsLimit.toLocaleString('es-MX')}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t('admin.ficha.ejecucionesUsadas', { periodo: usageCounter.periodKind })}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">{t('admin.ficha.sinDatosUso')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** SECCION ACTIVIDAD: los tres ejes del usuario objetivo, reusando la vista del dashboard. */
function ActivitySection({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<DashboardRangePreset>('30d');
  const range = useMemo(() => dashboardRangeFromPreset(preset), [preset]);
  const { data, isLoading, isError, refetch, isFetching } = useAdminUserActivity(userId, range);
  const refreshing = isFetching && !isLoading;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">{t('admin.ficha.actividadTitulo')}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {t('admin.ficha.actividadDescripcion')}
          </p>
        </div>
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-soft"
        >
          {refreshing && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('admin.ficha.actualizando')}
            </>
          )}
        </span>
      </div>

      <div className="mb-5">
        <RangeSelector value={preset} onChange={setPreset} />
      </div>

      {isLoading ? (
        <SkeletonList count={3} cardClassName="h-40" className="space-y-4" />
      ) : isError || !data ? (
        <ErrorState
          title={t('admin.ficha.errorActividad')}
          onRetry={() => void refetch()}
          className="mt-0"
        />
      ) : !hasDashboardData(data) ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted shadow-card">
          {t('admin.ficha.sinActividad')}
        </div>
      ) : (
        <DashboardSummaryView summary={data} />
      )}
    </section>
  );
}

/**
 * Pantalla FICHA de un usuario (/admin/users/:id). Reune sus DATOS (perfil + suscripcion + uso), la
 * LICENCIA/TIER con el control de cambio (accion sensible, con confirmacion y feedback) y su ACTIVIDAD
 * (reusando la vista del dashboard, apuntada al :id objetivo). Cada seccion maneja carga/error/vacio. Vive
 * detras del AdminGate; el backend igual gatea por rol.
 */
export function AdminUserDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: detail, isLoading, isError, error, refetch } = useAdminUser(id);

  // 404: el usuario no existe (o dejo de existir). Se distingue del error de red generico para dar un
  // mensaje claro con salida a la lista, en vez de un "reintentar" que nunca va a funcionar.
  const notFound = isError && (error as { status?: number } | null)?.status === 404;

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col">
      <div className="mb-4">
        <BackLink />
      </div>

      {isLoading ? (
        <>
          <PageHeader title={t('admin.comun.usuario')} subtitle={t('admin.ficha.cargandoFicha')} />
          <SkeletonList count={3} cardClassName="h-40" className="mt-6 space-y-4" />
        </>
      ) : notFound ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">{t('admin.ficha.usuarioNoEncontrado')}</p>
          <p className="mt-2 text-sm text-muted">
            {t('admin.comun.usuarioNoExiste')}
          </p>
          <Link
            to="/admin"
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('admin.ficha.volver')}
          </Link>
        </div>
      ) : isError || !detail || !id ? (
        <ErrorState title={t('admin.ficha.errorFicha')} onRetry={() => void refetch()} />
      ) : (
        <>
          <PageHeader
            title={detail.profile.fullName || detail.email || t('admin.comun.usuario')}
            subtitle={detail.email ?? t('admin.comun.sinEmail')}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <TierBadge tier={detail.profile.tier} />
                {detail.profile.isAdmin && <AdminBadge />}
              </div>
            }
          />

          <div className="mt-8 space-y-10">
            <DataSection detail={detail} />

            <section>
              <SectionHeading
                title={t('admin.ficha.licenciaTitulo')}
                description={t('admin.ficha.licenciaDescripcion')}
              />
              <ChangeTierSection
                userId={id}
                userName={detail.profile.fullName || detail.email || t('admin.ficha.esteUsuario')}
                currentTier={detail.profile.tier}
              />
            </section>

            <ActivitySection userId={id} />
          </div>
        </>
      )}
    </div>
  );
}
