import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, Sparkles } from 'lucide-react';
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
  /** Nota muted del paso bloqueado (sustituye al CTA hasta que el paso previo se cumpla). */
  blockedNote: string;
}

/** Estado visual de un renglon: el activo manda; los demas quedan hechos o bloqueados. */
type StepStatus = 'done' | 'active' | 'blocked';

/**
 * Circulo de estado del paso: check si esta hecho, numero relleno brasa si es el activo, numero
 * delineado gris si esta bloqueado.
 */
function StepCircle({ status, number }: { status: StepStatus; number: number }) {
  if (status === 'done') {
    return (
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-ok/10 text-ok">
        <Check className="h-4 w-4" />
        <span className="sr-only">Completado</span>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brasa text-[12.5px] font-semibold text-white">
        {number}
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-line text-[12.5px] font-medium text-muted-soft">
      {number}
    </span>
  );
}

/**
 * Un renglon del checklist. Jerarquia: el paso ACTIVO lleva fondo tinte brasa suave, border tinte y el
 * UNICO CTA solido de la lista; los bloqueados van en gris sin boton (una nota muted explica el orden);
 * los hechos muestran el check y su sello "Hecho".
 */
function StepRow({ step, status, number }: { step: OnboardingStep; status: StepStatus; number: number }) {
  const active = status === 'active';
  return (
    <li
      className={[
        'flex items-center gap-3 rounded-[10px] border px-3 py-2',
        active ? 'border-brasa-line bg-brasa/[0.04]' : 'border-transparent',
      ].join(' ')}
    >
      <StepCircle status={status} number={number} />
      <div className="min-w-0 flex-1">
        <p className={active ? 'text-sm font-semibold text-ink' : 'text-sm font-medium text-muted'}>
          {step.title}
        </p>
        {active && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{step.description}</p>}
      </div>
      {status === 'done' ? (
        <span className="inline-flex flex-none items-center gap-1.5 text-[12.5px] font-semibold text-ok">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Hecho
        </span>
      ) : active && step.href ? (
        <Link
          to={step.href}
          aria-label={step.cta}
          className={`inline-flex flex-none items-center gap-1.5 rounded-[10px] bg-brasa px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-brasa-hover ${focusRing}`}
        >
          {step.cta}
          <ArrowRight className="h-[15px] w-[15px]" />
        </Link>
      ) : (
        // Paso sin CTA: bloqueado (va despues del anterior) o activo sin destino todavia (p. ej.
        // "Ejecutar" antes de crear un agente). El motivo se muestra como texto VISIBLE (accesible por
        // teclado y lector), veraz -- no promete una pantalla que aun no existe para este usuario.
        <span className="flex-none text-[12.5px] font-medium text-muted-soft">{step.blockedNote}</span>
      )}
    </li>
  );
}

/** Progreso segmentado: un bloque por paso; los hechos y el activo en brasa, los pendientes en gris. */
function SegmentedProgress({ completedCount }: { completedCount: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={completedCount}
      aria-valuemin={0}
      aria-valuemax={ONBOARDING_STEP_COUNT}
      aria-label={`${completedCount} de ${ONBOARDING_STEP_COUNT} pasos completados`}
      className="mt-3 flex gap-1"
    >
      {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
        <span
          key={i}
          className={[
            'h-1 flex-1 rounded-[2px]',
            i <= completedCount ? 'bg-brasa' : 'bg-line-soft',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

/**
 * BIENVENIDA + CHECKLIST de primeros pasos para el dashboard, fusionados en UNA tarjeta: header tintado
 * con la bienvenida (solo para usuarios nuevos) y cuerpo con el checklist. Reduce el time-to-value dando
 * un hilo guiado (credencial -> agente -> ejecucion) cuyo progreso se DERIVA de datos reales via
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
      blockedNote: 'Empieza por aqui',
    },
    {
      id: 'agent',
      title: 'Crea tu primer agente',
      description: 'Define que hace y con que modelo. Podes crearlo conversando con el Configurador.',
      done: hasAgent,
      href: '/configurador',
      cta: 'Crear agente',
      blockedNote: 'Despues del paso 1',
    },
    {
      id: 'run',
      title: 'Ejecuta tu agente',
      description: 'Probalo en el Playground y observa tu primera corrida.',
      done: hasRun,
      // Sin agente todavia no hay Playground al que ir: el CTA queda deshabilitado hasta que exista uno.
      href: firstAgentId ? playgroundPath(firstAgentId) : undefined,
      cta: 'Ejecutar',
      // Sin agente el motivo veraz es crearlo (texto que la pantalla ya usaba); con agente, el orden.
      blockedNote: firstAgentId ? 'Despues del paso 2' : 'Crea un agente primero',
    },
  ];

  // La bienvenida solo aparece cuando NADA esta hecho (usuario nuevo); al avanzar (>=1 paso) se retira.
  const showWelcome = completedCount === 0;
  // El paso ACTIVO es el primer pendiente (siempre existe mientras !isComplete); tambien alimenta el CTA
  // "Empezar" de la bienvenida. Los pendientes que le siguen quedan bloqueados.
  const firstPendingIndex = steps.findIndex((step) => !step.done);
  const firstPending = steps[firstPendingIndex];

  return (
    <section
      aria-labelledby="onboarding-title"
      className="mt-4 overflow-hidden rounded-xl border-[0.5px] border-line bg-surface"
    >
      {showWelcome && (
        <div className="flex flex-col gap-4 border-b border-line-soft bg-brasa-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa text-white">
              <Sparkles className="h-[19px] w-[19px]" />
            </span>
            <div>
              <h2 className="font-display text-[19px] font-bold leading-tight text-ink">
                Bienvenido a {PRODUCT_NAME}
              </h2>
              <p className="mt-1 text-[13.5px] text-muted">
                Tu primer agente funcionando en 3 pasos · ~4 min
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

      <div className="px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="onboarding-title" className="font-display text-[15px] font-bold text-ink">
            Primeros pasos
          </h2>
          <span className="flex-none text-[12.5px] font-semibold text-muted">
            {completedCount} de {ONBOARDING_STEP_COUNT}
          </span>
        </div>

        <SegmentedProgress completedCount={completedCount} />

        <ol className="mt-2.5 flex flex-col gap-1">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              number={index + 1}
              status={step.done ? 'done' : index === firstPendingIndex ? 'active' : 'blocked'}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
