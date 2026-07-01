import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { addStep, moveStep, removeStep, updateStep, RECIPE_STEP_MAX } from '../../lib/recipes';
import { inputClass } from '../ui/Field';

/**
 * EDITOR DE PASOS de una receta: una lista ORDENADA y dinamica de instrucciones. El usuario puede
 * AGREGAR un paso, ESCRIBIR su instruccion (textarea), REORDENAR con los botones subir/bajar y BORRAR
 * un paso. El ORDEN del array es el orden de ejecucion y se preserva tal cual al enviar.
 *
 * Reordenar con botones (no drag-and-drop): JS puro, sin dependencias nuevas, y accesible por teclado.
 * Accesibilidad: cada paso tiene su <label> asociado al textarea, y los botones llevan aria-label con
 * el numero de paso (Subir/Bajar/Eliminar paso N). Siempre hay AL MENOS un paso: el boton de borrar se
 * deshabilita cuando queda uno solo (la receta necesita minimo 1 paso).
 *
 * Es un componente CONTROLADO: recibe `steps` (array de strings, una instruccion por paso) y notifica
 * cada cambio con `onChange`. Toda la logica de reordenamiento vive en helpers puros de lib/recipes.
 */
export function StepEditor({
  steps,
  onChange,
  error,
  disabled = false,
}: {
  steps: string[];
  onChange: (steps: string[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const single = steps.length === 1;

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-ink" id="recipe-steps-label">
          Pasos
        </label>
        <span className="text-xs text-muted">{steps.length} paso{steps.length === 1 ? '' : 's'}</span>
      </div>
      <p className="mb-2.5 mt-1 text-xs text-muted">
        Se ejecutan en orden, de arriba hacia abajo. El resultado de cada paso alimenta al siguiente.
      </p>

      <ol className="space-y-3" aria-labelledby="recipe-steps-label">
        {steps.map((step, index) => {
          const stepId = `recipe-step-${index}`;
          const position = index + 1;
          return (
            <li
              key={index}
              className="rounded-xl border border-line bg-field/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <label htmlFor={stepId} className="text-[13px] font-semibold text-ink">
                  Paso {position}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChange(moveStep(steps, index, -1))}
                    disabled={disabled || index === 0}
                    aria-label={`Subir paso ${position}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:border-brasa-line hover:text-brasa disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(moveStep(steps, index, 1))}
                    disabled={disabled || index === steps.length - 1}
                    aria-label={`Bajar paso ${position}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:border-brasa-line hover:text-brasa disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(removeStep(steps, index))}
                    disabled={disabled || single}
                    aria-label={`Eliminar paso ${position}`}
                    title={single ? 'Una receta necesita al menos un paso' : undefined}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-muted transition hover:border-[rgba(192,73,43,0.35)] hover:bg-[rgba(192,73,43,0.05)] hover:text-[#C0492B] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <textarea
                id={stepId}
                value={step}
                onChange={(e) => onChange(updateStep(steps, index, e.target.value))}
                disabled={disabled}
                className={`${inputClass} min-h-[76px] resize-y`}
                placeholder={
                  index === 0
                    ? 'Ej: Busca los pedidos pendientes de hoy y resume su estado.'
                    : 'Ej: Con ese resumen, redacta un borrador de respuesta.'
                }
                maxLength={RECIPE_STEP_MAX}
              />
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => onChange(addStep(steps))}
        disabled={disabled}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line py-2.5 text-[13px] font-semibold text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus className="h-4 w-4" />
        Agregar paso
      </button>

      {error && <p className="mt-2 text-sm text-brasa">{error}</p>}
    </div>
  );
}
