import { type FormEvent, type RefObject, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { providerLabel } from '../../lib/agents';
import { compatibleCredentials } from '../../lib/credentials';
import { useAgents, useCredentials, useRecipe } from '../../lib/queries';
import { useCreateRecipe, useUpdateRecipe } from '../../lib/mutations';
import {
  emptyRecipeDraft,
  recipeToDraft,
  toRecipeApiInput,
  toRecipePatchInput,
  validateRecipeDraft,
  RECIPE_DESCRIPTION_MAX,
  RECIPE_NAME_MAX,
  type Recipe,
  type RecipeDraft,
  type RecipeDraftErrors,
} from '../../lib/recipes';
import { Field, inputClass } from '../ui/Field';
import { useDialog } from '../ui/useDialog';
import { StepEditor } from './StepEditor';
import { RetryWarning } from './RetryWarning';

type Mode = 'create' | 'edit';

/** Traduce el error del backend a un mensaje en espanol. */
function backendMessage(error: unknown, mode: Mode): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesion expiro. Vuelve a iniciar sesion.';
    if (error.status === 403) return 'Las recetas requieren el plan Autonomo (tier autonomous).';
    if (error.status === 404) return 'El agente o la credencial ya no existen. Actualiza y prueba de nuevo.';
    if (error.status === 400) return 'El backend rechazo la receta. Revisa el nombre y los pasos.';
  }
  return mode === 'edit'
    ? 'No pudimos guardar los cambios. Intenta de nuevo.'
    : 'No pudimos crear la receta. Intenta de nuevo.';
}

/**
 * Shell del modal (backdrop + dialog + cabecera + cierre). Comparte estructura con
 * ScheduledTaskFormDialog. La accesibilidad (trampa de foco, Escape, retorno de foco) la aporta el hook
 * `useDialog`; el foco inicial apunta a `initialFocusRef` (el campo Nombre cuando hay formulario, o el
 * primer control disponible en los estados de carga/error).
 */
