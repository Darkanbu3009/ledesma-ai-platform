// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// El hook de borrado se mockea (arrastra supabase + react-router): se ejerce la orquestacion de la seccion
// (abrir el modal, confirmar por escritura del email, disparar la mutacion) sin red ni Router real.
const { useDeleteAccountMock } = vi.hoisted(() => ({ useDeleteAccountMock: vi.fn() }));
vi.mock('../src/lib/account-mutations', () => ({ useDeleteAccount: useDeleteAccountMock }));

import { DangerZoneSection } from '../src/components/account/DangerZoneSection';

function mockMutation(over: Partial<{ isPending: boolean; isError: boolean; error: unknown }> = {}) {
  const mutate = vi.fn();
  const reset = vi.fn();
  useDeleteAccountMock.mockReturnValue({
    mutate,
    reset,
    isPending: over.isPending ?? false,
    isError: over.isError ?? false,
    error: over.error ?? null,
  });
  return { mutate, reset };
}

afterEach(() => {
  cleanup();
  useDeleteAccountMock.mockReset();
});

describe('DangerZoneSection', () => {
  it('muestra la zona de peligro con la advertencia de irreversibilidad y el boton de abrir', () => {
    mockMutation();
    render(<DangerZoneSection email="ada@example.com" />);

    expect(screen.getByRole('heading', { name: /Zona de peligro/i })).toBeInTheDocument();
    expect(screen.getByText(/no se puede deshacer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eliminar mi cuenta/i })).toBeInTheDocument();
    // El modal no esta montado hasta abrir.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre el modal (reseteando la mutacion) al pulsar "Eliminar mi cuenta"', () => {
    const { reset } = mockMutation();
    render(<DangerZoneSection email="ada@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /Eliminar mi cuenta/i }));

    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('confirma el borrado: escribe el email correcto y dispara la mutacion con ese email', () => {
    const { mutate } = mockMutation();
    render(<DangerZoneSection email="ada@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /Eliminar mi cuenta/i }));
    fireEvent.change(screen.getByLabelText(/escribe tu email/i), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Eliminar definitivamente/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith('ada@example.com');
  });

  it('propaga el error del backend al modal (traducido)', () => {
    mockMutation({ isError: true, error: { status: 400 } });
    render(<DangerZoneSection email="ada@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /Eliminar mi cuenta/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/no coincide/i);
  });

  it('cancelar cierra el modal sin borrar', () => {
    const { mutate } = mockMutation();
    render(<DangerZoneSection email="ada@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /Eliminar mi cuenta/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
