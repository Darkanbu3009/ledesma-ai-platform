import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, CheckCircle2, KeyRound, MessageCircle, Sparkles } from 'lucide-react';
import { useOnboardingProgress } from '../../lib/queries';
import { ONBOARDING_STEP_COUNT } from '../../lib/onboarding';
import { playgroundPath } from '../../lib/agents';
import { focusRing } from '../../lib/utils';
import { Button } from '../ui/button';

/** Nombre del producto, alineado con el sidebar. */
const PRODUCT_NAME = 'Ledesma AI Labs';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  /** Destino del CTA. undefined = paso aun no accionable (p. ej. "Ejecutar" sin agente todavia). */
  href?: string;
  cta: string;
  icon: typeof KeyRound;
}

/** Icono de estado del paso: check en verde si esta hecho, o el icono del paso (neutro) si esta pendiente. */
function StepIcon({ done, Icon }: { done: boolean; Icon: typeof KeyRound }) {
  if (done) {
    return (
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ok/10 text-ok">
        <CheckCircle2 className="h-5 w-5" />
        <span className="sr-only">Completado</span>
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-line bg-field text-muted">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Un renglon del checklist: icono de estado + titulo/descripcion + CTA (o "Hecho" si ya se cumplio). */
function StepRow({ step }: { step: OnboardingStep }) {
  return (
    <li className="flex items-center gap-3.5 py-3.5">
      <StepIcon done={step.done} Icon={step.icon} />
      <div className="min-w-0 flex-1">
        <p className={step.done ? 'text-sm font-medium text-muted' : 'text-sm font-semibold text-ink'}>
          {step.title}
        </p>
        {!step.done && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{step.description}</p>}
      </div>
      {step.done ? (
        <span className="inline-flex flex-none items-center gap-1.5 text-[12.5px] font-semibold text-ok">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Hecho
        </span>
      ) : step.href ? (
        <Link
          to={step.href}
          aria-label={step.cta}
          className={`inline-flex flex-none items-center gap-1.5 rounded-[10px] border border-brasa-line bg-brasa-soft px-3 py-2 text-[13px] font-semibold text-brasa transition hover:bg-brasa hover:text-white ${focusRing}`}
        >
          {step.cta}
          <ArrowRight className="h-[15px] w-[15px]" />
        </Link>
      ) : (
        // Paso sin destino todavia (p. ej. "Ejecutar" antes de crear un agente): en vez de un CTA muerto
        // se muestra el motivo como texto VISIBLE (accesible por teclado y lector), veraz -- no promete
        // una pantalla que aun no existe para este usuario.
        <span className="flex-none text-[12.5px] font-medium text-muted">Crea un agente primero</span>
      )}
    </li>
  );
}

/**
 * BIENVENIDA + CHECKLIST de primeros pasos para el dashboard. Reduce el time-to-value dando un hilo
 * guiado (credencial -> agente -> ejecucion) cuyo progreso se DERIVA de datos reales via
 * useOnboardingProgress -- no de checkboxes manuales, sin estado en el cliente. No es intrusivo:
 *  - Mientras carga o cuando el onboarding ya esta completo, NO renderiza nada (desaparece solo).
 *  - La bienvenida corona el checklist SOLO cuando no hay nada hecho (usuario nuevo) y se va al avanzar.
 * No bloquea la navegacion: es una tarjeta mas del Panel que el usuario puede ignorar.
 */
export function OnboardingChecklist(): ReactNode {
  const { hasCredential, hasAgent, hasRun, completedCount, isComplete, firstAgentId, isLoading, isError } =
    useOnboardingProgress();

  // No se muestra: mientras carga (evita parpadear "0 de 3"), ante error (no afirmar un estado sin
  // confirmar por el dato real) o cuando ya esta completo (no molestar a usuarios establecidos).
  if (isLoading || isError || isComplete) return null;

  const steps: OnboardingStep[] = [
    {
      id: 'credential',
      title: 'Conecta tu primer proveedor (API key)',
      description: 'Guarda una credencial (Anthropic, OpenAI o compatible) para que tus agentes puedan ejecutar.',
      done: hasCredential,
      href: '/credenciales',
      cta: 'Poner credencial',
      icon: KeyRound,
    },
    {
      id: 'agent',
      title: 'Crea tu primer agente',
      description: 'Define que hace y con que modelo. Podes crearlo conversando con el Configurador.',
      done: hasAgent,
      href: '/configurador',
      cta: 'Crear agente',
      icon: Bot,
    },
    {
      id: 'run',
      title: 'Ejecuta tu agente',
      description: 'Probalo en el Playground y observa tu primera corrida.',
      done: hasRun,
      // Sin agente todavia no hay Playground al que ir: el CTA queda deshabilitado hasta que exista uno.
      href: firstAgentId ? playgroundPath(firstAgentId) : undefined,
      cta: 'Ejecutar',
      icon: MessageCircle,
    },
  ];

  // La bienvenida solo aparece cuando NADA esta hecho (usuario nuevo); al avanzar (>=1 paso) se retira.
  const showWelcome = completedCount === 0;
  // CTA de la bienvenida: lleva al PRIMER paso pendiente (siempre existe mientras !isComplete).
  const firstPending = steps.find((step) => !step.done);
  const progressPct = Math.round((completedCount / ONBOARDING_STEP_COUNT) * 100);

  return (
    <section
      aria-labelledby="onboarding-title"
      className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
    >
      {showWelcome && (
        <div className="flex flex-col gap-4 border-b border-line-soft bg-brasa-soft px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-brasa text-white shadow-brasa">
              <Sparkles className="h-[22px] w-[22px]" />
            </span>
            <div>
              <h2 className="font-display text-[19px] font-bold leading-tight text-ink">
                Bienvenido a {PRODUCT_NAME}
              </h2>
              <p className="mt-1 text-[13.5px] text-muted">
                Vamos a poner tu primer agente a funcionar en 3 pasos.
              </p>
            </div>
          </div>
          {firstPending?.href && (
            <Button asChild className="flex-none self-start sm:self-auto">
              <Link to={firstPending.href}>
                Empezar
                <ArrowRight className="h-[17px] w-[17px]" />
              </Link>
            </Button>
          )}
        </div>
      )}

      <div className="px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="onboarding-title" className="font-display text-[15px] font-bold text-ink">
            Primeros pasos
          </h2>
          <span className="flex-none text-[12.5px] font-semibold text-muted">
            {completedCount} de {ONBOARDING_STEP_COUNT}
          </span>
        </div>

        {/* Barra de progreso: fill en brasa proporcional a los pasos hechos. */}
        <div
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={ONBOARDING_STEP_COUNT}
          aria-label={`${completedCount} de ${ONBOARDING_STEP_COUNT} pasos completados`}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
        >
          <div
            className="h-full rounded-full bg-brasa transition-[width] duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <ol className="mt-2 divide-y divide-line-soft">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ol>
      </div>
    </section>
  );
}
