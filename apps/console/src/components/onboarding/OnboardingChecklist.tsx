import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { useOnboardingProgress } from '../../lib/queries';
import { ONBOARDING_STEP_COUNT } from '../../lib/onboarding';
import { playgroundPath } from '../../lib/agents';
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
 * Circulo de estado del paso: check ink sobre greige si esta hecho, numero blanco sobre ink solido si
 * es el activo, numero gris delineado si esta bloqueado. Neutros: el brasa queda para el CTA.
 */
function StepCircle({ status, number }: { status: StepStatus; number: number }) {
  if (status === 'done') {
    return (
      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#F1EFE8] text-ink">
        <Check className="h-3.5 w-3.5" />
        <span className="sr-only">Completado</span>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ink text-[12px] font-medium text-white">
        {number}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-[1.5px] border-[#D3D1C7] text-[12px] font-medium text-[#8A8880]">
      {number}
    </span>
  );
}

/**
 * Un renglon del checklist. Jerarquia por bordes, no por tinte: el paso ACTIVO lleva tarjeta blanca con
 * borde firme y el UNICO CTA solido de la lista (variante primaria del boton, el brasa del cuerpo); los
 * bloqueados van en gris sin fondo ni borde (una nota muted explica el orden); los hechos muestran el
 * check greige con el titulo en ink.
 */
function StepRow({ step, status, number }: { step: OnboardingStep; status: StepStatus; number: number }) {
  const active = status === 'active';
  return (
    <li
      className={[
        'flex items-center gap-3 rounded-[10px] border px-3.5 py-3',
        active ? 'border-[#D3D1C7] bg-white' : 'border-transparent',
      ].join(' ')}
    >
      <StepCircle status={status} number={number} />
      <div className="min-w-0 flex-1">
        <p
          className={
            status === 'done'
              ? 'text-[13.5px] text-ink'
              : active
                ? 'text-[13.5px] font-medium text-ink'
                : 'text-[13.5px] text-[#8A8880]'
          }
        >
          {step.title}
        </p>
        {active && (
          <p className="mt-0.5 text-[12.5px] leading-snug text-[#8A8880]">{step.description}</p>
        )}
      </div>
      {active && step.href ? (
        <Button asChild size="sm" className="flex-none text-[13px]">
          <Link to={step.href} aria-label={step.cta}>
            {step.cta}
            <ArrowRight className="h-[15px] w-[15px]" />
          </Link>
        </Button>
      ) : status !== 'done' ? (
        // Paso sin CTA: bloqueado (va despues del anterior) o activo sin destino todavia (p. ej.
        // "Ejecutar" antes de crear un agente). El motivo se muestra como texto VISIBLE (accesible por
        // teclado y lector), veraz -- no promete una pantalla que aun no existe para este usuario.
        <span className="flex-none text-[12.5px] text-[#B4B2A9]">{step.blockedNote}</span>
      ) : null}
    </li>
  );
}

/**
 * Progreso segmentado + contador "N de 3": un bloque por paso; los hechos y el activo en brasa, los
 * pendientes en greige. Compacto (segmentos fijos de ~26x4) para vivir a la derecha de un header.
 */
function SegmentedProgress({ completedCount }: { completedCount: number }) {
  return (
    <div className="flex flex-none items-center gap-2.5">
      <div
        role="progressbar"
        aria-valuenow={completedCount}
        aria-valuemin={0}
        aria-valuemax={ONBOARDING_STEP_COUNT}
        aria-label={`${completedCount} de ${ONBOARDING_STEP_COUNT} pasos completados`}
        className="flex gap-1"
      >
        {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
          <span
            key={i}
            className={[
              'h-1 w-[26px] rounded-[2px]',
              i <= completedCount ? 'bg-brasa' : 'bg-[#E9E7DF]',
            ].join(' ')}
          />
        ))}
      </div>
      <span className="text-[12.5px] text-[#8A8880]">
        {completedCount} de {ONBOARDING_STEP_COUNT}
      </span>
    </div>
  );
}

/**
 * BIENVENIDA + CHECKLIST de primeros pasos para el dashboard, fusionados en UNA tarjeta: header blanco
 * con la bienvenida (solo para usuarios nuevos, separado del cuerpo por un border sutil, con el progreso
 * a la derecha) y cuerpo con el checklist. Reduce el time-to-value dando
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
  // El paso ACTIVO es el primer pendiente (siempre existe mientras !isComplete). Su CTA es la unica
  // accion de la tarjeta (el "Empezar" del banner era redundante: iba al mismo destino). Los pendientes
  // que le siguen quedan bloqueados.
  const firstPendingIndex = steps.findIndex((step) => !step.done);

  return (
    <section
      aria-labelledby="onboarding-title"
      className="mt-4 overflow-hidden rounded-xl border-[0.5px] border-line bg-surface"
    >
      {showWelcome && (
        <div className="flex flex-col gap-4 border-b-[0.5px] border-[#F1EFE8] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa text-white">
              <Sparkles className="h-[19px] w-[19px]" />
            </span>
            <div>
              <h2 id="onboarding-title" className="font-display text-[19px] font-bold leading-tight text-ink">
                Bienvenido a {PRODUCT_NAME}
              </h2>
              <p className="mt-1 text-[13.5px] text-[#8A8880]">
                Tu primer agente funcionando en 3 pasos · ~4 min
              </p>
            </div>
          </div>
          <div className="self-start sm:self-auto">
            <SegmentedProgress completedCount={completedCount} />
          </div>
        </div>
      )}

      <div className="px-6 py-4">
        {/* Con la bienvenida arriba, el progreso ya vive en su header y el cuerpo arranca directo con los
            pasos; sin bienvenida (>=1 paso hecho) esta fila conserva el titulo accesible y el progreso. */}
        {!showWelcome && (
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="onboarding-title" className="font-display text-[15px] font-bold text-ink">
              Primeros pasos
            </h2>
            <SegmentedProgress completedCount={completedCount} />
          </div>
        )}

        <ol className="flex flex-col gap-1">
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
