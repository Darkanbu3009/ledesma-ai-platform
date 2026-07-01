import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ListChecks, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useAgents, useCredentials, useMe, useRecipes } from '../lib/queries';
import { useDeleteRecipe, useRunRecipe, useUpdateRecipe } from '../lib/mutations';
import type { RecipeSummary } from '../lib/recipes';
import { RecipeCard } from '../components/recipes/RecipeCard';
import { RecipeFormDialog } from '../components/recipes/RecipeFormDialog';
import { DeleteRecipeDialog } from '../components/recipes/DeleteRecipeDialog';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

type Notice = { kind: 'ok' | 'error'; text: string };

/** Mensaje de error al intentar ejecutar una receta. */
function runErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Ejecutar recetas requiere el plan Autonomo (tier autonomous).';
    if (error.status === 404) return 'La receta ya no existe. Actualiza la lista.';
    if (error.status === 400) return 'La receta esta pausada. Activala para ejecutarla.';
  }
  return 'No pudimos encolar la receta. Intenta de nuevo.';
}

/** Aviso: las recetas son del plan Autonomo. Sobrio, no un paywall agresivo. Espeja SchedulingLocked. */
function RecipesLocked() {
  return (
    <div className="mt-10 flex flex-1 flex-col items-center justify-center text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-brasa-soft text-brasa">
        <Sparkles className="h-6 w-6" />
      </span>
      <h2 className="mt-5 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        Una funcion del plan Autonomo
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.6] text-muted">
        Las recetas encadenan varios pasos y tu agente los ejecuta en orden, solo. Estan disponibles en
        el plan Autonomo. Cuando lo actives, vas a poder crearlas y ejecutarlas desde aqui.
      </p>
    </div>
  );
}

/** Estado vacio editorial, consistente con /tareas y /triggers. */
function RecipesEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-10 hidden md:block">
        <div
          aria-hidden="true"
          className="w-[250px] rounded-2xl border border-line-soft bg-surface p-[18px] shadow-card"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brasa-soft text-brasa">
              <ListChecks className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-2.5 w-[110px] rounded-full bg-line" />
              <span className="block h-2 w-[70px] rounded-full bg-line-soft" />
            </div>
            <span className="block h-[22px] w-[52px] flex-none rounded-full bg-ok/15" />
          </div>
          <div className="mt-[18px] space-y-2">
            <span className="block h-2 w-[150px] rounded-full bg-line-soft" />
            <span className="block h-2 w-[120px] rounded-full bg-line-soft" />
          </div>
        </div>
      </div>
      <span className="inline-flex items-center rounded-md bg-brasa-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#993C1D]">
        EMPIEZA AQUI
      </span>
      <h2 className="mt-4 max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink">
        Crea tu primera receta
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-[1.5] text-muted">
        Encadena varios pasos en un solo flujo: tu agente los ejecuta en orden y el resultado de cada
        uno alimenta al siguiente.
      </p>
      <div className="mt-7">
        <button
          type="button"
          onClick={onAdd}
          className="group inline-flex h-11 items-center gap-3 rounded-full bg-brasa pl-6 pr-[7px] text-sm font-medium text-white transition hover:bg-brasa-hover"
        >
          Crear receta
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-brasa transition group-hover:translate-x-0.5">
            <ArrowRight className="h-[18px] w-[18px]" />
          </span>
        </button>
      </div>
    </div>
  );
}

