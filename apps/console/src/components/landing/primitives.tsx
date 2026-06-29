import { type JSX } from 'react';
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
const PRIMITIVES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: RefreshCw,
    title: 'Modelo intercambiable',
    description:
      'Conecta Claude, ChatGPT o modelos open source con tu propia llave (BYOK). El proveedor se cambia por configuración; el agente, sus herramientas y sus integraciones permanecen intactos.'
  },
  {
    icon: ShieldCheck,
    title: 'Aislamiento multi-tenant',
    description:
      'Cada cliente opera en un entorno aislado, con sus propios datos, credenciales y configuración. Sin cruce entre cuentas, y tu información nunca se usa para entrenar modelos.'
  },
  {
    icon: Users,
    title: 'Control de acceso y roles',
    description:
      'Usuarios, permisos y espacios de trabajo por área. El acceso se otorga por invitación y por rol, bajo el principio de menor privilegio.'
  },
  {
    icon: KeyRound,
    title: 'Credenciales revocables',
    description:
      'Cada integración usa una credencial propia, de alcance acotado y revocación inmediata. Otorgas o retiras acceso sin afectar al resto del sistema.'
  },
  {
    icon: BarChart3,
    title: 'Trazabilidad y auditoría',
    description:
      'Cada ejecución se registra: entrada, contexto, modelo y respuesta. Un historial auditable de qué hizo el agente, cuándo y con qué datos.'
  },
  {
    icon: Puzzle,
    title: 'Integración nativa',
    description:
      'El agente opera dentro de tus sistemas (ERP, CRM, correo, datos) a través de herramientas conectadas. Trabaja donde ya está tu equipo, no en una interfaz separada.'
  }
];

/**
 * Seccion "El cuerpo": las 6 primitivas que rodean al cerebro intercambiable.
 */
export function Primitives(): JSX.Element {
  return (
    <section id="plataforma" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>Independiente del modelo</Eyebrow>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            La infraestructura que un modelo no te da
          </h2>
          <p className="mt-4 text-lg text-foreground-secondary">
            Un LLM razona, pero no aísla clientes, no controla accesos, no deja
            rastro auditable ni se conecta a tus sistemas. Eso lo aporta la
            plataforma: una capa reutilizable que sostiene a cualquier proveedor
            y no rehaces cuando lo cambias.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
          {PRIMITIVES.map((primitive) => {
            const Icon = primitive.icon;
            return (
              <div key={primitive.title} className="bg-background-secondary p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10">
                  <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                  {primitive.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                  {primitive.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
