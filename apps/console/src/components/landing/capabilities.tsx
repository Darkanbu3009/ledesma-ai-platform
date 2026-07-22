import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Plane, ShoppingCart, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { BetaBadge } from './beta-badge';
import { Eyebrow } from './eyebrow';
import { REVEAL_KEYFRAMES, revealAnimationClass, useRevealOnScroll } from './use-reveal-on-scroll';

/**
 * Capacidades del dia a dia que estan EN DESARROLLO (reservar, comprar, viajar, voz).
 * Cada chip lleva la etiqueta Beta compartida de la landing: se muestran como lo que
 * viene, nunca como acciones ya disponibles o ejecutadas.
 */
const CHIPS: { icon: LucideIcon; labelKey: string }[] = [
  { icon: UtensilsCrossed, labelKey: 'landing.capacidades.chips.reservarMesa' },
  { icon: ShoppingCart, labelKey: 'landing.capacidades.chips.comprarMejorPrecio' },
  { icon: Plane, labelKey: 'landing.capacidades.chips.planearViaje' },
  { icon: Mic, labelKey: 'landing.capacidades.chips.conTuVoz' }
];

/**
 * Seccion "Todo con un mensaje" (id `capacidades`): la cara del asistente universal para
 * personas. Chips de capacidades en beta, cada uno con su etiqueta. En movil los chips
 * fluyen en columna a lo ancho; desde ~640px pasan a fila envolvente.
 */
export function Capabilities(): JSX.Element {
  const { t } = useTranslation();
  const { ref: listRef, revealed } = useRevealOnScroll<HTMLUListElement>();

  return (
    <section id="capacidades" className="border-t border-border">
      <style>{REVEAL_KEYFRAMES}</style>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t('landing.capacidades.eyebrow')}</Eyebrow>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground min-[420px]:text-3xl sm:text-4xl">
            {t('landing.capacidades.titulo')}
          </h2>
          <p className="mt-4 text-base text-foreground-secondary sm:text-lg">
            {t('landing.capacidades.descripcion')}
          </p>
        </div>

        <ul ref={listRef} className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {CHIPS.map((chip, index) => {
            const Icon = chip.icon;
            return (
              <li
                key={chip.labelKey}
                className={`flex items-center gap-3 rounded-xl border border-border bg-background-secondary px-4 py-3.5 shadow-sm ${revealAnimationClass(revealed)}`}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                  <Icon className="h-[18px] w-[18px] text-accent" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground sm:flex-none">
                  {t(chip.labelKey)}
                </span>
                <BetaBadge />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