export function RecipesPage() {
  const me = useMe();
  const isAutonomous = me.data?.profile?.tier === 'autonomous';

  const { data: recipes, isLoading, isError, refetch } = useRecipes();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: credentials } = useCredentials();
  const updateRecipe = useUpdateRecipe();
  const deleteRecipe = useDeleteRecipe();
  const runRecipe = useRunRecipe();

  const [formOpen, setFormOpen] = useState(false);
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<RecipeSummary | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // El aviso se descarta solo a los pocos segundos.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const agentsById = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent])),
    [agents],
  );
  const credentialsById = useMemo(
    () => new Map((credentials ?? []).map((cred) => [cred.id, cred])),
    [credentials],
  );

  const hasRecipes = Array.isArray(recipes) && recipes.length > 0;
  const listLoading = isLoading || agentsLoading;

  function openNew() {
    setEditRecipeId(null);
    setFormOpen(true);
  }

  function openEdit(recipe: RecipeSummary) {
    setEditRecipeId(recipe.id);
    setFormOpen(true);
  }

  function runNow(recipe: RecipeSummary) {
    setRunningId(recipe.id);
    runRecipe.mutate(recipe.id, {
      onSuccess: () =>
        setNotice({ kind: 'ok', text: 'Receta encolada. Se ejecutara en segundo plano.' }),
      onError: (error) => setNotice({ kind: 'error', text: runErrorMessage(error) }),
      onSettled: () => setRunningId(null),
    });
  }

  function toggleActive(recipe: RecipeSummary) {
    setTogglingId(recipe.id);
    updateRecipe.mutate(
      { id: recipe.id, patch: { isActive: !recipe.isActive } },
      {
        onSuccess: () =>
          setNotice({ kind: 'ok', text: recipe.isActive ? 'Receta pausada.' : 'Receta activada.' }),
        onError: () =>
          setNotice({ kind: 'error', text: 'No pudimos actualizar la receta. Intenta de nuevo.' }),
        onSettled: () => setTogglingId(null),
      },
    );
  }

  function openDelete(recipe: RecipeSummary) {
    deleteRecipe.reset();
    setToDelete(recipe);
  }

  function confirmDelete() {
    if (!toDelete) return;
    deleteRecipe.mutate(toDelete.id, {
      onSuccess: () => {
        setToDelete(null);
        setNotice({ kind: 'ok', text: 'Receta eliminada.' });
      },
    });
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Recetas</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Encadena varios pasos en un flujo y ejecutalo cuando quieras, en segundo plano.
          </p>
        </div>
        {isAutonomous && hasRecipes && (
          <button type="button" onClick={openNew} className={addButtonClass}>
            <Plus className="h-[17px] w-[17px]" />
            Nueva receta
          </button>
        )}
      </div>

      <div className="mt-3" aria-live="polite">
        {notice && (
          <div
            className={[
              'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium',
              notice.kind === 'ok'
                ? 'border-ok/30 bg-ok/10 text-ok'
                : 'border-brasa-line bg-brasa-soft text-brasa',
            ].join(' ')}
          >
            {notice.kind === 'ok' && <CheckCircle2 className="h-4 w-4" />}
            {notice.text}
          </div>
        )}
      </div>

      {me.isLoading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : !isAutonomous ? (
        <RecipesLocked />
      ) : listLoading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">No pudimos cargar tus recetas</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : !hasRecipes ? (
        <RecipesEmptyState onAdd={openNew} />
      ) : (
        <div className="mt-6 space-y-3">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              agentName={agentsById.get(recipe.agentId)?.name ?? null}
              credentialLabel={credentialsById.get(recipe.credentialId)?.label ?? null}
              running={runningId === recipe.id}
              toggling={togglingId === recipe.id}
              onRun={() => runNow(recipe)}
              onEdit={() => openEdit(recipe)}
              onToggle={() => toggleActive(recipe)}
              onDelete={() => openDelete(recipe)}
            />
          ))}
          <button
            type="button"
            onClick={openNew}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line p-4 text-sm font-semibold text-muted transition hover:border-brasa-line hover:bg-brasa/[0.03] hover:text-brasa"
          >
            <Plus className="h-[18px] w-[18px]" />
            Nueva receta
          </button>
        </div>
      )}

      {formOpen && isAutonomous && (
        // key por receta: garantiza un remonte con estado fresco al cambiar de alta a edicion (o entre
        // recetas), sin arrastrar el borrador anterior.
        <RecipeFormDialog
          key={editRecipeId ?? 'new'}
          recipeId={editRecipeId}
          onClose={() => setFormOpen(false)}
          onSaved={(mode) =>
            setNotice({
              kind: 'ok',
              text: mode === 'edit' ? 'Receta actualizada.' : 'Receta creada.',
            })
          }
        />
      )}

      <DeleteRecipeDialog
        open={toDelete !== null}
        name={toDelete?.name ?? ''}
        busy={deleteRecipe.isPending}
        error={deleteRecipe.isError ? 'No pudimos eliminar la receta. Intenta de nuevo.' : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
