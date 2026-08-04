// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SystemsFlipCard } from '../src/components/landing/systems-flip-card';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Contenedor focusable de la tarjeta (el que gira y recibe clic/teclado). */
function tarjeta(): HTMLElement {
  return screen.getByRole('button');
}

/**
 * Raiz de una cara: el div con aria-hidden que envuelve el titulo dado. El titulo tambien
 * aparece en la region aria-live (fuera de las caras), por eso se filtra por ancestro.
 */
function cara(titulo: string): HTMLElement {
  const raices = screen
    .getAllByText(titulo)
    .map((el) => el.closest('div[aria-hidden]'))
    .filter((el): el is HTMLElement => el !== null);
  if (raices.length !== 1) throw new Error(`Cara no unica para el titulo: ${titulo}`);
  const unica = raices[0];
  if (unica === undefined) throw new Error(`Cara sin raiz aria-hidden: ${titulo}`);
  return unica;
}

const caraA = (): HTMLElement => cara('Tus sistemas');
const caraB = (): HTMLElement => cara('Tu día a día');

/** matchMedia falso: reporta prefers-reduced-motion: reduce activo. */
function stubReducedMotion(): void {
  vi.stubGlobal('matchMedia', ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia);
}

describe('SystemsFlipCard (tarjeta de dos caras del hero)', () => {
  it('el ciclo automatico alterna caras cada 7s y hover o foco detienen el timer', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    expect(caraB()).toHaveAttribute('aria-hidden', 'true');

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    expect(caraA()).toHaveAttribute('aria-hidden', 'true');

    // Pausa por hover: con el puntero encima el timer queda parado.
    fireEvent.mouseOver(tarjeta());
    act(() => {
      vi.advanceTimersByTime(21000);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // Al salir el puntero, la cuenta de 7s arranca de cero y vuelve a alternar.
    fireEvent.mouseOut(tarjeta());
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // Pausa por foco, mismo contrato que el hover.
    fireEvent.focus(tarjeta());
    act(() => {
      vi.advanceTimersByTime(21000);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    fireEvent.blur(tarjeta());
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
  });

  it('el clic voltea al momento y reinicia la cuenta del ciclo', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    fireEvent.click(tarjeta());
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // La cuenta vieja (que vencia a los 3000ms restantes) quedo descartada: a los 6999ms
    // del clic aun no gira y al cumplirse los 7000ms alterna de nuevo.
    act(() => {
      vi.advanceTimersByTime(6999);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
  });

  it('la cara oculta va aria-hidden e inert (fuera del tab order) y la tarjeta es focusable', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    expect(tarjeta()).toHaveAttribute('tabindex', '0');
    expect(caraB()).toHaveAttribute('aria-hidden', 'true');
    expect(caraB()).toHaveAttribute('inert');
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    expect(caraA()).not.toHaveAttribute('inert');

    // Tras girar, los atributos se intercambian.
    fireEvent.click(tarjeta());
    expect(caraA()).toHaveAttribute('aria-hidden', 'true');
    expect(caraA()).toHaveAttribute('inert');
    expect(caraB()).not.toHaveAttribute('inert');
  });

  it('con prefers-reduced-motion no hay giro automatico y el cambio manual sigue funcionando', () => {
    stubReducedMotion();
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // El cambio manual queda disponible como crossfade (sin transform de rotacion).
    fireEvent.click(tarjeta());
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    expect(tarjeta().style.transform).toBe('');
  });
});
