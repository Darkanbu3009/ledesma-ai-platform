// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LoginEnVivoDialog } from '../src/components/sitios/LoginEnVivoDialog';
import type { SitioConectado } from '../src/lib/sitios';

// Se mockea el relay de teclado movil: su montaje real hace fetch + WebCrypto. Aca solo verificamos
// que el modal lo monta SOLO en tactil y jamas en desktop (el flujo directo del iframe queda intacto).
vi.mock('../src/components/sitios/RelayTecladoMovil', () => ({
  RelayTecladoMovil: ({ sitioId }: { sitioId: string }) => (
    <div data-testid="relay-movil">{sitioId}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sitio: SitioConectado = {
  id: 'sit_1',
  dominio: 'en.wikipedia.org',
  estado: 'esperando_login',
  vistaEnVivoUrl: 'https://proveedor.example/vista-en-vivo/abc',
  creadoEn: '2026-07-23T00:00:00Z',
  ultimoUsoEn: null,
};

function setup() {
  render(
    <LoginEnVivoDialog
      sitio={sitio}
      confirmando={false}
      error={null}
      onConfirmar={() => {}}
      onCerrar={() => {}}
    />,
  );
}

/** Simula el medio: `matches` responde true solo si el media query coincide con `tactil`. */
function stubMatchMedia(tactil: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: tactil && query === '(hover: none) and (pointer: coarse)',
      media: query,
    })),
  );
}

describe('LoginEnVivoDialog: desktop directo vs relay de teclado movil', () => {
  it('en dispositivo tactil monta el relay de teclado movil, con la vista en vivo embebida', () => {
    stubMatchMedia(true);
    setup();
    expect(screen.getByTestId('relay-movil')).toHaveTextContent('sit_1');
    expect(screen.getByTitle(/en\.wikipedia\.org/)).toHaveAttribute(
      'src',
      'https://proveedor.example/vista-en-vivo/abc',
    );
  });

  it('en desktop (puntero fino) NO monta el relay: entrada directa al iframe, sin cambios', () => {
    stubMatchMedia(false);
    setup();
    expect(screen.queryByTestId('relay-movil')).not.toBeInTheDocument();
    expect(screen.getByTitle(/en\.wikipedia\.org/)).toBeInTheDocument();
  });

  it('sin matchMedia (entorno minimo) no monta el relay ni truena', () => {
    setup();
    expect(screen.queryByTestId('relay-movil')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
