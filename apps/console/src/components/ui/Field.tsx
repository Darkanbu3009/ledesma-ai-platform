import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/** Props que `Field` inyecta en el control para asociarlo con su label y sus mensajes. */
export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};

/**
 * Campo de formulario con label ASOCIADO programaticamente al control (`htmlFor`/`id`), mensaje de
 * error anunciado (`role="alert"`) y referenciado desde el control (`aria-describedby` + `aria-invalid`).
 *
 * Para el caso comun, `children` es un unico control (`input`/`select`/`textarea`) y `Field` le clona
 * esos atributos. Cuando el control va envuelto, es condicional, o viene acompanado (p.ej. un `datalist`
 * o un boton de mostrar/ocultar), pasa `children` como funcion y esparce los props donde corresponda:
 *
 *   <Field label="API key" error={err}>
 *     {(field) => <div className="relative"><input {...field} /> ...</div>}
 *   </Field>
 */
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
  hint?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const showHint = Boolean(hint) && !error;
  const control: FieldControlProps = {
    id,
    'aria-describedby': error ? errorId : showHint ? hintId : undefined,
    'aria-invalid': error ? true : undefined,
  };

  let rendered: ReactNode;
  if (typeof children === 'function') {
    rendered = children(control);
  } else if (isValidElement(children)) {
    // Clonamos solo si el control no traia ya un id propio (no lo pisamos).
    const childProps = children.props as Record<string, unknown>;
    rendered = cloneElement(children as ReactElement<Record<string, unknown>>, {
      ...control,
      ...('id' in childProps ? { id: childProps.id } : null),
    });
  } else {
    rendered = children;
  }

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">
        {label}
      </label>
      {rendered}
      {showHint && (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-brasa">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl border border-line bg-field px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/20';
