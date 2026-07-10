// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SettingsLayout } from '../src/pages/SettingsLayout';

/**
 * El shell se testea con un arbol de rutas que espeja el de App.tsx (mismo SettingsLayout y mismos
 * Navigate; las sub-vistas reales se sustituyen por stubs para no arrastrar sus hooks de datos).
 * Pinta el contrato de la seccion: titulo, tabs con aria-current y los dos redirects.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracion" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/configuracion/cuenta" replace />} />
          <Route path="cuenta" element={<p>vista cuenta</p>} />
          <Route path="paquetes" element={<p>vista paquetes</p>} />
        </Route>
        <Route path="/perfil" element={<Navigate to="/configuracion/cuenta" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('SettingsLayout', () => {
  it('muestra el titulo de seccion y los dos tabs con sus destinos', () => {
    renderAt('/configuracion/cuenta');

    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute(
      'href',
      '/configuracion/cuenta',
    );
    expect(screen.getByRole('link', { name: 'Paquetes' })).toHaveAttribute(
      'href',
      '/configuracion/paquetes',
    );
    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
  });

  it('marca el tab activo con aria-current y monta la sub-vista correspondiente', () => {
    renderAt('/configuracion/paquetes');

    expect(screen.getByRole('link', { name: 'Paquetes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('vista paquetes')).toBeInTheDocument();
  });

  it('la ruta base /configuracion redirige a la sub-vista de cuenta', () => {
    renderAt('/configuracion');

    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('aria-current', 'page');
  });

  it('la URL historica /perfil redirige a /configuracion/cuenta', () => {
    renderAt('/perfil');

    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
  });
});
