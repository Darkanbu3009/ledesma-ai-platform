import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ListChecks, Lock, Plus } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useAgents, useCredentials, useMe, useRecipes } from '../lib/queries';
import { useDeleteRecipe, useRunRecipe, useUpdateRecipe } from '../lib/mutations';
import type { RecipeSummary } from '../lib/recipes';
import { RecipeCard } from '../components/recipes/RecipeCard';
import { RecipeFormDialog } from '../components/recipes/RecipeFormDialog';
import { DeleteRecipeDialog } from '../components/recipes/DeleteRecipeDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { Notice, type NoticeData } from '../components/ui/Notice';
import { RequestUpgradeCta } from '../components/upgrade/RequestUpgradeCta';
import { GateRecetasPipeline } from '../components/upgrade/GateRecetasPipeline';

const addButtonClass =
  'inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-brasa-hover hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)]';

/** Mensaje de error al intentar ejecutar una receta. */
function runErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Ejecutar recetas requiere el plan Autonomo (tier autonomous).';
    if (error.status === 404) return 'La receta ya no existe. Actualiza la lista.';
    if (error.status === 400) return 'La receta esta pausada. Activala para ejecutarla.';
  }
  return 'No pudimos encolar la receta. Intenta de nuevo.';
}

/**
 * Gate del plan Autonomo para Recetas: hero centrado + pipeline estatico de una receta corriendo
 * como prueba visual (GateRecetasPipeline). Reemplaza al PageHeader y al layout viejo de dos
 * columnas en el estado bloqueado. El CTA es el RequestUpgradeCta existente sin cambios: mismo
 * flujo upgrade_requests, mismo estado post-solicitud ("Solicitud enviada") y mismo disclaimer.
 * El hero duplica al de Tareas y Triggers (lo tienen inline); extraerlo a un sub-componente queda
 * como deuda.
 */
function RecipesLocked() {
  return (
    <div className="flex flex-col gap-4">
      <section className="mx-auto flex w-full max-w-[520px] flex-col items-center pb-12 pt-14 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1EFE8] px-3 py-[5px]">
          <Lock className="h-3 w-3 flex-none text-[#5F5E5A]" aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-[#5F5E5A]">
            Plan Autonomo
          </span>
        </span>
        <h1 className="mt-5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-ink">
          Una funcion del plan Autonomo
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-[#5F5E5A]">
          Las recetas encadenan varios pasos y tu agente los ejecuta en orden, solo. Estan
          disponibles en el plan Autonomo.
        </p>
        <RequestUpgradeCta featureContext="recipes" className="mt-6" />
      </section>
      <GateRecetasPipeline />
    </div>
  );
}

/** Estado vacio editorial, consistente con /tareas y /triggers. */
function RecipesEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      media={
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
      }
      eyebrow="EMPIEZA AQUI"
      title="Crea tu primera receta"
      description="Encadena varios pasos en un solo flujo: tu agente los ejecuta en orden y el resultado de cada uno alimenta al siguiente."
      action={
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
      }
    />
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
  const [notice, setNotice] = useState<NoticeData | null>(null);

  // El aviso se descarta solo a los pocos segundos.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
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
      {/* En el estado bloqueado el hero del gate reemplaza al titulo y subtitulo de la pagina. */}
      {(me.isLoading || isAutonomous) && (
        <PageHeader
          title="Recetas"
          subtitle="Encadena pasos en un flujo. Corre solo, en segundo plano."
          action={
            isAutonomous &&
            hasRecipes && (
              <button type="button" onClick={openNew} className={addButtonClass}>
                <Plus className="h-[17px] w-[17px]" />
                Nueva receta
              </button>
            )
          }
        />
      )}

      <Notice notice={notice} />

      {me.isLoading ? (
        <SkeletonList cardClassName="h-[112px]" />
      ) : !isAutonomous ? (
        <RecipesLocked />
      ) : listLoading ? (
        <SkeletonList cardClassName="h-[112px]" />
      ) : isError ? (
        <ErrorState title="No pudimos cargar tus recetas" onRetry={() => void refetch()} />
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
