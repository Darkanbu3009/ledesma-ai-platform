// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DeleteAccountDialog } from '../src/components/account/DeleteAccountDialog';

afterEach(cleanup);

function setup(props?: Partial<Parameters<typeof DeleteAccountDialog>[0]>) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteAccountDialog
      expectedEmail="ada@example.com"
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

const confirmBtn = () => screen.getByRole('button', { name: /Eliminar definitivamente/ });
const emailInput = () => screen.getByLabelText(/escribe tu email/i);

describe('DeleteAccountDialog (confirmacion fuerte por escritura del email)', () => {
  it('advierte que es permanente e irreversible y que se borra todo', () => {
    setup();
    expect(screen.getByText(/permanente e irreversible/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('el boton de confirmar esta DESHABILITADO hasta que el email escrito coincide', () => {
    setup();
    expect(confirmBtn()).toBeDisabled();

    // Email incorrecto -> sigue deshabilitado.
    fireEvent.change(emailInput(), { target: { value: 'otra@example.com' } });
    expect(confirmBtn()).toBeDisabled();

    // Email correcto (normalizado: mayusculas/espacios) -> se habilita.
    fireEvent.change(emailInput(), { target: { value: '  ADA@example.COM ' } });
    expect(confirmBtn()).toBeEnabled();
  });

  it('al confirmar con el email correcto llama onConfirm con el email (recortado)', () => {
    const { onConfirm } = setup();
    fireEvent.change(emailInput(), { target: { value: '  ada@example.com ' } });
    fireEvent.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('ada@example.com');
  });

  it('con email incorrecto no dispara onConfirm ni al hacer submit', () => {
    const { onConfirm } = setup();
    fireEvent.change(emailInput(), { target: { value: 'otra@example.com' } });
    fireEvent.click(confirmBtn());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('muestra el error del backend dentro del modal (p.ej. 400 email no coincide)', () => {
    setup({ error: 'El email no coincide con el de tu cuenta.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/no coincide/i);
  });

  it('el estado de carga deshabilita el confirmar y muestra "Eliminando..."', () => {
    setup({ busy: true });
    fireEvent.change(emailInput(), { target: { value: 'ada@example.com' } });
    // Aun coincidiendo, busy lo mantiene deshabilitado.
    expect(screen.getByRole('button', { name: /Eliminando/ })).toBeDisabled();
  });

  it('la salida siempre visible: Cancelar llama onCancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cierra con Escape (foco atrapado via useDialog)', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: sin email esperado el boton nunca se habilita', () => {
    setup({ expectedEmail: undefined });
    fireEvent.change(emailInput(), { target: { value: 'ada@example.com' } });
    expect(confirmBtn()).toBeDisabled();
  });
});
