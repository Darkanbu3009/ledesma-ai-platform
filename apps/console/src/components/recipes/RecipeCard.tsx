import { Bot, KeyRound, ListChecks, Loader2, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { RecipeSummary } from '../../lib/recipes';
import { formatRunAt } from '../../lib/schedule';

/** Pill de estado: activa (verde) o pausada (neutra). Espeja el de ScheduledTaskCard. */
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        'flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide',
        active ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-line-soft text-muted',
      ].join(' ')}
    >
      {active ? 'ACTIVA' : 'PAUSADA'}
    </span>
  );
}

/**
 * Tarjeta de una receta en la lista. Muestra el nombre, el agente, la cantidad de pasos, el estado y el
 * ultimo run, con las acciones: EJECUTAR AHORA (encola un job; deshabilitada si esta pausada), pausar/
 * activar (PATCH is_active), editar y borrar. Espeja la estructura de ScheduledTaskCard. El nombre del
 * agente y de la credencial los resuelve la pantalla.
 */
export function RecipeCard({
  recipe,
  agentName,
  credentialLabel,
  running,
  toggling,
  onRun,
  onEdit,
  onToggle,
  onDelete,
}: {
  recipe: RecipeSummary;
  agentName: string | null;
  credentialLabel: string | null;
  running: boolean;
  toggling: boolean;
  onRun: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const lastRun = formatRunAt(recipe.lastRunAt) ?? 'Nunca';

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
          <ListChecks className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-[16px] font-bold text-ink">{recipe.name}</h3>
            <StatusBadge active={recipe.isActive} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">{agentName ?? 'Agente eliminado'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5 flex-none" />
              {recipe.stepCount} paso{recipe.stepCount === 1 ? '' : 's'}
            </span>
            {credentialLabel && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 flex-none" />
                <span className="truncate">{credentialLabel}</span>
              </span>
            )}
          </div>

          <div className="mt-2 text-[12px] text-muted-soft">
            Ultima ejecucion: <span className="text-muted">{lastRun}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={running || !recipe.isActive}
          aria-label="Ejecutar receta ahora"
          title={recipe.isActive ? undefined : 'Activa la receta para ejecutarla'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brasa-line bg-brasa-soft px-3 py-2 text-[13px] font-semibold text-brasa transition hover:bg-brasa/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <span className="hidden sm:inline">Ejecutar</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={toggling}
          aria-label={recipe.isActive ? 'Pausar receta' : 'Activar receta'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-muted transition hover:border-brasa-line hover:text-brasa disabled:cursor-not-allowed disabled:opacity-60"
        >
          {toggling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : recipe.isActive ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{recipe.isActive ? 'Pausar' : 'Activar'}</span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label="Editar receta"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-brasa-line hover:text-brasa"
        >
          <Pencil className="h-[17px] w-[17px]" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Eliminar receta"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-[rgba(192,73,43,0.35)] hover:bg-[rgba(192,73,43,0.05)] hover:text-[#C0492B]"
        >
          <Trash2 className="h-[17px] w-[17px]" />
        </button>
      </div>
    </div>
  );
}
