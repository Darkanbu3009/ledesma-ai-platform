import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import type { AgentFormValues } from '../../lib/agent-schema';
import {
  paramsToJsonSchema,
  sampleInputFromParams,
  tryJsonSchemaToParams,
  tryParseJsonObject,
  type ParamType,
  type ToolFormValues,
} from '../../lib/tool-schema';
import { Field, inputClass } from '../ui/Field';
import { TestToolDialog } from './TestToolDialog';

const PARAM_TYPES: ParamType[] = ['string', 'number', 'boolean'];

function emptyTool(): ToolFormValues {
  return { name: '', description: '', url: '', mode: 'simple', params: [], rawSchema: '' };
}

/** Editor de la lista de tools del agente; requiere FormProvider del form padre.
 * agentId habilita el boton Probar (solo en edicion: la prueba usa la version guardada). */
export function ToolsEditor({ agentId }: { agentId?: string }) {
  const { t } = useTranslation();
  const {
    control,
    formState: { errors },
  } = useFormContext<AgentFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'tools' });
  const listError = errors.tools?.root?.message ?? errors.tools?.message;

  return (
    <div>
      <p className="mb-2 block text-sm font-medium text-hueso">{t('agentes.herramientas.titulo')}</p>
      <div className="space-y-4">
        {fields.length === 0 && (
          <div className="rounded-lg border border-dashed border-grafito-border px-4 py-5 text-sm text-hueso-muted">
            {t('agentes.herramientas.vacio')}
          </div>
        )}
        {fields.map((field, index) => (
          <ToolCard key={field.id} index={index} agentId={agentId} onRemove={() => remove(index)} />
        ))}
        {listError && (
          <p role="alert" className="text-sm text-brasa">
            {listError}
          </p>
        )}
        <button
          type="button"
          onClick={() => append(emptyTool())}
          className="inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm font-medium text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
        >
          <Plus className="h-4 w-4" />
          {t('agentes.herramientas.agregar')}
        </button>
      </div>
    </div>
  );
}

