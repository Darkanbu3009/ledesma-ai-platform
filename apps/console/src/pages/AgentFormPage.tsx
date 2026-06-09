import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AgentFormSchema,
  type AgentFormParsed,
  type AgentFormValues,
} from '../lib/agent-schema';
import { providerLabel, type ProviderId } from '../lib/agents';
import { modelPlaceholder, modelSuggestions } from '../lib/model-catalog';
import { useAgent } from '../lib/queries';
import { useCreateAgent, useDeleteAgent, useUpdateAgent } from '../lib/mutations';
import { Field, inputClass } from '../components/ui/Field';
import { DeleteAgentDialog } from '../components/agents/DeleteAgentDialog';

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'openai-compatible'];

const defaultValues: AgentFormValues = {
  name: '',
  description: '',
  providerId: 'anthropic',
  model: '',
  systemPrompt: '',
  maxTokens: 1024,
  temperature: '',
  baseUrl: '',
};

export function AgentFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data: agent, isLoading, isError, refetch } = useAgent(id);
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent(id ?? '');
  const deleteAgent = useDeleteAgent();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AgentFormValues, unknown, AgentFormParsed>({
    resolver: zodResolver(AgentFormSchema),
    defaultValues,
  });

  const providerId = watch('providerId');

  useEffect(() => {
    if (agent) {
      reset({
        name: agent.name,
        description: agent.description ?? '',
        providerId: agent.providerId,
        model: agent.model,
        systemPrompt: agent.systemPrompt ?? '',
        maxTokens: agent.maxTokens,
        temperature: agent.temperature === null ? '' : agent.temperature,
        baseUrl: agent.baseUrl ?? '',
      });
    }
  }, [agent, reset]);

  const isSaving = createAgent.isPending || updateAgent.isPending;
  const saveFailed = isEdit ? updateAgent.isError : createAgent.isError;

  const onSubmit = handleSubmit((values) => {
    const mutation = isEdit ? updateAgent : createAgent;
    mutation.mutate(values, { onSuccess: () => navigate('/agentes') });
  });

  function handleDelete() {
    if (!id) return;
    deleteAgent.mutate(id, { onSuccess: () => navigate('/agentes') });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-hueso">
          {isEdit ? 'Editar agente' : 'Crear agente'}
        </h1>
        <Link
          to="/agentes"
          className="inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
      </div>

      {isEdit && isLoading ? (
        <div className="mt-6 space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
          ))}
        </div>
      ) : isEdit && isError ? (
        <div className="mt-10 rounded-xl border border-grafito-border bg-grafito p-8 text-center">
          <p className="font-display text-lg text-hueso">No pudimos cargar el agente</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="mt-6 space-y-5" noValidate>
          {saveFailed && (
            <div className="rounded-lg border border-brasa/40 bg-brasa/10 px-4 py-3 text-sm text-brasa">
              No pudimos guardar el agente. Intenta de nuevo.
            </div>
          )}

          <Field label="Nombre" error={errors.name?.message}>
            <input {...register('name')} className={inputClass} placeholder="Mi agente" />
          </Field>

          <Field label="Descripcion" error={errors.description?.message}>
            <textarea
              {...register('description')}
              rows={3}
              className={inputClass}
              placeholder="Que hace este agente"
            />
          </Field>

          <Field label="Proveedor" error={errors.providerId?.message}>
            <select
              {...register('providerId', { onChange: () => setValue('model', '') })}
              className={inputClass}
            >
              {PROVIDER_IDS.map((pid) => (
                <option key={pid} value={pid}>
                  {providerLabel(pid)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Modelo"
            error={errors.model?.message}
            hint="Sugerencias segun el proveedor; puedes escribir cualquier identificador valido."
          >
            <input
              {...register('model')}
              className={inputClass}
              list="model-suggestions"
              placeholder={modelPlaceholder(providerId)}
            />
            <datalist id="model-suggestions">
              {modelSuggestions(providerId).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>

          <Field label="System prompt" error={errors.systemPrompt?.message}>
            <textarea
              {...register('systemPrompt')}
              rows={6}
              className={inputClass}
              placeholder="Instrucciones para el agente"
            />
          </Field>

          <Field label="Max tokens" error={errors.maxTokens?.message}>
            <input type="number" {...register('maxTokens')} className={inputClass} />
          </Field>

          <Field
            label="Temperature"
            error={errors.temperature?.message}
            hint="Vacio = por defecto del proveedor"
          >
            <input type="number" step="0.1" {...register('temperature')} className={inputClass} />
          </Field>

          {providerId === 'openai-compatible' && (
            <Field
              label="Base URL"
              error={errors.baseUrl?.message}
              hint="URL base del endpoint compatible con OpenAI"
            >
              <input
                {...register('baseUrl')}
                className={inputClass}
                placeholder="https://api.miproveedor.com/v1"
              />
            </Field>
          )}

          <div>
            <p className="mb-2 block text-sm font-medium text-hueso">Herramientas</p>
            <div className="rounded-lg border border-dashed border-grafito-border px-4 py-5 text-sm text-hueso-muted">
              Proximamente: define herramientas para tu agente.
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-brasa px-4 py-2.5 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : 'Guardar agente'}
            </button>
            {isEdit && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="rounded-lg border border-grafito-border px-4 py-2.5 text-sm font-medium text-brasa transition hover:border-brasa"
              >
                Eliminar agente
              </button>
            )}
          </div>
        </form>
      )}

      <DeleteAgentDialog
        open={confirmOpen}
        agentName={agent?.name ?? ''}
        busy={deleteAgent.isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
