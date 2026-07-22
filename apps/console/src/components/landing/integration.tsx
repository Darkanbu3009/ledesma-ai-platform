import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from './eyebrow';
import { IntegrationChatWidget } from './integration-chat-widget';
import { REVEAL_KEYFRAMES, revealAnimationClass, useRevealOnScroll } from './use-reveal-on-scroll';

/**
 * Los tres pasos del flujo (conectar la cuenta, pedirlo en tu idioma, el agente lo hace).
 * Solo declaran sus claves i18n; numeracion y estilo se resuelven en el render.
 */
const STEPS = [
  {
    num: '01',
    tituloKey: 'landing.integracion.pasos.paso1.titulo',
    descripcionKey: 'landing.integracion.pasos.paso1.descripcion'
  },
  {
    num: '02',
    tituloKey: 'landing.integracion.pasos.paso2.titulo',
    descripcionKey: 'landing.integracion.pasos.paso2.descripcion'
  },
  {
    num: '03',
    tituloKey: 'landing.integracion.pasos.paso3.titulo',
    descripcionKey: 'landing.integracion.pasos.paso3.descripcion'
  }
];

/**
 * Seccion "Conecta una vez. Habla siempre." (id `integracion`, ancla del CTA "Ver como
 * funciona" del hero): a la izquierda los tres pasos del flujo en lenguaje llano; a la
 * derecha el chat animado que muestra la experiencia conversacional (con los ejemplos en
 * beta etiquetados). En pantallas chicas los pasos van arriba y el chat abajo, a una
 * columna, para que ambos respiren desde 360px.
 */
export function Integration(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { ref: stepsRef, revealed } = useRevealOnScroll<HTMLOListElement>();

  return (
    <section id="integracion" className="border-t border-border">
      <style>{REVEAL_KEYFRAMES}</style>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t('landing.integracion.eyebrow')}</Eyebrow>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground min-[420px]:text-3xl sm:text-4xl">
            {t('landing.integracion.titulo')}
          </h2>
          <p className="mt-4 text-base text-foreground-secondary sm:text-lg">
            {t('landing.integracion.descripcion')}
          </p>
        </div>

        <div className="mt-12 grid items-start gap-10 min-[900px]:grid-cols-[1fr_1.05fr] min-[900px]:gap-x-14">
          {/* Los tres pasos, con reveal escalonado al entrar al viewport. */}
          <ol ref={stepsRef} className="flex flex-col gap-8">
            {STEPS.map((step, index) => (
              <li
                key={step.num}
                className={`flex gap-4 border-t border-border pt-6 sm:gap-5 ${revealAnimationClass(revealed)}`}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <p className="font-jetbrains text-2xl font-semibold leading-none text-accent sm:text-3xl">
                  {step.num}
                </p>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {t(step.tituloKey)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-foreground-secondary sm:text-base">
                    {t(step.descripcionKey)}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* Chat ANIMADO: la conversacion del asistente universal (con ejemplos beta
              etiquetados) mas los agentes de empresa en ciclo. La key por idioma remonta
              el widget al cambiar de idioma: el guion arranca de cero en vez de mezclar
              mensajes de dos corridas. */}
          <IntegrationChatWidget key={i18n.language} />
        </div>
      </div>
    </section>
  );
}
