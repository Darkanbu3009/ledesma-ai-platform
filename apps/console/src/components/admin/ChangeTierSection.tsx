import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChangeTier } from '../../lib/mutations';
import { TIER_ORDER, changeTierErrorMessage, tierLabel, tierMeta } from '../../lib/admin';
import type { ProfileTier } from '../../lib/registration';
import { focusRing } from '../../lib/utils';
import { Notice, type NoticeData } from '../ui/Notice';
import { TierBadge } from './UserBadges';
import { ChangeTierDialog } from './ChangeTierDialog';

/**
 * Control de CAMBIO DE TIER de la ficha: la palanca de monetizacion del panel. Muestra el tier actual y un
 * grupo segmentado (Free / Pro / Autonomo) para cambiarlo. NUNCA cambia de un solo click: seleccionar un
 * tier distinto abre el dialogo de confirmacion (ChangeTierDialog); solo al confirmar se dispara el PUT
 * atribuible (useChangeTier). Feedback claro al exito ("Tier actualizado") y al error (403/404 mapeados).
 *
 * Estado 100% en React/react-query (sin localStorage). Tras un cambio exitoso, la invalidacion de ['admin']
 * refresca la ficha y esta seccion recibe el `currentTier` nuevo por props.
 */
export function ChangeTierSection({
  userId,
  userName,
  currentTier,
}: {
  userId: string;
  userName: string;
  currentTier: ProfileTier;
}) {
  const { t } = useTranslation();
  // El tier que el admin selecciono y espera confirmacion. null = sin dialogo abierto.
  const [pendingTier, setPendingTier] = useState<ProfileTier | null>(null);
  const [feedback, setFeedback] = useState<NoticeData | null>(null);
  const mutation = useChangeTier();

  function selectTier(tier: ProfileTier) {
    if (tier === currentTier) return; // ya es el tier actual: nada que cambiar.
    setFeedback(null);
    mutation.reset(); // limpia un error/exito previo antes de abrir el dialogo.
    setPendingTier(tier);
  }

  function cancel() {
    setPendingTier(null);
    mutation.reset();
  }

  function confirm() {
    if (pendingTier === null) return;
    const target = pendingTier;
    mutation.mutate(
      { id: userId, tier: target },
      {
        onSuccess: () => {
          setFeedback({ kind: 'ok', text: t('admin.cambioTier.exito', { tier: tierLabel(target) }) });
          setPendingTier(null);
        },
        // En error dejamos el dialogo abierto mostrando el motivo (el admin reintenta o cancela).
      },
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">{t('admin.cambioTier.tierActual')}</span>
        <TierBadge tier={currentTier} />
      </div>

      <p className="mt-4 text-[13px] text-muted">
        {t('admin.cambioTier.instruccion')}
      </p>

      <div
        role="group"
        aria-label={t('admin.cambioTier.grupoAria')}
        className="mt-3 inline-flex flex-wrap gap-2"
      >
        {TIER_ORDER.map((tier) => {
          const active = tier === currentTier;
          return (
            <button
              key={tier}
              type="button"
              aria-pressed={active}
              disabled={active || mutation.isPending}
              onClick={() => selectTier(tier)}
              className={[
                'rounded-[10px] border px-3.5 py-2 text-sm font-medium transition',
                focusRing,
                active
                  ? `${tierMeta(tier).tone} cursor-default`
                  : 'border-line bg-surface text-ink-soft hover:border-brasa-line hover:text-brasa disabled:cursor-not-allowed disabled:opacity-60',
              ].join(' ')}
            >
              {tierLabel(tier)}
            </button>
          );
        })}
      </div>

      <Notice notice={feedback} className="mt-4" />

      <ChangeTierDialog
        open={pendingTier !== null}
        userName={userName}
        fromTier={currentTier}
        toTier={pendingTier ?? currentTier}
        busy={mutation.isPending}
        error={mutation.isError ? changeTierErrorMessage(mutation.error) : undefined}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </div>
  );
}
