// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mismo aislamiento que admin.dom.test.tsx: el Sidebar tira de useIsAdmin/useMe (react-query),
// useAuth (AuthContext) y supabase (que lee env al importarse); se mockean para renderizarlo suelto.
const { useMeMock, signOutMock } = vi.hoisted(() => ({
  useMeMock: vi.fn(),
  signOutMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/queries', () => ({
  useIsAdmin: () => ({ isAdmin: false, isLoading: false }),
  useMe: useMeMock,
}));
vi.mock('../src/auth/useAuth', () => ({
  useAuth: () => ({ user: { email: 'ada@example.com' }, session: null, loading: false }),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: signOutMock } } }));

import { Sidebar } from '../src/components/layout/Sidebar';

/** El destino real de Configuracion se sustituye por un stub para observar la navegacion. */
function renderSidebar(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
      <Routes>
        <Route path="/configuracion/cuenta" element={<p>vista cuenta</p>} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

function accountButton() {
  return screen.getByRole('button', { expanded: false, name: /Ada Lovelace|ada@example\.com/ });
}

afterEach(() => {
  cleanup();
  useMeMock.mockReset();
  signOutMock.mockClear();
});

describe('UserMenu (menu de usuario del footer del sidebar)', () => {
  it('el boton de cuenta muestra el nombre y el avatar con las iniciales del full_name', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    const trigger = screen.getByRole('button', { name: 'Ada Lovelace' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('sin full_name cae al email y a su inicial', () => {
    useMeMock.mockReturnValue({ data: undefined });
    renderSidebar();

    expect(screen.getByRole('button', { name: 'ada@example.com' })).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('al click abre el menu con cabecera de identidad y las dos opciones', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument();
    // Cabecera del menu: nombre + email (el nombre tambien esta en el boton, por eso >= 2).
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    // El foco pasa al primer item (patron de menu WAI-ARIA).
    expect(screen.getByRole('menuitem', { name: 'Configuración' })).toHaveFocus();
  });

  it('se cierra con Escape devolviendo el foco al boton de cuenta', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ada Lovelace' })).toHaveFocus();
  });

  it('se cierra al hacer clic afuera (click-away)', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Configuracion navega a /configuracion/cuenta y cierra el menu', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configuración' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText('vista cuenta')).toBeInTheDocument();
  });

  it('Cerrar sesion dispara el mismo handler de signOut y cierra el menu', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('las flechas ciclan el foco entre los items del menu', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    const menu = screen.getByRole('menu');
    const config = screen.getByRole('menuitem', { name: 'Configuración' });
    const logout = screen.getByRole('menuitem', { name: 'Cerrar sesión' });

    expect(config).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(config).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(logout).toHaveFocus();
  });
});

describe('Sidebar (item Configuracion en la lista principal)', () => {
  it('agrega el item con destino /configuracion, inactivo fuera de la seccion', () => {
    useMeMock.mockReturnValue({ data: undefined });
    renderSidebar('/dashboard');

    const link = screen.getByRole('link', { name: 'Configuración' });
    expect(link).toHaveAttribute('href', '/configuracion');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('marca activo el item en cualquier ruta de /configuracion (prefix-match)', () => {
    useMeMock.mockReturnValue({ data: undefined });
    renderSidebar('/configuracion/paquetes');

    expect(screen.getByRole('link', { name: 'Configuración' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
