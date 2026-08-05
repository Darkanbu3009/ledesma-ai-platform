// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SystemsFlipCard } from '../src/components/landing/systems-flip-card';

/** Carpeta de assets estaticos de la consola, donde viven los logos de ambas caras. */
const PUBLIC_DIR = join(__dirname, '..', 'public');

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
  it('el primer render muestra "Tu dia a dia" y el ciclo alterna cada 7s; hover o foco detienen el timer', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);
    // La cara B es la visible desde el primer render (sin flash de la cara A).
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    expect(caraA()).toHaveAttribute('aria-hidden', 'true');

    // El primer giro automatico revela "Tus sistemas".
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    expect(caraB()).toHaveAttribute('aria-hidden', 'true');

    // Pausa por hover: con el puntero encima el timer queda parado.
    fireEvent.mouseOver(tarjeta());
    act(() => {
      vi.advanceTimersByTime(21000);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // Al salir el puntero, la cuenta de 7s arranca de cero y vuelve a alternar.
    fireEvent.mouseOut(tarjeta());
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // Pausa por foco, mismo contrato que el hover.
    fireEvent.focus(tarjeta());
    act(() => {
      vi.advanceTimersByTime(21000);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    fireEvent.blur(tarjeta());
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
  });

  it('el clic voltea al momento y reinicia la cuenta del ciclo', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    fireEvent.click(tarjeta());
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // La cuenta vieja (que vencia a los 3000ms restantes) quedo descartada: a los 6999ms
    // del clic aun no gira y al cumplirse los 7000ms alterna de nuevo.
    act(() => {
      vi.advanceTimersByTime(6999);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
  });

  it('la cara oculta va aria-hidden e inert (fuera del tab order) y la tarjeta es focusable', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    expect(tarjeta()).toHaveAttribute('tabindex', '0');
    expect(caraA()).toHaveAttribute('aria-hidden', 'true');
    expect(caraA()).toHaveAttribute('inert');
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    expect(caraB()).not.toHaveAttribute('inert');

    // Tras girar, los atributos se intercambian.
    fireEvent.click(tarjeta());
    expect(caraB()).toHaveAttribute('aria-hidden', 'true');
    expect(caraB()).toHaveAttribute('inert');
    expect(caraA()).not.toHaveAttribute('inert');
  });

  it('con prefers-reduced-motion no hay giro automatico y el cambio manual sigue funcionando', () => {
    stubReducedMotion();
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // El cambio manual queda disponible como crossfade (sin transform de rotacion).
    fireEvent.click(tarjeta());
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    expect(tarjeta().style.transform).toBe('');
  });

  it('la cara "Tu dia a dia" renderiza los logos oficiales como assets locales del repo', () => {
    vi.useFakeTimers();
    render(<SystemsFlipCard />);

    // Cada marca aparece como <img> con su alt y apunta a un asset local (no CDN),
    // con la misma convencion de nombres que los logos de la cara A en public/.
    const esperados = [
      { nombre: 'WhatsApp', src: '/WhatsApp.svg' },
      { nombre: 'Gmail', src: '/Gmail.svg' },
      { nombre: 'Amazon', src: '/Amazon.svg' },
      { nombre: 'Facebook', src: '/Facebook.svg' }
    ];
    for (const { nombre, src } of esperados) {
      const img = screen.getByAltText(`Logo de ${nombre}`);
      expect(img).toHaveAttribute('src', src);
      // El asset existe en el repo, junto a los PNG de la cara A.
      expect(existsSync(join(PUBLIC_DIR, src.slice(1)))).toBe(true);
    }
  });
});
