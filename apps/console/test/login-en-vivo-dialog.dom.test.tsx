// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LoginEnVivoDialog } from '../src/components/sitios/LoginEnVivoDialog';
import type { SitioConectado } from '../src/lib/sitios';

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

describe('LoginEnVivoDialog (aviso de teclado movil no soportado)', () => {
  it('en dispositivo tactil muestra el aviso y la vista en vivo sigue embebida', () => {
    stubMatchMedia(true);
    setup();
    expect(screen.getByRole('note')).toHaveTextContent(/computadora/i);
    expect(screen.getByTitle(/en\.wikipedia\.org/)).toHaveAttribute(
      'src',
      'https://proveedor.example/vista-en-vivo/abc',
    );
  });

  it('en desktop (puntero fino) no muestra el aviso', () => {
    stubMatchMedia(false);
    setup();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('sin matchMedia (entorno minimo) no muestra el aviso ni truena', () => {
    setup();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
