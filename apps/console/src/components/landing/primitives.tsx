import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  ShieldCheck,
  Users,
  KeyRound,
  BarChart3,
  Puzzle,
  type LucideIcon
} from 'lucide-react';
import { Eyebrow } from './eyebrow';

/**
 * Las 6 primitivas que forman "el cuerpo" alrededor del cerebro. Los iconos siguen
 * el mapeo del mockup (Tabler -> lucide): refresh, shield/lock, users, key,
 * chart-bar, puzzle.
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
  }
];

/**
 * Seccion "El cuerpo": las 6 primitivas que rodean al cerebro intercambiable.
 */
export function Primitives(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section id="plataforma" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>{t('landing.primitivas.eyebrow')}</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.primitivas.titulo')}
          </h2>
          <p className="mt-4 text-lg text-foreground-secondary">
            {t('landing.primitivas.descripcion')}
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
          {PRIMITIVES.map((primitive) => {
            const Icon = primitive.icon;
            return (
              <div key={primitive.tituloKey} className="bg-background-secondary p-6">
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
