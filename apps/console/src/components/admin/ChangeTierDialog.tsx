import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';
import { tierLabel } from '../../lib/admin';
import type { ProfileTier } from '../../lib/registration';

/**
 * Confirmacion del CAMBIO DE TIER (la accion sensible del panel: opera la monetizacion). NO cambia al
 * primer click del control: el admin confirma aqui, viendo explicitamente de que tier a cual pasa y a que
 * usuario, antes de que se dispare el PUT. Accesible (via useDialog): dialog modal con trampa de foco,
 * cierra con Escape o click en el fondo, enfoca Cancelar al abrir y devuelve el foco al cerrar. Mismo
 * patron que los dialogos de borrado de la consola.
 */
export function ChangeTierDialog({
  open,
  userName,
  fromTier,
  toTier,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  userName: string;
  fromTier: ProfileTier;
  toTier: ProfileTier;
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
        aria-label={t('admin.cambioTier.titulo')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t('admin.cambioTier.titulo')}</h2>
        <p className="mt-2 text-sm text-muted">
          <Trans
            i18nKey="admin.cambioTier.descripcion"
            values={{ usuario: userName, de: tierLabel(fromTier), a: tierLabel(toTier) }}
            components={{ destacado: <span className="font-medium text-ink" /> }}
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
            disabled={busy}
            className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('ui.acciones.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('admin.cambioTier.cambiando') : t('admin.cambioTier.titulo')}
          </button>
        </div>
      </div>
    </div>
  );
}
