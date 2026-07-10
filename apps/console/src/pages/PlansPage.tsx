import { Check } from 'lucide-react';
import { useMe } from '../lib/queries';
import { LAUNCH_NOTICE, PLANS, type Plan, type PlanId } from '../lib/plans';
import type { ProfileTier } from '../lib/registration';
import { Button } from '../components/ui/button';

/**
 * STUB DELIBERADO: la contratacion/cambio de plan (escrituras a subscriptions/tier) se implementa en
 * el PR de medios de pago. Este catalogo es solo lectura: el CTA queda cableado a este handler para
 * que ese PR lo sustituya sin tocar la estructura de las tarjetas.
 */
function onSelectPlan(planId: PlanId): void {
  void planId;
}

/** Pill greige compartida por "Recomendado" y "Tu plan" (misma escala que los pills del perfil). */
const pillClass =
  'inline-flex items-center gap-1 rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[11.5px] text-[#444441]';

/**
 * Tarjeta de un plan: superficie blanca plana con hairline; el recomendado (Pro) lleva borde firme
 * de 1px y pill "Recomendado". El plan que el usuario YA tiene se marca con el pill "Tu plan" (check
 * verde, unico verde de la tarjeta) y su CTA queda deshabilitado; en el resto, el CTA brasa es el
 * unico acento brasa de la tarjeta. Recibe onSelect como prop: PR 2 solo cambia el handler que la
 * pagina inyecta (hooks de mutacion incluidos), sin tocar la tarjeta.
 */
function PlanCard({
  plan,
  currentTier,
  onSelect,
}: {
  plan: Plan;
  currentTier: ProfileTier | undefined;
  onSelect: (planId: PlanId) => void;
}) {
  // Mientras ['me'] no resuelve, currentTier es undefined y no matchea ningun tier: sin plan actual.
  const isCurrent = plan.tier === currentTier;

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
          <Button type="button" size="sm" className="w-full" onClick={() => onSelect(plan.id)}>
            Elegir {plan.name}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * CATALOGO DE PAQUETES (/configuracion/paquetes): los tres planes en grid de 3 columnas (apilados en
 * angosto), leyendo el tier real de ['me'] SOLO para marcar el plan actual. Vive dentro del shell de
 * Configuracion (SettingsLayout pone titulo y tabs). Sin escrituras: el CTA llama al stub onSelectPlan.
 */
export function PlansPage() {
  const { data } = useMe();
  // Mientras ['me'] no resuelve, el catalogo se muestra sin marca de plan actual (sin bloquear la vista).
  const currentTier = data?.profile?.tier;

  return (
    <div className="mt-8">
      <p className="text-xs text-[#8A8880]">{LAUNCH_NOTICE}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} currentTier={currentTier} onSelect={onSelectPlan} />
        ))}
      </div>
    </div>
  );
}
