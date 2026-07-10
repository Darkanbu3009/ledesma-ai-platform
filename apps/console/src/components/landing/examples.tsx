import { type JSX } from 'react';
import { Link } from 'react-router-dom';
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
const AGENT_COPY: Record<AgentId, { tagline: string; description: string }> = {
  ap: {
    tagline: 'Procesa y valida facturas sin captura manual',
    description:
      'Lee cada factura, extrae los datos y los valida contra tu ERP y tus reglas. Detecta duplicados y errores antes de que se paguen. Cierras más rápido y sin captura manual.'
  },
  quotations: {
    tagline: 'Arma cotizaciones complejas en minutos',
    description:
      'Aplica tus precios, márgenes y reglas comerciales al instante. Lo que tomaba horas de ida y vuelta queda en minutos, sin errores de cálculo.'
  },
  cs: {
    tagline: 'Resuelve tickets y consultas al instante',
    description:
      'Responde con el contexto de tu negocio y acceso a tus sistemas, 24/7. No solo contesta: actualiza pedidos, consulta datos y escala a tu equipo solo cuando hace falta.'
  }
};

/**
 * Seccion "Ejemplos en vivo": tres tarjetas de agente (cada una con el tag "Ejemplo
 * en vivo") y, debajo, un panel que aclara que esos tres son solo ejemplos y que se
 * construye cualquier agente a la medida.
 */
export function Examples(): JSX.Element {
  return (
    <section id="ejemplos" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>Ejemplos en vivo</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Una plataforma, muchos agentes
          </h2>
          <p className="mt-4 text-lg text-foreground-secondary">
            <strong className="font-semibold text-foreground">
              Agentes que no solo responden: ejecutan trabajo real.
            </strong>{' '}
            Todos corren sobre la misma plataforma, con las integraciones, la
            seguridad y la trazabilidad ya resueltas. Cuentas por pagar,
            cotizaciones, soporte… o el proceso que tu operación necesite.
          </p>
        </div>

        <div className="mt-12 grid gap-6 min-[900px]:grid-cols-3">
          {AGENTS.map((agent) => {
            const Icon = AGENT_ICONS[agent.id];
            const copy = AGENT_COPY[agent.id];
            return (
              <div
                key={agent.id}
                className="group flex flex-col rounded-2xl border border-border bg-background-secondary p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-accent/30 hover:shadow-md"
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
                    Ejemplo en vivo
                  </Badge>
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                  {agent.name}
                </h3>
                <p className="mt-1.5 text-sm font-medium text-foreground/75">
                  {copy.tagline}
                </p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground-secondary">
                  {copy.description}
                </p>
                <Link
                  to="/crear-cuenta"
                  className="mt-6 inline-flex items-center gap-1.5 rounded-sm font-medium text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Crear cuenta
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
        <div className="mt-6 rounded-2xl border border-accent/20 bg-accent/5 p-6 sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4 md:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
              </div>
              <div className="max-w-2xl">
                <h3 className="font-display text-xl font-semibold text-foreground">
                  ¿Otro proceso en mente?
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
                  Estos tres son solo ejemplos.{' '}
                  <strong className="font-semibold text-foreground">
                    La misma plataforma se adapta a cualquier proceso de tu
                    operación:
                  </strong>{' '}
                  conciliaciones, onboarding, reportes, generación de
                  documentos, lo que necesites. Tú describes el proceso;
                  nosotros lo construimos y lo desplegamos.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link to="/crear-cuenta">
                Cuéntanos tu caso
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
