// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Field } from '../src/components/ui/Field';

afterEach(cleanup);

describe('Field (accesibilidad de formularios)', () => {
  it('asocia el label con el control (getByLabelText encuentra el input)', () => {
    render(
      <Field label="Etiqueta">
        <input />
      </Field>,
    );
    // Si el label no estuviera asociado por htmlFor/id, getByLabelText fallaria.
    const input = screen.getByLabelText('Etiqueta');
    expect(input.tagName).toBe('INPUT');
    const label = screen.getByText('Etiqueta');
    expect(label).toHaveAttribute('for', input.getAttribute('id'));
  });

  it('anuncia el error con role="alert" y lo referencia desde el control', () => {
    render(
      <Field label="Etiqueta" error="Campo obligatorio">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Etiqueta');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Campo obligatorio');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alert.getAttribute('id'));
  });

  it('referencia el hint cuando no hay error', () => {
    render(
      <Field label="Etiqueta" hint="Un texto de ayuda">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Etiqueta');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Un texto de ayuda');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('soporta la forma render-prop para controles envueltos', () => {
    render(
      <Field label="API key" error="Requerida">
        {(control) => (
          <div className="relative">
            <input {...control} />
            <button type="button">ojo</button>
          </div>
        )}
      </Field>,
    );
    // El id/aria cayo sobre el input real (no sobre el div envolvente).
    const input = screen.getByLabelText('API key');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
