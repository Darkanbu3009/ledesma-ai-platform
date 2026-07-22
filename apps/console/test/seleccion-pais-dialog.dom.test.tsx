// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SeleccionPaisDialog } from '../src/components/sitios/SeleccionPaisDialog';

afterEach(cleanup);

function setup(props?: Partial<Parameters<typeof SeleccionPaisDialog>[0]>) {
  const onGuardar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <SeleccionPaisDialog
      open
      busy={false}
      error={null}
      onGuardar={onGuardar}
      onCancelar={onCancelar}
      {...props}
    />,
  );
  return { onGuardar, onCancelar };
}

describe('SeleccionPaisDialog (captura del pais antes de la primera conexion)', () => {
  it('explica POR QUE se pide el pais y ofrece la lista completa ISO 3166-1', () => {
    setup();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByText(/Tus agentes navegarán desde tu país para que tus sesiones se mantengan estables/),
    ).toBeInTheDocument();
    // Se avisa que solo se pide una vez y que sigue editable en la configuracion de la cuenta.
    expect(screen.getByText(/solo se pide una vez/i)).toBeInTheDocument();
    const select = screen.getByLabelText<HTMLSelectElement>('País');
    // 249 paises + el placeholder deshabilitado: CUALQUIER pais, ninguno privilegiado.
    expect(select.options).toHaveLength(250);
    const valores = Array.from(select.options).map((opcion) => opcion.value);
    for (const codigo of ['MX', 'AR', 'US', 'JP', 'NG']) {
      expect(valores).toContain(codigo);
    }
  });

  it('preselecciona la sugerencia del navegador (jsdom: en-US -> US), que el usuario puede cambiar', () => {
    const { onGuardar } = setup();
    const select = screen.getByLabelText<HTMLSelectElement>('País');
    expect(select.value).toBe('US');
    fireEvent.change(select, { target: { value: 'AR' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar y conectar/ }));
    expect(onGuardar).toHaveBeenCalledWith('AR');
  });

  it('cancelar dispara onCancelar sin guardar', () => {
    const { onGuardar, onCancelar } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('busy deshabilita guardar y muestra "Guardando"', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: /Guardando/ })).toBeDisabled();
  });

  it('muestra el error de guardado dentro del modal', () => {
    setup({ error: 'No pudimos guardar tu país. Inténtalo de nuevo.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/no pudimos guardar tu país/i);
  });

  it('cerrado (open=false) no renderiza nada', () => {
    render(
      <SeleccionPaisDialog open={false} busy={false} error={null} onGuardar={() => {}} onCancelar={() => {}} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
