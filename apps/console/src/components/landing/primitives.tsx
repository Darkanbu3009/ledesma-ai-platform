import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  ShieldCheck,
  Users,
  KeyRound,
  BarChart3,
  Puzzle,
  UserCheck,
  type LucideIcon
} from 'lucide-react';
import { Eyebrow } from './eyebrow';
import { REVEAL_KEYFRAMES, revealAnimationClass, useRevealOnScroll } from './use-reveal-on-scroll';

/**
 * Las primitivas que forman "el cuerpo" alrededor del cerebro: las 6 del mockup
 * (refresh, shield/lock, users, key, chart-bar, puzzle) mas la de aprobacion humana
 * ("Tu apruebas lo que importa", checkpoints ya en produccion), que cierra la grilla
 * ocupando el ancho completo de su fila.
 */
const PRIMITIVES: { icon: LucideIcon; tituloKey: string; descripcionKey: string }[] = [
  {
    icon: RefreshCw,
    tituloKey: 'landing.primitivas.items.modeloIntercambiable.titulo',
    descripcionKey: 'landing.primitivas.items.modeloIntercambiable.descripcion'
  },
  {
    icon: ShieldCheck,
    tituloKey: 'landing.primitivas.items.aislamientoMultiTenant.titulo',
    descripcionKey: 'landing.primitivas.items.aislamientoMultiTenant.descripcion'
  },
  {
    icon: Users,
    tituloKey: 'landing.primitivas.items.controlAcceso.titulo',
    descripcionKey: 'landing.primitivas.items.controlAcceso.descripcion'
  },
  {
    icon: KeyRound,
    tituloKey: 'landing.primitivas.items.credencialesRevocables.titulo',
    descripcionKey: 'landing.primitivas.items.credencialesRevocables.descripcion'
  },
  {
    icon: BarChart3,
    tituloKey: 'landing.primitivas.items.trazabilidad.titulo',
    descripcionKey: 'landing.primitivas.items.trazabilidad.descripcion'
  },
  {
    icon: Puzzle,
    tituloKey: 'landing.primitivas.items.integracionNativa.titulo',
    descripcionKey: 'landing.primitivas.items.integracionNativa.descripcion'
  },
  {
    icon: UserCheck,
    tituloKey: 'landing.primitivas.items.apruebasLoQueImporta.titulo',
    descripcionKey: 'landing.primitivas.items.apruebasLoQueImporta.descripcion'
  }
];

/**
 * Seccion "El cuerpo": las 6 primitivas que rodean al cerebro intercambiable.
 */
export function Primitives(): JSX.Element {
  const { t } = useTranslation();
  const { ref: gridRef, revealed } = useRevealOnScroll<HTMLDivElement>();

  return (
    <section id="plataforma" className="border-t border-border">
      <style>{REVEAL_KEYFRAMES}</style>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t('landing.primitivas.eyebrow')}</Eyebrow>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground min-[420px]:text-3xl sm:text-4xl">
            {t('landing.primitivas.titulo')}
          </h2>
          <p className="mt-4 text-base text-foreground-secondary sm:text-lg">
            {t('landing.primitivas.descripcion')}
          </p>
        </div>

        {/* Reveal al hacer scroll: se observa la grilla y cada cuadro entra con
            fade-in + subida, escalonado 80ms segun su orden visual. */}
        <div
          ref={gridRef}
          className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm min-[640px]:grid-cols-2 min-[900px]:grid-cols-3"
        >
          {PRIMITIVES.map((primitive, index) => {
            const Icon = primitive.icon;
            // La ultima tarjeta (aprobacion humana) es la 7a: ocupa el ancho completo de
            // su fila en 2 y 3 columnas para que la grilla no deje celdas vacias.
            const esUltima = index === PRIMITIVES.length - 1;
            return (
              <div
                key={primitive.tituloKey}
                className={`bg-background-secondary p-6 ${
                  esUltima ? 'min-[640px]:col-span-2 min-[900px]:col-span-3' : ''
                } ${revealAnimationClass(revealed)}`}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10">
                  <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                  {t(primitive.tituloKey)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                  {t(primitive.descripcionKey)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
