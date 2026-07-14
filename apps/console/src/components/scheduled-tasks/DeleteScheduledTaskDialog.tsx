import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';

/**
 * Confirmacion de borrado de una tarea programada. NO se borra al primer click: el usuario confirma
 * aqui antes de que la pantalla dispare el DELETE. Accesible (via useDialog): dialog modal con trampa
 * de foco, cierra con Escape o click en el fondo, enfoca Cancelar al abrir y devuelve el foco al cerrar.
 */
export function DeleteScheduledTaskDialog({
  open,
  description,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  description: string;
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
        aria-label={t('tareas.eliminar.ariaLabel')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t('tareas.eliminar.titulo')}</h2>
        <p className="mt-2 text-sm text-muted">
          <Trans
            i18nKey="tareas.eliminar.confirmacion"
            values={{ descripcion: description }}
            components={{ nombre: <span className="font-medium text-ink" /> }}
          />
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
            {t('tareas.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('tareas.eliminar.eliminando') : t('tareas.eliminar.boton')}
          </button>
        </div>
      </div>
    </div>
  );
}
