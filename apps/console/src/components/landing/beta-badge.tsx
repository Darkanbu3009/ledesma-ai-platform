import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * Etiqueta "Beta" de la landing: marca de forma inequivoca las capacidades que estan en
 * desarrollo (reservar, comprar, pagar, voz). La comparten los chips de la seccion de
 * capacidades y las respuestas beta del chat animado, para que la marca sea identica en
 * toda la pagina: pildora brasa en JetBrains Mono con punto que "late" (motion-safe).
 */
export function BetaBadge({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-jetbrains text-[10px] font-semibold uppercase tracking-[0.08em] text-accent',
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" />
      {t('landing.comun.beta')}
    </span>
  );
}
