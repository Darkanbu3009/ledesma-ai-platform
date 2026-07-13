import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';

export function RotateSecretDialog({
  open,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Antes no tenia ninguna gestion de foco/teclado; ahora hereda trampa de foco, Escape y retorno del
  // hook compartido. `initialFocus` por defecto ('first') enfoca el boton Cancelar al abrir.
  const dialogRef = useDialog({ open, onClose: onCancel });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('agentes.rotarSecreto.titulo')}
        className="relative w-full max-w-sm rounded-xl border border-grafito-border bg-grafito p-6 shadow-2xl shadow-black/40"
      >
        <h2 className="font-display text-lg font-semibold text-hueso">
          {t('agentes.rotarSecreto.titulo')}
        </h2>
        <p className="mt-2 text-sm text-hueso-muted">{t('agentes.rotarSecreto.descripcion')}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            {t('agentes.comun.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brasa px-4 py-2 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <RotateCcw className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? t('agentes.rotarSecreto.rotando') : t('agentes.rotarSecreto.rotar')}
          </button>
        </div>
      </div>
    </div>
  );
}
