// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/i18n';
import { SystemsFlipCard } from '../src/components/landing/systems-flip-card';

/** Carpeta de assets estaticos de la consola, donde viven los logos de ambas caras. */
const PUBLIC_DIR = join(__dirname, '..', 'public');

afterEach(() => {
  cleanup();
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

/**
 * Renderiza la tarjeta controlando `ronda` como lo hace el hero: cada incremento simula
 * una ronda completa del ciclo de modelos. Devuelve el avance de ronda y el spy de pausa.
 */
function renderTarjeta(): { avanzarRonda: (ronda: number) => void; onPauseChange: ReturnType<typeof vi.fn> } {
  const onPauseChange = vi.fn();
  const vista = render(<SystemsFlipCard ronda={0} onPauseChange={onPauseChange} />);
  const avanzarRonda = (ronda: number): void => {
    vista.rerender(<SystemsFlipCard ronda={ronda} onPauseChange={onPauseChange} />);
  };
  return { avanzarRonda, onPauseChange };
}

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
  it('el primer render muestra "Tu dia a dia" y cada ronda del ciclo de modelos voltea exactamente una vez', () => {
    const { avanzarRonda } = renderTarjeta();
    // La cara B es la visible desde el primer render (sin flash de la cara A).
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
    expect(caraA()).toHaveAttribute('aria-hidden', 'true');

    // La primera ronda completa revela "Tus sistemas".
    act(() => {
      avanzarRonda(1);
    });
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    expect(caraB()).toHaveAttribute('aria-hidden', 'true');

    // La siguiente ronda vuelve a "Tu dia a dia": un giro por ronda, ni mas ni menos.
    act(() => {
      avanzarRonda(2);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
  });

  it('hover y foco notifican la pausa al padre (que detiene el reloj compartido) y al salir la levantan', () => {
    const { onPauseChange } = renderTarjeta();

    fireEvent.mouseOver(tarjeta());
    expect(onPauseChange).toHaveBeenLastCalledWith(true);
    fireEvent.mouseOut(tarjeta());
    expect(onPauseChange).toHaveBeenLastCalledWith(false);

    // Pausa por foco, mismo contrato que el hover.
    fireEvent.focus(tarjeta());
    expect(onPauseChange).toHaveBeenLastCalledWith(true);
    fireEvent.blur(tarjeta());
    expect(onPauseChange).toHaveBeenLastCalledWith(false);
  });

  it('el clic voltea al momento y la siguiente ronda vuelve a girar normal (sin desincronizar)', () => {
    const { avanzarRonda } = renderTarjeta();

    fireEvent.click(tarjeta());
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');

    // El giro manual no toca el reloj: al cerrar la ronda en curso la tarjeta gira igual.
    act(() => {
      avanzarRonda(1);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');
  });

  it('la cara oculta va aria-hidden e inert (fuera del tab order) y la tarjeta es focusable', () => {
    renderTarjeta();

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

  it('con prefers-reduced-motion no hay giro automatico (ignora las rondas) y el cambio manual sigue funcionando', () => {
    stubReducedMotion();
    const { avanzarRonda, onPauseChange } = renderTarjeta();

    act(() => {
      avanzarRonda(1);
    });
    act(() => {
      avanzarRonda(2);
    });
    expect(caraB()).toHaveAttribute('aria-hidden', 'false');

    // Sin giro que desalinear, el hover tampoco pausa la rotacion de modelos.
    fireEvent.mouseOver(tarjeta());
    expect(onPauseChange).not.toHaveBeenCalled();

    // El cambio manual queda disponible como crossfade (sin transform de rotacion).
    fireEvent.click(tarjeta());
    expect(caraA()).toHaveAttribute('aria-hidden', 'false');
    expect(tarjeta().style.transform).toBe('');
  });

  it('la cara "Tu dia a dia" renderiza los logos oficiales como assets locales del repo', () => {
    renderTarjeta();

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

  it('la cara "Tus sistemas" lleva su pie de cierre con la clave i18n en ES y EN', async () => {
    renderTarjeta();

    // ES (idioma por defecto de los tests): el pie vive dentro de la cara A.
    const pieEs = screen.getByText('Plataformas, aplicaciones y más');
    expect(caraA()).toContainElement(pieEs);

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByText('Platforms, apps and more')).toBeInTheDocument();

    // Se restaura el espanol para no contaminar otros archivos de tests.
    await act(async () => {
      await i18n.changeLanguage('es');
    });
  });
});
