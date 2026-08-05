// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HeroShowcase } from '../src/components/landing/hero-showcase';

/** Cadencia real del ciclo de modelos (misma constante que hero-showcase.tsx). */
const CYCLE_MS = 2600;
/** Una ronda entera: los tres modelos (Claude -> ChatGPT -> Open source -> Claude). */
const RONDA_MS = CYCLE_MS * 3;
/** Margen para que termine el giro 3D de la carta del modelo (~500ms por cambio). */
const GIRO_MS = 600;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * matchMedia falso sin movimiento reducido y sin hover tactil salvo `(hover: none)`, que
 * se reporta activo para que PixelDataFlow (canvas) no monte su efecto en jsdom.
 */
function stubMatchMedia(): void {
  vi.stubGlobal('matchMedia', ((query: string) => ({
    matches: query === '(hover: none)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia);
}

function renderHero(): void {
  stubMatchMedia();
  // jsdom no implementa CSS.supports (lo usa PixelDataFlow para validar el acento).
  vi.stubGlobal('CSS', { supports: () => false });
  vi.useFakeTimers();
  render(<HeroShowcase />);
}

/** Raiz de una cara de la tarjeta de dos caras (div aria-hidden que envuelve el titulo). */
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

/** La tarjeta de dos caras (contenedor focusable que gira con clic/teclado). */
function tarjetaDosCaras(): HTMLElement {
  return screen.getByRole('button', {
    name: 'Tarjeta de dos caras: tus sistemas de trabajo y tus aplicaciones de todos los días. Pulsa para girar.'
  });
}

/** Chip de un proveedor de la carta del modelo (boton con aria-pressed). */
function chip(label: string): HTMLElement {
  return screen.getByRole('button', { name: `Cambiar modelo a ${label}` });
}

function avanzar(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('HeroShowcase (reloj unico: ciclo de modelos + giro de la tarjeta de dos caras)', () => {
  it('al completarse una ronda de tres modelos la tarjeta voltea exactamente una vez', () => {
    renderHero();

    // Arranque: cara B ("Tu dia a dia") visible y Claude activo.
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    expect(chip('Claude')).toHaveAttribute('aria-pressed', 'true');

    // Durante la ronda (ChatGPT y Open source) la tarjeta NO gira.
    avanzar(CYCLE_MS + GIRO_MS);
    expect(chip('ChatGPT')).toHaveAttribute('aria-pressed', 'true');
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    avanzar(CYCLE_MS);
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // Al volver a Claude se cierra la ronda: la tarjeta voltea a "Tus sistemas".
    avanzar(CYCLE_MS);
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // Y solo una vez: la ronda siguiente corre entera con la cara A...
    avanzar(CYCLE_MS);
    avanzar(CYCLE_MS);
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // ...hasta cerrarse, cuando vuelve a girar a la cara B.
    avanzar(CYCLE_MS);
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
  });

  it('el clic manual voltea sin desincronizar: la ronda en curso cierra a su hora y gira normal', () => {
    renderHero();

    // A mitad de ronda, el clic voltea al momento.
    avanzar(CYCLE_MS + GIRO_MS);
    fireEvent.click(tarjetaDosCaras());
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // El reloj no se toco: la ronda cierra en su tick original y la tarjeta gira igual.
    avanzar(RONDA_MS - CYCLE_MS - GIRO_MS);
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    // La rotacion de modelos tampoco se altero: la ronda cerro de vuelta en Claude.
    avanzar(GIRO_MS);
    expect(chip('Claude')).toHaveAttribute('aria-pressed', 'true');
  });

  it('el hover sobre la tarjeta de dos caras pausa ambos ciclos a la vez y al salir se reanudan', () => {
    renderHero();

    // Pausa inmediata: con el puntero encima ni el modelo avanza ni la tarjeta gira.
    fireEvent.mouseOver(tarjetaDosCaras());
    avanzar(RONDA_MS * 3);
    expect(chip('Claude')).toHaveAttribute('aria-pressed', 'true');
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // Al salir el puntero ambos ciclos retoman juntos: la ronda cierra y la tarjeta gira.
    fireEvent.mouseOut(tarjetaDosCaras());
    avanzar(RONDA_MS);
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    avanzar(GIRO_MS);
    expect(chip('Claude')).toHaveAttribute('aria-pressed', 'true');
  });
});