function Shell({
  title,
  subtitle,
  onClose,
  initialFocusRef,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLInputElement | null>;
  children: React.ReactNode;
}) {
  const dialogRef = useDialog({ onClose, initialFocus: initialFocusRef });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-form-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-5">
          <div>
            <h2 id="recipe-form-title" className="font-display text-lg font-bold text-ink">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Cuerpo del formulario de receta (alta o edicion), con estado propio inicializado del draft. El AGENTE
 * y la CREDENCIAL son FIJOS al editar (el backend no los cambia): en modo edicion se muestran
 * deshabilitados. El editor de pasos preserva el orden y exige al menos 1 paso con contenido. El foco
 * inicial (campo Nombre) lo maneja el Shell via `nameRef`, para no robarselo al hook de foco.
 */
function RecipeForm({
  mode,
  initialDraft,
  onClose,
  onSaved,
  recipeId,
  nameRef,
}: {
  mode: Mode;
  initialDraft: RecipeDraft;
  onClose: () => void;
  onSaved: (mode: Mode) => void;
  recipeId?: string;
  nameRef: RefObject<HTMLInputElement | null>;
}) {
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: credentials, isLoading: credentialsLoading } = useCredentials();
  const createRecipe = useCreateRecipe();
  const updateRecipe = useUpdateRecipe();
  const mutation = mode === 'edit' ? updateRecipe : createRecipe;

  const [draft, setDraft] = useState<RecipeDraft>(initialDraft);
  const [errors, setErrors] = useState<RecipeDraftErrors>({});

  const isEdit = mode === 'edit';
  const fieldsFixed = isEdit; // agente y credencial no se editan

  const selectedAgent = useMemo(
    () => agents?.find((agent) => agent.id === draft.agentId) ?? null,
    [agents, draft.agentId],
  );

  // Credenciales elegibles: solo las del proveedor del agente (el backend rechaza las de otro).
  const compatible = useMemo(() => {
    if (!selectedAgent || !credentials) return [];
    return compatibleCredentials(credentials, selectedAgent.providerId);
  }, [selectedAgent, credentials]);

  function patch(next: Partial<RecipeDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function handleAgentChange(nextAgentId: string) {
    setErrors((prev) => ({ ...prev, agentId: undefined }));
    // Si la credencial elegida ya no es compatible con el nuevo agente, se limpia.
    const nextAgent = agents?.find((agent) => agent.id === nextAgentId) ?? null;
    let nextCredentialId = draft.credentialId;
    if (draft.credentialId && nextAgent && credentials) {
      const stillValid = compatibleCredentials(credentials, nextAgent.providerId).some(
        (cred) => cred.id === draft.credentialId,
      );
      if (!stillValid) nextCredentialId = '';
    }
    patch({ agentId: nextAgentId, credentialId: nextCredentialId });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validation = validateRecipeDraft(draft);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    if (isEdit && recipeId) {
      updateRecipe.mutate(
        { id: recipeId, patch: toRecipePatchInput(draft) },
        {
          onSuccess: () => {
            onSaved('edit');
            onClose();
          },
        },
      );
    } else {
      createRecipe.mutate(toRecipeApiInput(draft), {
        onSuccess: () => {
          onSaved('create');
          onClose();
        },
      });
    }
  }

  const noAgents = !agentsLoading && (agents?.length ?? 0) === 0;
  const submitLabel = isEdit ? 'Guardar cambios' : 'Crear receta';

  return (
    <form onSubmit={handleSubmit} className="space-y-5 overflow-y-auto px-6 py-6" noValidate>
      {mutation.isError && (
        <div
          role="alert"
          className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
        >
          {backendMessage(mutation.error, mode)}
        </div>
      )}

      <Field label="Nombre" error={errors.name}>
        <input
          ref={nameRef}
          type="text"
          value={draft.name}
          onChange={(e) => {
            patch({ name: e.target.value });
            setErrors((prev) => ({ ...prev, name: undefined }));
          }}
          className={inputClass}
          placeholder="Ej: Resumen y respuesta de pedidos"
          maxLength={RECIPE_NAME_MAX}
        />
      </Field>

      <Field label="Descripcion" hint="Opcional: para que sirve esta receta.">
        <textarea
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
          className={`${inputClass} min-h-[64px] resize-y`}
          placeholder="Opcional"
          maxLength={RECIPE_DESCRIPTION_MAX}
        />
      </Field>

      {noAgents ? (
        <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
          Primero necesitas un agente.{' '}
          <Link to="/agentes" className="font-medium text-brasa hover:underline">
            Crea uno en Agentes
          </Link>
          .
        </div>
      ) : (
        <Field
          label="Agente"
          error={errors.agentId}
          hint={fieldsFixed ? 'El agente es fijo; crea una nueva receta para cambiarlo.' : undefined}
        >
          <select
            value={draft.agentId}
            onChange={(e) => handleAgentChange(e.target.value)}
            className={inputClass}
            disabled={agentsLoading || fieldsFixed}
          >
            <option value="">{agentsLoading ? 'Cargando agentes...' : 'Elige un agente...'}</option>
            {agents?.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {providerLabel(agent.providerId)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field
        label="Credencial"
        error={errors.credentialId}
        hint={fieldsFixed ? 'La credencial es fija; crea una nueva receta para cambiarla.' : undefined}
      >
        {(field) =>
          !selectedAgent ? (
            <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
              Elige primero un agente para ver sus credenciales.
            </div>
          ) : credentialsLoading ? (
            <div className="h-11 animate-pulse rounded-xl border border-line bg-field" />
          ) : fieldsFixed ? (
            <select {...field} value={draft.credentialId} className={inputClass} disabled>
              {compatible.map((cred) => (
                <option key={cred.id} value={cred.id}>
                  {cred.label}
                </option>
              ))}
              {compatible.every((cred) => cred.id !== draft.credentialId) && (
                <option value={draft.credentialId}>Credencial no disponible</option>
              )}
            </select>
          ) : compatible.length === 0 ? (
            <div className="rounded-xl border border-line bg-field px-4 py-3 text-sm text-muted">
              No tienes credenciales de {providerLabel(selectedAgent.providerId)}.{' '}
              <Link to="/credenciales" className="font-medium text-brasa hover:underline">
                Agrega una en Credenciales
              </Link>
              .
            </div>
          ) : (
            <select
              {...field}
              value={draft.credentialId}
              onChange={(e) => {
                patch({ credentialId: e.target.value });
                setErrors((prev) => ({ ...prev, credentialId: undefined }));
              }}
              className={inputClass}
            >
              <option value="">Elige una credencial...</option>
              {compatible.map((cred) => (
                <option key={cred.id} value={cred.id}>
                  {cred.label}
                </option>
              ))}
            </select>
          )
        }
      </Field>

      <RetryWarning />

      <StepEditor
        steps={draft.steps}
        onChange={(steps) => {
          patch({ steps });
          setErrors((prev) => ({ ...prev, steps: undefined }));
        }}
        error={errors.steps}
      />

      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={mutation.isPending || noAgents}
          className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? 'Guardando...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Modal de alta o edicion de una receta (POST /v1/recipes o PATCH /v1/recipes/:id). Se monta solo
 * cuando esta abierto, asi el estado arranca limpio en cada apertura. En modo edicion carga la receta
 * completa (con sus pasos) via GET /v1/recipes/:id y muestra un estado de carga hasta tenerla.
 */
export function RecipeFormDialog({
  recipeId,
  onClose,
  onSaved,
}: {
  recipeId?: string | null;
  onClose: () => void;
  onSaved: (mode: Mode) => void;
}) {
  const isEdit = Boolean(recipeId);
  const { data: recipe, isLoading, isError } = useRecipe(recipeId ?? undefined);
  // El foco inicial (campo Nombre) lo comparte el Shell (para capturarlo) y el formulario (que lo monta).
  const nameRef = useRef<HTMLInputElement>(null);

  const title = isEdit ? 'Editar receta' : 'Nueva receta';
  const subtitle = isEdit
    ? 'Ajusta el nombre, la descripcion y los pasos.'
    : 'Un flujo de pasos que tu agente ejecuta en orden.';

  if (isEdit && isLoading) {
    return (
      <Shell title={title} subtitle={subtitle} onClose={onClose} initialFocusRef={nameRef}>
        <div className="space-y-4 px-6 py-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl border border-line bg-field" />
          ))}
        </div>
      </Shell>
    );
  }

  if (isEdit && (isError || !recipe)) {
    return (
      <Shell title={title} subtitle={subtitle} onClose={onClose} initialFocusRef={nameRef}>
        <div className="px-6 py-6">
          <div
            role="alert"
            className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
          >
            No pudimos cargar la receta. Cierra e intenta de nuevo.
          </div>
        </div>
      </Shell>
    );
  }

  const initialDraft: RecipeDraft =
    isEdit && recipe ? recipeToDraft(recipe as Recipe) : emptyRecipeDraft();

  return (
    <Shell title={title} subtitle={subtitle} onClose={onClose} initialFocusRef={nameRef}>
      <RecipeForm
        mode={isEdit ? 'edit' : 'create'}
        initialDraft={initialDraft}
        onClose={onClose}
        onSaved={onSaved}
        recipeId={recipeId ?? undefined}
        nameRef={nameRef}
      />
    </Shell>
  );
}
