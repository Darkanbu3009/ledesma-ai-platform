import { type JSX } from 'react';
import { Eyebrow } from './eyebrow';

const STEPS = [
  {
    num: '01',
    title: 'Nos cuentas tu proceso',
    description:
      'Nos dices qué quieres automatizar: cuentas por pagar, cotizaciones, soporte o el flujo que tu operación necesite. Identificamos dónde un agente aporta más valor.'
  },
  {
    num: '02',
    title: 'Lo configuramos e integramos',
    description:
      'Montamos el agente sobre nuestra plataforma, con el modelo que elijas (BYOK), y lo conectamos a tus sistemas. Como la infraestructura ya está lista, lo tienes en semanas, no en meses.'
  },
  {
    num: '03',
    title: 'Queda operando en tu negocio',
    description:
      'El agente trabaja dentro de tus sistemas, ejecutando trabajo real. Lo ajustamos y sumamos nuevos agentes conforme crece tu operación.'
  }
];

/**
 * Seccion "Como funciona": los tres pasos del showroom (01 / 02 / 03).
 */
export function HowItWorks(): JSX.Element {
  return (
    <section id="como-funciona" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>Cómo funciona</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            De tu proceso a un agente en producción
          </h2>
          <p className="mt-4 text-lg text-foreground-secondary">
            Sin proyectos de meses. La plataforma ya está construida; nosotros configuramos e
            integramos el agente a la medida de tu operación.
          </p>
        </div>

        <ol className="mt-12 grid gap-8 min-[900px]:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.num} className="border-t border-border pt-6">
              <p className="font-jetbrains text-3xl font-semibold text-accent">{step.num}</p>
              <h3 className="mt-3 font-display text-lg font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
