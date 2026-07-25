import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';

/**
 * Confirmacion de TERMINAR una tarea desde /actividad. Texto pensado para usuario no tecnico: la
 * tarea se detiene donde va y lo ya hecho en el sitio no se deshace. Se monta solo al abrir; mismo
 * patron accesible que EliminarSitioDialog (useDialog: trampa de foco, Escape, click en el fondo y
 * foco de vuelta al cerrar).
 */
export function TerminarTareaDialog({
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog({ onClose: onCancel, initialFocus: cancelRef });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('confirmarTerminar.titulo')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t('confirmarTerminar.titulo')}</h2>
        <p className="mt-2 text-sm text-muted">{t('confirmarTerminar.detalle')}</p>
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
            {t('confirmarTerminar.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('confirmarTerminar.confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}
