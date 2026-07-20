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

/** Los destinos reales del menu se sustituyen por stubs para observar la navegacion. */
function renderSidebar(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
      <Routes>
        <Route path="/configuracion/cuenta" element={<p>vista cuenta</p>} />
        <Route path="/configuracion/paquetes" element={<p>vista paquetes</p>} />
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

  it('al click abre el menu con cabecera de identidad y las tres opciones en orden', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    // Orden: Configuracion, Mejorar Plan, separador, Cerrar sesion.
    const itemNames = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(itemNames).toEqual(['Configuración', 'Mejorar Plan', 'Cerrar sesión']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
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

  it('Mejorar Plan navega a /configuracion/paquetes y cierra el menu', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mejorar Plan' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText('vista paquetes')).toBeInTheDocument();
  });

  it('Cerrar sesion dispara el mismo handler de signOut y cierra el menu', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('las flechas ciclan el foco entre los tres items del menu', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar();

    fireEvent.click(accountButton());
    const menu = screen.getByRole('menu');
    const config = screen.getByRole('menuitem', { name: 'Configuración' });
    const upgrade = screen.getByRole('menuitem', { name: 'Mejorar Plan' });
    const logout = screen.getByRole('menuitem', { name: 'Cerrar sesión' });

    expect(config).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(upgrade).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(config).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(logout).toHaveFocus();
  });
});

describe('Sidebar (lista principal sin Configuracion ni Mejorar Plan)', () => {
  it('la lista de navegacion tiene solo las 9 secciones de la app', () => {
    useMeMock.mockReturnValue({ data: undefined });
    renderSidebar('/dashboard');

    const labels = screen.getAllByRole('link').map((el) => el.textContent);
    expect(labels).toEqual([
      'Panel',
      'Agentes',
      'Recetas',
      'Tareas',
      'Triggers',
      'Sitios',
      'Actividad',
      'Credenciales',
      'Privacidad',
    ]);
    expect(screen.queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mejorar Plan' })).not.toBeInTheDocument();
  });

  it('en /configuracion* ningun item de la lista principal queda activo (esperado)', () => {
    useMeMock.mockReturnValue({ data: undefined });
    renderSidebar('/configuracion/paquetes');

    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });
});

describe('Sidebar (toggle de colapso)', () => {
  it('sin onToggleCollapse (drawer movil) no renderiza el boton de colapso', () => {
    useMeMock.mockReturnValue({ data: undefined });
    renderSidebar('/dashboard');

    expect(screen.queryByRole('button', { name: 'Colapsar panel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expandir panel' })).not.toBeInTheDocument();
  });

  it('expandido muestra "Colapsar panel" con aria-expanded=true y dispara el handler', () => {
    useMeMock.mockReturnValue({ data: undefined });
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar collapsed={false} onToggleCollapse={onToggle} />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole('button', { name: 'Colapsar panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('colapsado muestra "Expandir panel" con aria-expanded=false y oculta las etiquetas', () => {
    useMeMock.mockReturnValue({ data: undefined });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar collapsed onToggleCollapse={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Expandir panel' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Mini-rail: los links siguen (con title accesible) pero sin texto visible.
    const panel = screen.getByRole('link', { name: 'Panel' });
    expect(panel).toHaveAttribute('href', '/dashboard');
    expect(panel).not.toHaveTextContent('Panel');
  });

  it('colapsado, el popover del avatar sigue abriendo con las tres opciones', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar collapsed onToggleCollapse={() => undefined} />
      </MemoryRouter>,
    );

    // En mini-rail el boton de cuenta es solo el avatar, nombrado via aria-label.
    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Mejorar Plan' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });
});

describe('Sidebar (popover como unico acceso a Configuracion/Mejorar Plan/Cerrar sesion)', () => {
  it('con el popover cerrado esas opciones no existen en ningun lado del sidebar', () => {
    useMeMock.mockReturnValue({ data: { profile: { fullName: 'Ada Lovelace' } } });
    renderSidebar('/dashboard');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('Configuración')).not.toBeInTheDocument();
    expect(screen.queryByText('Mejorar Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Cerrar sesión')).not.toBeInTheDocument();
  });
});
