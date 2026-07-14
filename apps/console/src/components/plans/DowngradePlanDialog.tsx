import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';

/**
 * Confirmacion de DOWNGRADE de plan (self-service): elegir un plan MENOR al actual puede desactivar
 * la autonomia (recetas, tareas, triggers), asi que NO se aplica al primer click. El usuario confirma
 * aqui viendo a que plan pasa y que capacidades pierde (derivadas del modulo central de planes, nunca
 * hardcodeadas). Un upgrade no pasa por este dialogo. Accesible via useDialog: modal con trampa de
 * foco, cierra con Escape o click en el fondo, enfoca Cancelar al abrir. Mismo patron que
 * ChangeTierDialog del panel de admin.
 */
export function DowngradePlanDialog({
  open,
  planName,
  losses,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Nombre comercial del plan destino (Free/Pro/Business). */
  planName: string;
  /** Capacidades que se pierden con el cambio, ya en copy legible (downgradeLossSummary). */
  losses: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Con la mutacion EN VUELO no se permite descartar (ni Escape ni click en el fondo): cerrar en ese
  // momento pareceria una cancelacion, pero el cambio de plan ya viajo y se aplicaria igual.
  const dismiss = () => {
    if (busy) return;
    onCancel();
  };
  const dialogRef = useDialog({ open, onClose: dismiss, initialFocus: cancelRef });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={dismiss} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('planes.dialogo.titulo')}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t('planes.dialogo.titulo')}</h2>
        <p className="mt-2 text-sm text-muted">
          <Trans
            i18nKey="planes.dialogo.cuerpo"
            values={{ plan: planName }}
            components={{ nombre: <span className="font-medium text-ink" /> }}
          />
          {losses.length > 0 && (
            <>
              {' '}
              {t('planes.dialogo.perdidas', { perdidas: losses.join(t('planes.dialogo.perdidasSeparador')) })}
            </>
          )}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('planes.dialogo.cancelar')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('planes.dialogo.cambiando') : t('planes.dialogo.cambiarA', { plan: planName })}
          </button>
        </div>
      </div>
    </div>
  );
}
