// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mismo aislamiento que user-menu.dom.test.tsx: el Sidebar (hijo del layout) tira de
// useIsAdmin/useMe (react-query), useAuth (AuthContext) y supabase; se mockean para
// renderizar el AppLayout suelto.
vi.mock('../src/lib/queries', () => ({
  useIsAdmin: () => ({ isAdmin: false, isLoading: false }),
  useMe: () => ({ data: undefined }),
  // Sin aprobaciones pendientes: el banner global (7.1e) no se renderiza en estos tests de layout.
  useAprobacionesPendientes: () => ({ data: [] }),
}));
vi.mock('../src/auth/useAuth', () => ({
  useAuth: () => ({ user: { email: 'ada@example.com' }, session: null, loading: false }),
}));
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn().mockResolvedValue(undefined) } },
}));

import { AppLayout } from '../src/components/layout/AppLayout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<p>contenido</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('AppLayout (colapso del sidebar)', () => {
  it('arranca COLAPSADO por defecto: muestra "Expandir panel" y oculta las etiquetas', () => {
    renderLayout();

    expect(screen.getByRole('button', { name: 'Expandir panel' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('link', { name: 'Panel' })).not.toHaveTextContent('Panel');
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('el toggle expande el sidebar y permite volver a colapsarlo', () => {
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir panel' }));
    expect(screen.getByRole('button', { name: 'Colapsar panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Panel' })).toHaveTextContent('Panel');

    fireEvent.click(screen.getByRole('button', { name: 'Colapsar panel' }));
    expect(screen.getByRole('button', { name: 'Expandir panel' })).toBeInTheDocument();
  });
});

// jsdom no calcula layout (no hay alto de viewport ni scrollTop real), asi que el contrato del
// sidebar fijo se verifica sobre la ESTRUCTURA del arbol renderizado y las clases que declaran
// quien scrollea y quien queda anclado.
describe('AppLayout (sidebar fijo y scroll solo en el contenido)', () => {
  it('la raiz se clava al viewport en escritorio y el contenido es el unico que scrollea', () => {
    renderLayout();

    const contenido = screen.getByRole('main');
    expect(contenido.classList.contains('md:overflow-y-auto')).toBe(true);
    // Sin min-h-0 el flex item no puede bajar de su alto de contenido y el overflow no scrollearia.
    expect(contenido.classList.contains('md:min-h-0')).toBe(true);

    const raiz = contenido.parentElement?.parentElement as HTMLElement;
    expect(raiz.classList.contains('md:h-screen')).toBe(true);
    expect(raiz.classList.contains('md:overflow-hidden')).toBe(true);
  });

  it('el sidebar toma el alto del contenedor y su navegacion scrollea por dentro', () => {
    renderLayout();

    const sidebar = screen.getByRole('complementary');
    expect(sidebar.classList.contains('h-full')).toBe(true);
    expect(sidebar.classList.contains('flex-col')).toBe(true);

    const navegacion = screen.getByRole('navigation');
    expect(sidebar.contains(navegacion)).toBe(true);
    expect(navegacion.classList.contains('overflow-y-auto')).toBe(true);
    expect(navegacion.classList.contains('min-h-0')).toBe(true);
    expect(navegacion.classList.contains('flex-1')).toBe(true);
  });

  it('el bloque de usuario es el ultimo hijo del sidebar, anclado despues de la navegacion', () => {
    renderLayout();

    const sidebar = screen.getByRole('complementary');
    // Colapsado (estado inicial) el boton de cuenta expone el email como aria-label.
    const botonCuenta = screen.getByRole('button', { name: 'ada@example.com' });
    const bloqueUsuario = botonCuenta.closest('.border-t');

    expect(bloqueUsuario).not.toBeNull();
    expect(sidebar.lastElementChild).toBe(bloqueUsuario);
    expect(
      screen.getByRole('navigation').compareDocumentPosition(bloqueUsuario as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('en movil no cambia nada: la raiz conserva min-h-screen y el contenido no scrollea aparte', () => {
    renderLayout();

    const contenido = screen.getByRole('main');
    const raiz = contenido.parentElement?.parentElement as HTMLElement;

    expect(raiz.classList.contains('min-h-screen')).toBe(true);
    expect(raiz.classList.contains('h-screen')).toBe(false);
    expect(raiz.classList.contains('overflow-hidden')).toBe(false);
    expect(contenido.classList.contains('overflow-y-auto')).toBe(false);
    expect(contenido.classList.contains('min-h-0')).toBe(false);
  });
});
