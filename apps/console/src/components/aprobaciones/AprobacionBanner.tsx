import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { useAprobacionesPendientes } from '../../lib/queries';

/**
 * Banner GLOBAL de aprobaciones pendientes (7.1e): visible en toda la consola mientras exista al
 * menos un checkpoint esperando decision, con el CTA a la vista de la tarea (/actividad), donde el
 * modal muestra el screenshot y los botones. El dato sale del polling de useAprobacionesPendientes
 * (patron V017, sin useEffect); en /actividad el banner se oculta (alli ya esta el modal).
 */
export function AprobacionBanner() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data: pendientes } = useAprobacionesPendientes();

  const cantidad = pendientes?.length ?? 0;
  if (cantidad === 0 || pathname.startsWith('/actividad')) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-brasa-line bg-brasa-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-brasa" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ink">
            {t('aprobaciones.banner.titulo', { count: cantidad })}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">{t('aprobaciones.banner.descripcion')}</p>
        </div>
      </div>
      <Link
        to="/actividad"
        className="inline-flex flex-none items-center justify-center rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover"
      >
        {t('aprobaciones.banner.cta')}
      </Link>
    </div>
  );
}
