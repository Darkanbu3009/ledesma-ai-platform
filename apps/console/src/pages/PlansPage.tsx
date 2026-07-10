import { useState } from 'react';
import { Check } from 'lucide-react';
import { useMe } from '../lib/queries';
import { useSelectPlan } from '../lib/mutations';
import {
  LAUNCH_NOTICE,
  PLANS,
  downgradeLossSummary,
  isDowngrade,
  selectPlanErrorMessage,
  type Plan,
  type PlanId,
} from '../lib/plans';
import type { ProfileTier } from '../lib/registration';
import { Button } from '../components/ui/button';
import { Notice, type NoticeData } from '../components/ui/Notice';
import { DowngradePlanDialog } from '../components/plans/DowngradePlanDialog';

/** Pill greige compartida por "Recomendado" y "Tu plan" (misma escala que los pills del perfil). */
const pillClass =
  'inline-flex items-center gap-1 rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[11.5px] text-[#444441]';

/**
 * Tarjeta de un plan: superficie blanca plana con hairline; el recomendado (Pro) lleva borde firme
 * de 1px y pill "Recomendado". El plan que el usuario YA tiene se marca con el pill "Tu plan" (check
 * verde, unico verde de la tarjeta) y su CTA queda deshabilitado; en el resto, el CTA brasa es el
 * unico acento brasa de la tarjeta. El CTA muestra su propio estado de carga mientras la seleccion
 * esta en vuelo (y los demas CTAs quedan deshabilitados para no encadenar dos cambios).
 */
function PlanCard({
  plan,
  currentTier,
  busy,
  disabled,
  onSelect,
}: {
  plan: Plan;
  currentTier: ProfileTier | undefined;
  /** true mientras la seleccion de ESTE plan esta en vuelo. */
  busy: boolean;
  /** true mientras cualquier seleccion esta en vuelo (bloquea los otros CTAs). */
  disabled: boolean;
  onSelect: (planId: PlanId) => void;
}) {
  const isCurrent = currentTier !== undefined && plan.tier === currentTier;

  return (
    <section
      className={`flex flex-col rounded-[14px] bg-surface p-[22px] ${
        plan.recommended ? 'border border-[#D3D1C7]' : 'border-[0.5px] border-[#E9E7DF]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-medium text-ink">{plan.name}</h2>
        <div className="flex items-center gap-1.5">
          {plan.recommended && <span className={pillClass}>Recomendado</span>}
          {isCurrent && (
            <span className={pillClass}>
              <Check className="h-3 w-3 flex-none text-[#1D9E75]" aria-hidden="true" />
              Tu plan
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 text-[26px] font-medium tracking-[-0.01em] text-ink">
        {plan.price}
        <span className="text-[13px] font-normal text-[#B4B2A9]"> {plan.priceSuffix}</span>
      </p>
      <p className="mt-1 font-mono text-[11.5px] text-[#5F5E5A]">{plan.runsLine}</p>

      {/* Features como termino + definicion (el patron de los gates), sin bullets ni iconos. */}
      <dl className="mt-5 flex-1 space-y-3 border-t-[0.5px] border-[#F1EFE8] pt-5">
        {plan.features.map((feature) => (
          <div key={feature.term}>
            <dt className="text-[12px] font-medium text-ink">{feature.term}</dt>
            <dd className="text-[12.5px] text-[#8A8880]">{feature.text}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        {isCurrent ? (
          <Button type="button" variant="secondary-neutral" size="sm" disabled className="w-full">
            Plan actual
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={disabled}
            onClick={() => onSelect(plan.id)}
          >
            {busy ? 'Activando...' : `Elegir ${plan.name}`}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * CATALOGO DE PAQUETES (/configuracion/paquetes): los tres planes en grid de 3 columnas (apilados en
 * angosto). Lee el tier real de ['me'] para marcar el plan actual y dispara la SELECCION SELF-SERVICE
 * (useSelectPlan -> POST /v1/subscription/select): el backend activa el plan al instante (lanzamiento
 * gratuito) y devuelve el estado consolidado, que refresca la cache ['me'] -> el plan elegido pasa a
 * "Tu plan" y los gates de Recetas/Tareas/Triggers se desbloquean sin recargar. Un DOWNGRADE pide
 * confirmacion antes (puede desactivar la autonomia); un upgrade se aplica directo. Vive dentro del
 * shell de Configuracion (SettingsLayout pone titulo y tabs).
 */
export function PlansPage() {
  const { data } = useMe();
  const selectPlan = useSelectPlan();
  // Mientras ['me'] no resuelve, el catalogo se muestra sin marca de plan actual (sin bloquear la vista).
  const currentTier = data?.profile?.tier;

  const [notice, setNotice] = useState<NoticeData | null>(null);
  // Plan cuyo downgrade espera confirmacion en el dialogo (null = dialogo cerrado).
  const [pendingDowngrade, setPendingDowngrade] = useState<PlanId | null>(null);
  // Plan cuya activacion esta en vuelo, para el estado de carga de SU boton.
  const [selectingId, setSelectingId] = useState<PlanId | null>(null);

  function activate(planId: PlanId) {
    setNotice(null);
    setSelectingId(planId);
    selectPlan.mutate(planId, {
      onSuccess: () => {
        setPendingDowngrade(null);
        setNotice({ kind: 'ok', text: 'Listo. Tu plan ya esta activo.' });
      },
      // Error visible y NO destructivo: el catalogo queda intacto y el CTA vuelve a estar disponible.
      onError: (err) => setNotice({ kind: 'error', text: selectPlanErrorMessage(err) }),
      onSettled: () => setSelectingId(null),
    });
  }

  function onSelectPlan(planId: PlanId) {
    // DOWNGRADE: confirmar antes (puede desactivar autonomia). Upgrade o cambio lateral: directo.
    if (currentTier !== undefined && isDowngrade(currentTier, planId)) {
      setNotice(null);
      setPendingDowngrade(planId);
      return;
    }
    activate(planId);
  }

  const downgradePlan = PLANS.find((plan) => plan.id === pendingDowngrade);

  return (
    <div className="mt-8">
      <p className="text-xs text-[#8A8880]">{LAUNCH_NOTICE}</p>
      <Notice notice={notice} />
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            currentTier={currentTier}
            busy={selectingId === plan.id}
            disabled={selectPlan.isPending}
            onSelect={onSelectPlan}
          />
        ))}
      </div>

      {downgradePlan && (
        <DowngradePlanDialog
          open
          planName={downgradePlan.name}
          losses={currentTier ? downgradeLossSummary(currentTier, downgradePlan.id) : []}
          busy={selectPlan.isPending}
          onConfirm={() => activate(downgradePlan.id)}
          onCancel={() => setPendingDowngrade(null)}
        />
      )}
    </div>
  );
}
