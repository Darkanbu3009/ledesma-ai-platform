import { type ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Play, Plug, RefreshCw } from 'lucide-react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AgentFormSchema, type AgentFormParsed, type AgentFormValues } from '../lib/agent-schema';
import { playgroundPath, providerLabel, type ProviderId } from '../lib/agents';
import { modelPlaceholder, modelSuggestions } from '../lib/model-catalog';
import { storedToToolForm } from '../lib/tool-schema';
import { useAgent } from '../lib/queries';
import { useCreateAgent, useDeleteAgent, useUpdateAgent } from '../lib/mutations';
import { Field, inputClass } from '../components/ui/Field';
import { DeleteAgentDialog } from '../components/agents/DeleteAgentDialog';
import { ToolsEditor } from '../components/agents/ToolsEditor';

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'openai-compatible'];

const secondaryActionClass =
  'inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink';

const defaultValues: AgentFormValues = {
  name: '',
  description: '',
  providerId: 'anthropic',
  model: '',
  systemPrompt: '',
  maxTokens: 1024,
  temperature: '',
  baseUrl: '',
  tools: [],
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
      <div className="mb-5">
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function AgentFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data: agent, isLoading, isError, refetch } = useAgent(id);
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent(id ?? '');
  const deleteAgent = useDeleteAgent();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const form = useForm<AgentFormValues, unknown, AgentFormParsed>({
    resolver: zodResolver(AgentFormSchema),
    defaultValues,
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = form;

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
        tools: agent.tools.map(storedToToolForm),
      });
    }
  }, [agent, reset]);

  const isSaving = createAgent.isPending || updateAgent.isPending;
  const saveFailed = isEdit ? updateAgent.isError : createAgent.isError;

  const onSubmit = handleSubmit((values) => {
    if (isEdit) {
      // Editar conserva el destino de siempre: volver a la lista de agentes.
      updateAgent.mutate(values, { onSuccess: () => navigate('/agentes') });
      return;
    }
    // Crear lleva DIRECTO a conversar con el agente recien creado (su Playground), igual que el
    // Configurador. La mutacion resuelve al AgentConfig creado, de donde tomamos su id real.
    createAgent.mutate(values, { onSuccess: (agent) => navigate(playgroundPath(agent.id)) });
  });

  function handleDelete() {
    if (!id) return;
    deleteAgent.mutate(id, { onSuccess: () => navigate('/agentes') });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
          {isEdit ? 'Editar agente' : 'Crear agente'}
        </h1>
        <Link
          to="/agentes"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
      </div>

      {isEdit && isLoading ? (
        <div className="mt-8 space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : isEdit && isError ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-display text-lg font-bold text-ink">No pudimos cargar el agente</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexión e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : (
        <FormProvider {...form}>
          <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-6" noValidate>
            {saveFailed && (
              <div className="rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa">
                No pudimos guardar el agente. Intenta de nuevo.
              </div>
            )}

            {isEdit && (
              <div className="flex flex-wrap gap-2.5">
                <Link to={`/agentes/${id}/playground`} className={secondaryActionClass}>
                  <Play className="h-4 w-4" />
                  Probar agente
                </Link>
                <Link to={`/agentes/${id}/conectar`} className={secondaryActionClass}>
                  <Plug className="h-4 w-4" />
                  Conectar
                </Link>
                <Link to={`/agentes/${id}/uso`} className={secondaryActionClass}>
                  <BarChart3 className="h-4 w-4" />
                  Uso
                </Link>
              </div>
            )}

            <Section title="Identidad" description="Cómo se identifica este agente en la consola.">
              <Field label="Nombre" error={errors.name?.message}>
                <input {...register('name')} className={inputClass} placeholder="Mi agente" />
              </Field>

              <Field label="Descripción" error={errors.description?.message}>
                <textarea
                  {...register('description')}
                  rows={3}
                  className={inputClass}
                  placeholder="Qué hace este agente"
                />
              </Field>
            </Section>

            <Section title="Modelo" description="El cerebro que mueve al agente. Es intercambiable.">
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
                hint="Sugerencias según el proveedor; puedes escribir cualquier identificador válido."
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

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Max tokens" error={errors.maxTokens?.message}>
                  <input type="number" {...register('maxTokens')} className={inputClass} />
                </Field>

                <Field
                  label="Temperature"
                  error={errors.temperature?.message}
                  hint="Vacío = por defecto del proveedor"
                >
                  <input
                    type="number"
                    step="0.1"
                    {...register('temperature')}
                    className={inputClass}
                  />
                </Field>
              </div>

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
            </Section>

            <Section
              title="Comportamiento"
              description="Las instrucciones base que guían cada respuesta del agente."
            >
              <Field label="System prompt" error={errors.systemPrompt?.message}>
                <textarea
                  {...register('systemPrompt')}
                  rows={6}
                  className={inputClass}
                  placeholder="Instrucciones para el agente"
                />
              </Field>
            </Section>

            <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <ToolsEditor agentId={id} />
            </section>

            <div className="sticky bottom-0 z-10 mt-2 flex items-center justify-between gap-4 rounded-2xl border border-line bg-cream/85 px-4 py-3 shadow-card backdrop-blur supports-[backdrop-filter]:bg-cream/70">
              <div>
                {isEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      deleteAgent.reset();
                      setConfirmOpen(true);
                    }}
                    className="rounded-[10px] border border-line bg-transparent px-[22px] py-[11px] text-sm font-medium text-muted transition hover:border-[rgba(192,73,43,0.35)] hover:bg-[rgba(192,73,43,0.05)] hover:text-[#C0492B]"
                  >
                    Eliminar agente
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-[10px] bg-brasa px-[22px] py-[11px] text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:-translate-y-px hover:bg-[#C8460F] hover:shadow-[0_2px_6px_rgba(31,30,28,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Guardando...' : 'Guardar agente'}
              </button>
            </div>
          </form>
        </FormProvider>
      )}

      <DeleteAgentDialog
        open={confirmOpen}
        agentName={agent?.name ?? ''}
        busy={deleteAgent.isPending}
        error={deleteAgent.isError ? 'No pudimos eliminar el agente. Intenta de nuevo.' : undefined}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
