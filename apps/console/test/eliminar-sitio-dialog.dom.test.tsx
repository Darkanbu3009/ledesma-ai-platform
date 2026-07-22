// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EliminarSitioDialog } from '../src/components/sitios/EliminarSitioDialog';

afterEach(cleanup);

function setup(props?: Partial<Parameters<typeof EliminarSitioDialog>[0]>) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <EliminarSitioDialog
      open
      dominio="app.ejemplo.com"
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe('EliminarSitioDialog (confirmacion del borrado forzado)', () => {
  it('advierte que la conexion se eliminara de todos modos, pase lo que pase con el proveedor', () => {
    setup();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('app.ejemplo.com')).toBeInTheDocument();
    expect(screen.getByText(/eliminará permanentemente/i)).toBeInTheDocument();
    expect(screen.getByText(/se eliminará de todos modos/i)).toBeInTheDocument();
  });

  it('confirmar dispara onConfirm; cancelar dispara onCancel', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Eliminar de todos modos/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('busy deshabilita el confirmar y muestra el estado "Eliminando"', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: /Eliminando/ })).toBeDisabled();
  });

  it('muestra el error del backend dentro del modal', () => {
    setup({ error: 'Algo salió mal. Intenta de nuevo.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/algo salió mal/i);
  });

  it('cerrado (open=false) no renderiza nada', () => {
    render(
      <EliminarSitioDialog
        open={false}
        dominio="app.ejemplo.com"
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
