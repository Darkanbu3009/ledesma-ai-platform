import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import type { AgentFormValues } from '../../lib/agent-schema';
import {
  paramsToJsonSchema,
  tryJsonSchemaToParams,
  tryParseJsonObject,
  type ParamType,
  type ToolFormValues,
} from '../../lib/tool-schema';
import { Field, inputClass } from '../ui/Field';

const PARAM_TYPES: ParamType[] = ['string', 'number', 'boolean'];

function emptyTool(): ToolFormValues {
  return { name: '', description: '', url: '', mode: 'simple', params: [], rawSchema: '' };
}

/** Editor de la lista de tools del agente; requiere FormProvider del form padre. */
export function ToolsEditor() {
  const {
    control,
    formState: { errors },
  } = useFormContext<AgentFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'tools' });
  const listError = errors.tools?.root?.message ?? errors.tools?.message;

  return (
    <div>
      <p className="mb-2 block text-sm font-medium text-hueso">Herramientas</p>
      <div className="space-y-4">
        {fields.length === 0 && (
          <div className="rounded-lg border border-dashed border-grafito-border px-4 py-5 text-sm text-hueso-muted">
            Este agente no tiene herramientas. Agrega una para que pueda llamar webhooks externos.
          </div>
        )}
        {fields.map((field, index) => (
          <ToolCard key={field.id} index={index} onRemove={() => remove(index)} />
        ))}
        {listError && <p className="text-sm text-brasa">{listError}</p>}
        <button
          type="button"
          onClick={() => append(emptyTool())}
          className="inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm font-medium text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
        >
          <Plus className="h-4 w-4" />
          Agregar herramienta
        </button>
      </div>
    </div>
  );
}

function ToolCard({ index, onRemove }: { index: number; onRemove: () => void }) {
  const {
    control,
    register,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<AgentFormValues>();
  const {
    fields: paramFields,
    append: appendParam,
    remove: removeParam,
    replace: replaceParams,
  } = useFieldArray({ control, name: `tools.${index}.params` });
  const mode = useWatch({ control, name: `tools.${index}.mode` }) ?? 'simple';
  const [modeError, setModeError] = useState<string | null>(null);
  const toolErrors = errors.tools?.[index];

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
      setModeError('El schema es demasiado complejo para el modo simple');
      return;
    }
    replaceParams(params);
    setValue(`tools.${index}.mode`, 'simple');
  }

  return (
    <div className="space-y-4 rounded-xl border border-grafito-border bg-grafito p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-hueso">Herramienta {index + 1}</p>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-brasa transition hover:border-brasa"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar herramienta
        </button>
      </div>

      <Field label="Nombre" error={toolErrors?.name?.message}>
        <input
          {...register(`tools.${index}.name`)}
          className={inputClass}
          placeholder="buscar_pedidos"
        />
      </Field>

      <Field label="Descripcion" error={toolErrors?.description?.message}>
        <textarea
          {...register(`tools.${index}.description`)}
          rows={2}
          className={inputClass}
          placeholder="Que hace la herramienta y cuando conviene usarla"
        />
      </Field>

      <Field
        label="URL del webhook"
        error={toolErrors?.url?.message}
        hint="Recibira un POST con { tool, input } y debe responder { content, isError? }"
      >
        <input
          {...register(`tools.${index}.url`)}
          className={inputClass}
          placeholder="https://mi-servicio.com/webhooks/tool"
        />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-hueso">Parametros</span>
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

        {modeError && <p className="mb-2 text-sm text-brasa">{modeError}</p>}

        {mode === 'simple' ? (
          <div className="space-y-3">
            {paramFields.length === 0 && (
              <p className="text-xs text-hueso-muted">
                Sin parametros: la herramienta se llama sin argumentos.
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
                    <Field label="Nombre" error={paramErrors?.name?.message}>
                      <input
                        {...register(`tools.${index}.params.${paramIndex}.name`)}
                        className={inputClass}
                        placeholder="query"
                      />
                    </Field>
                    <Field label="Tipo" error={paramErrors?.type?.message}>
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
                  <Field label="Descripcion" error={paramErrors?.description?.message}>
                    <input
                      {...register(`tools.${index}.params.${paramIndex}.description`)}
                      className={inputClass}
                      placeholder="Para que sirve este parametro"
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-hueso-muted">
                      <input
                        type="checkbox"
                        {...register(`tools.${index}.params.${paramIndex}.required`)}
                        className="h-4 w-4 accent-brasa"
                      />
                      Requerido
                    </label>
                    <button
                      type="button"
                      onClick={() => removeParam(paramIndex)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-grafito-border px-3 py-1.5 text-xs font-medium text-brasa transition hover:border-brasa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar
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
              Agregar parametro
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
              <p className="mt-1.5 text-sm text-brasa">{toolErrors.rawSchema.message}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
