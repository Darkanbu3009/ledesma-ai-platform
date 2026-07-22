import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';

/**
 * Confirmacion del BORRADO FORZADO de un sitio (el boton "Eliminar" de la lista, la unica accion
 * por fila). Es la salida GARANTIZADA desde cualquier estado: el worker intenta cerrar la sesion y
 * borrar el contexto en el proveedor best-effort, pero el registro local y la constancia ARCO se
 * completan pase lo que pase con Browserbase. La copy lo dice tal cual: se eliminara de todos modos.
 * Mismo patron accesible que DeleteTriggerDialog (via useDialog): trampa de foco, Escape, click
 * en el fondo y foco de vuelta al cerrar.
 */
export function EliminarSitioDialog({
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
        aria-label={t('sitios.eliminarDialog.titulo')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">
          {t('sitios.eliminarDialog.titulo')}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {t('sitios.eliminarDialog.cuerpoAntes')}{' '}
          <span className="font-medium text-ink">{dominio}</span>.{' '}
          {t('sitios.eliminarDialog.cuerpoDespues')}
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
            {busy ? t('sitios.eliminarDialog.eliminando') : t('sitios.eliminarDialog.eliminar')}
          </button>
        </div>
      </div>
    </div>
  );
}