function ToolCard({
  index,
  agentId,
  onRemove,
}: {
  index: number;
  agentId?: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const {
    control,
    register,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useFormContext<AgentFormValues>();
  const {
    fields: paramFields,
    append: appendParam,
    remove: removeParam,
    replace: replaceParams,
  } = useFieldArray({ control, name: `tools.${index}.params` });
  const mode = useWatch({ control, name: `tools.${index}.mode` }) ?? 'simple';
  const [modeError, setModeError] = useState<string | null>(null);
  const [testDialog, setTestDialog] = useState<{ toolName: string; initialInput: string } | null>(
    null,
  );
  const toolErrors = errors.tools?.[index];

  function openTestDialog() {
    const tool = getValues(`tools.${index}`);
    if (!tool) return;
    const sample = tool.mode === 'simple' ? sampleInputFromParams(tool.params ?? []) : {};
    setTestDialog({ toolName: tool.name, initialInput: JSON.stringify(sample, null, 2) });
  }

  function switchMode(next: 'simple' | 'json') {
    setModeError(null);
    if (next === mode) return;
    if (next === 'json') {
      const params = getValues(`tools.${index}.params`) ?? [];
      setValue(`tools.${index}.rawSchema`, JSON.stringify(paramsToJsonSchema(params), null, 2));
      setValue(`tools.${index}.mode`, 'json');
      return;
    }
    const parsed = tryParseJsonObject(getValues(`tools.${index}.rawSchema`) ?? '');
    const params = parsed ? tryJsonSchemaToParams(parsed) : null;
    if (params === null) {
      setModeError(t('agentes.herramientas.schemaComplejo'));
      return;
    }
    replaceParams(params);
    setValue(`tools.${index}.mode`, 'simple');
  }

  return (
    <div className="space-y-4 rounded-xl border border-grafito-border bg-grafito p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-hueso">
          {t('agentes.herramientas.tituloItem', { numero: index + 1 })}
        </p>
        <div className="flex items-center gap-2">
          {agentId && (
            <button
              type="button"
              onClick={openTestDialog}
              disabled={isDirty}
              title={isDirty ? t('agentes.herramientas.guardaPrimero') : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-hueso-muted transition hover:border-hueso-muted hover:text-hueso disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-grafito-border disabled:hover:text-hueso-muted"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {t('agentes.herramientas.probar')}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-brasa transition hover:border-brasa"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('agentes.herramientas.eliminar')}
          </button>
        </div>
      </div>

      {agentId && testDialog && (
        <TestToolDialog
          agentId={agentId}
          toolName={testDialog.toolName}
          initialInput={testDialog.initialInput}
          onClose={() => setTestDialog(null)}
        />
      )}

      <Field label={t('agentes.form.nombreLabel')} error={toolErrors?.name?.message}>
        <input
          {...register(`tools.${index}.name`)}
          className={inputClass}
          placeholder="buscar_pedidos"
        />
      </Field>

      <Field label={t('agentes.herramientas.descripcionLabel')} error={toolErrors?.description?.message}>
        <textarea
          {...register(`tools.${index}.description`)}
          rows={2}
          className={inputClass}
          placeholder={t('agentes.herramientas.descripcionPlaceholder')}
        />
      </Field>

      <Field
        label={t('agentes.herramientas.urlLabel')}
        error={toolErrors?.url?.message}
        hint={t('agentes.herramientas.urlHint')}
      >
        <input
          {...register(`tools.${index}.url`)}
          className={inputClass}
          placeholder="https://mi-servicio.com/webhooks/tool"
        />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-hueso">{t('agentes.herramientas.parametros')}</span>
          <div className="inline-flex rounded-lg border border-grafito-border p-0.5">
            <button
              type="button"
              onClick={() => switchMode('simple')}
              className={
                mode === 'simple'
                  ? 'rounded-md bg-brasa px-3 py-1 text-xs font-semibold text-carbon'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-hueso-muted transition hover:text-hueso'
              }
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => switchMode('json')}
              className={
                mode === 'json'
                  ? 'rounded-md bg-brasa px-3 py-1 text-xs font-semibold text-carbon'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-hueso-muted transition hover:text-hueso'
              }
            >
              JSON
            </button>
          </div>
        </div>

        {modeError && (
          <p role="alert" className="mb-2 text-sm text-brasa">
            {modeError}
          </p>
        )}

        {mode === 'simple' ? (
          <div className="space-y-3">
            {paramFields.length === 0 && (
              <p className="text-xs text-hueso-muted">
                {t('agentes.herramientas.sinParametros')}
              </p>
            )}
            {paramFields.map((param, paramIndex) => {
              const paramErrors = toolErrors?.params?.[paramIndex];
              return (
                <div
                  key={param.id}
                  className="space-y-3 rounded-lg border border-grafito-border bg-carbon/40 p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('agentes.form.nombreLabel')} error={paramErrors?.name?.message}>
                      <input
                        {...register(`tools.${index}.params.${paramIndex}.name`)}
                        className={inputClass}
                        placeholder="query"
                      />
                    </Field>
                    <Field label={t('agentes.herramientas.tipoLabel')} error={paramErrors?.type?.message}>
                      <select
                        {...register(`tools.${index}.params.${paramIndex}.type`)}
                        className={inputClass}
                      >
                        {PARAM_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label={t('agentes.herramientas.descripcionLabel')}
                    error={paramErrors?.description?.message}
                  >
                    <input
                      {...register(`tools.${index}.params.${paramIndex}.description`)}
                      className={inputClass}
                      placeholder={t('agentes.herramientas.paramDescripcionPlaceholder')}
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-hueso-muted">
                      <input
                        type="checkbox"
                        {...register(`tools.${index}.params.${paramIndex}.required`)}
                        className="h-4 w-4 accent-brasa"
                      />
                      {t('agentes.herramientas.requerido')}
                    </label>
                    <button
                      type="button"
                      onClick={() => removeParam(paramIndex)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-brasa transition hover:border-brasa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('agentes.comun.eliminar')}
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                appendParam({ name: '', type: 'string', description: '', required: false })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('agentes.herramientas.agregarParametro')}
            </button>
          </div>
        ) : (
          <div>
            <textarea
              {...register(`tools.${index}.rawSchema`)}
              rows={8}
              spellCheck={false}
              className={`${inputClass} font-mono text-xs`}
              placeholder='{ "type": "object", "properties": {} }'
            />
            {toolErrors?.rawSchema?.message && (
              <p role="alert" className="mt-1.5 text-sm text-brasa">
                {toolErrors.rawSchema.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
