// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useDialog } from '../src/components/ui/useDialog';

afterEach(cleanup);

function TestDialog({
  onClose,
  closeOnEscape,
}: {
  onClose: () => void;
  closeOnEscape?: boolean;
}) {
  const ref = useDialog({ onClose, closeOnEscape });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test">
      <button>primero</button>
      <button>segundo</button>
      <button>tercero</button>
    </div>
  );
}

describe('useDialog (gestion de foco de dialogos)', () => {
  it('enfoca el primer control al abrir', () => {
    render(<TestDialog onClose={() => {}} />);
    expect(screen.getByText('primero')).toHaveFocus();
  });

  it('cierra con Escape', () => {
    const onClose = vi.fn();
    render(<TestDialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no cierra con Escape cuando closeOnEscape es false', () => {
    const onClose = vi.fn();
    render(<TestDialog onClose={onClose} closeOnEscape={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('atrapa el foco: Tab desde el ultimo vuelve al primero', () => {
    render(<TestDialog onClose={() => {}} />);
    const last = screen.getByText('tercero');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByText('primero')).toHaveFocus();
  });

  it('atrapa el foco: Shift+Tab desde el primero salta al ultimo', () => {
    render(<TestDialog onClose={() => {}} />);
    const first = screen.getByText('primero');
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('tercero')).toHaveFocus();
  });

  it('devuelve el foco al disparador al cerrar', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'disparador';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(<TestDialog onClose={() => {}} />);
    // Al montar, el foco se movio dentro del dialogo.
    expect(trigger).not.toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
