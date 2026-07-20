import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';

/**
 * Confirmacion de DESCONEXION de un sitio (7.1c). NO se desconecta al primer click: es el borrado
 * ARCO de la conexion (contexto de sesion en el proveedor + fila local) y es PERMANENTE, asi que el
 * usuario confirma aqui antes de que la pagina dispare el DELETE. Mismo patron accesible que
 * DeleteTriggerDialog (via useDialog): trampa de foco, Escape, click en el fondo y foco de vuelta.
 */
export function DesconectarSitioDialog({
  open,
  dominio,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  dominio: string;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog({ open, onClose: onCancel, initialFocus: cancelRef });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('sitios.desconectarDialog.titulo')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">
          {t('sitios.desconectarDialog.titulo')}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {t('sitios.desconectarDialog.cuerpoAntes')}{' '}
          <span className="font-medium text-ink">{dominio}</span>.{' '}
          {t('sitios.desconectarDialog.cuerpoDespues')}
        </p>
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
          >
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            {t('sitios.comunes.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('sitios.desconectarDialog.desconectando') : t('sitios.desconectarDialog.desconectar')}
          </button>
        </div>
      </div>
    </div>
  );
}
