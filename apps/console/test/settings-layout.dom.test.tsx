// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SettingsLayout } from '../src/pages/SettingsLayout';

/**
 * El shell se testea con un arbol de rutas que espeja el de App.tsx (mismo SettingsLayout y mismos
 * Navigate; las sub-vistas reales se sustituyen por stubs para no arrastrar sus hooks de datos).
 * Pinta el contrato de la seccion: titulo, ausencia de tabs (al catalogo de planes se llega por el
 * sub-item "Mejorar Plan" del sidebar) y los dos redirects.
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
  it('muestra el titulo de seccion sin barra de tabs y monta la sub-vista de cuenta', () => {
    renderAt('/configuracion/cuenta');

    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Paquetes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument();
    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
  });

  it('la ruta de paquetes sigue montando su sub-vista bajo el mismo shell', () => {
    renderAt('/configuracion/paquetes');

    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByText('vista paquetes')).toBeInTheDocument();
  });

  it('la ruta base /configuracion redirige a la sub-vista de cuenta', () => {
    renderAt('/configuracion');

    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
  });

  it('la URL historica /perfil redirige a /configuracion/cuenta', () => {
    renderAt('/perfil');

    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
  });
});
