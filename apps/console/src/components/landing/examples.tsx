import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Receipt,
  Calculator,
  Headset,
  Sparkles,
  ArrowRight,
  type LucideIcon
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Eyebrow } from './eyebrow';
import { REVEAL_KEYFRAMES, revealAnimationClass, useRevealOnScroll } from './use-reveal-on-scroll';
import { AGENTS, type AgentId } from '../../lib/landing-agents';

/**
 * Iconos de los agentes de ejemplo siguiendo el mapeo del mockup (Tabler -> lucide):
 * file-invoice -> Receipt, calculator -> Calculator, headset -> Headset. El nombre y
 * el orden se reutilizan de agents.config.
 */
const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  ap: Receipt,
  quotations: Calculator,
  cs: Headset
};

/**
 * Copy de cada tarjeta especifico de esta seccion (tagline en una linea +
 * descripcion). Vive aqui, y no en agents.config, para no alterar el copy que ese
 * mismo config alimenta en el dashboard y el workspace del agente: el alcance es
 * solo la landing.
 */
const AGENT_COPY: Record<AgentId, { taglineKey: string; descripcionKey: string }> = {
  ap: {
    taglineKey: 'landing.ejemplos.agentes.ap.tagline',
    descripcionKey: 'landing.ejemplos.agentes.ap.descripcion'
  },
  quotations: {
    taglineKey: 'landing.ejemplos.agentes.quotations.tagline',
    descripcionKey: 'landing.ejemplos.agentes.quotations.descripcion'
  },
  cs: {
    taglineKey: 'landing.ejemplos.agentes.cs.tagline',
    descripcionKey: 'landing.ejemplos.agentes.cs.descripcion'
  }
};

/**
 * Seccion "Ejemplos en vivo": tres tarjetas de agente (cada una con el tag "Ejemplo
 * en vivo") y, debajo, un panel que aclara que esos tres son solo ejemplos y que se
 * construye cualquier agente a la medida.
 */
export function Examples(): JSX.Element {
  const { t } = useTranslation();
  // Dos observadores independientes: la grilla de agentes revela sus tres tarjetas
  // con stagger, y el panel "¿Otro proceso en mente?" revela cuando el mismo entra
  // al viewport (queda mas abajo, no tendria sentido animarlo fuera de pantalla).
  const { ref: gridRef, revealed: gridRevealed } = useRevealOnScroll<HTMLDivElement>();
  const { ref: panelRef, revealed: panelRevealed } = useRevealOnScroll<HTMLDivElement>();

  return (
    <section id="ejemplos" className="border-t border-border">
      <style>{REVEAL_KEYFRAMES}</style>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t('landing.ejemplos.eyebrow')}</Eyebrow>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground min-[420px]:text-3xl sm:text-4xl">
            {t('landing.ejemplos.titulo')}
          </h2>
          <p className="mt-4 text-base text-foreground-secondary sm:text-lg">
            <strong className="font-semibold text-foreground">
              {t('landing.ejemplos.introDestacado')}
            </strong>{' '}
            {t('landing.ejemplos.introResto')}
          </p>
        </div>

        <div ref={gridRef} className="mt-12 grid gap-6 min-[900px]:grid-cols-3">
          {AGENTS.map((agent, index) => {
            const Icon = AGENT_ICONS[agent.id];
            const copy = AGENT_COPY[agent.id];
            return (
              <div
                key={agent.id}
                className={`group flex flex-col rounded-2xl border border-border bg-background-secondary p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-accent/30 hover:shadow-md ${revealAnimationClass(gridRevealed)}`}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10">
                    <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                  </div>
                  <Badge
                    variant="outline"
                    className="gap-1.5 rounded-full border-accent/20 bg-accent/10 px-2 py-0.5 text-accent"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                    {t('landing.ejemplos.badgeEjemploEnVivo')}
                  </Badge>
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                  {t(agent.nameKey)}
                </h3>
                <p className="mt-1.5 text-sm font-medium text-foreground/75">
                  {t(copy.taglineKey)}
                </p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground-secondary">
                  {t(copy.descripcionKey)}
                </p>
                <Link
                  to="/crear-cuenta"
                  className="mt-6 inline-flex items-center gap-1.5 rounded-sm font-medium text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {t('landing.comun.crearCuenta')}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </div>
            );
          })}
        </div>

        {/* Panel "¿Otro proceso en mente?": deja claro que los tres de arriba son
            solo ejemplos. Tinte brasa muy sutil para destacar del resto de la
            seccion; apila en pantallas chicas (icono/texto arriba, boton abajo). */}
        <div
          ref={panelRef}
          className={`mt-6 rounded-2xl border border-accent/20 bg-accent/5 p-6 sm:p-8 ${revealAnimationClass(panelRevealed)}`}
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4 md:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
              </div>
              <div className="max-w-2xl">
                <h3 className="font-display text-xl font-semibold text-foreground">
                  {t('landing.ejemplos.otroProcesoTitulo')}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
                  {t('landing.ejemplos.otroProcesoIntro')}{' '}
                  <strong className="font-semibold text-foreground">
                    {t('landing.ejemplos.otroProcesoDestacado')}
                  </strong>{' '}
                  {t('landing.ejemplos.otroProcesoResto')}
                </p>
              </div>
            </div>
            <Button asChild className="w-full shrink-0 md:w-auto">
              <Link to="/crear-cuenta">
                {t('landing.ejemplos.cuentanosTuCaso')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
