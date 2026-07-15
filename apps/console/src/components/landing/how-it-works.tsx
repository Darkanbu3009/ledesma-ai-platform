import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from './eyebrow';
import { REVEAL_KEYFRAMES, revealAnimationClass, useRevealOnScroll } from './use-reveal-on-scroll';

const STEPS = [
  {
    num: '01',
    tituloKey: 'landing.comoFunciona.pasos.paso1.titulo',
    descripcionKey: 'landing.comoFunciona.pasos.paso1.descripcion'
  },
  {
    num: '02',
    tituloKey: 'landing.comoFunciona.pasos.paso2.titulo',
    descripcionKey: 'landing.comoFunciona.pasos.paso2.descripcion'
  },
  {
    num: '03',
    tituloKey: 'landing.comoFunciona.pasos.paso3.titulo',
    descripcionKey: 'landing.comoFunciona.pasos.paso3.descripcion'
  }
];

/**
 * Seccion "Como funciona": los tres pasos del showroom (01 / 02 / 03).
 */
export function HowItWorks(): JSX.Element {
  const { t } = useTranslation();
  const { ref: listRef, revealed } = useRevealOnScroll<HTMLOListElement>();

  return (
    <section id="como-funciona" className="border-t border-border">
      <style>{REVEAL_KEYFRAMES}</style>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t('landing.comoFunciona.eyebrow')}</Eyebrow>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground min-[420px]:text-3xl sm:text-4xl">
            {t('landing.comoFunciona.titulo')}
          </h2>
          <p className="mt-4 text-base text-foreground-secondary sm:text-lg">
            {t('landing.comoFunciona.descripcion')}
          </p>
        </div>

        <ol ref={listRef} className="mt-12 grid gap-8 min-[900px]:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.num}
              className={`border-t border-border pt-6 ${revealAnimationClass(revealed)}`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <p className="font-jetbrains text-3xl font-semibold text-accent">{step.num}</p>
              <h3 className="mt-3 font-display text-lg font-semibold text-foreground">
                {t(step.tituloKey)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                {t(step.descripcionKey)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
