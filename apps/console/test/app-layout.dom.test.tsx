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
    expect(screen.getByRole('link', { name: 'Configuración' })).not.toHaveTextContent(
      'Configuración',
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('el toggle expande el sidebar y permite volver a colapsarlo', () => {
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir panel' }));
    expect(screen.getByRole('button', { name: 'Colapsar panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Configuración' })).toHaveTextContent('Configuración');

    fireEvent.click(screen.getByRole('button', { name: 'Colapsar panel' }));
    expect(screen.getByRole('button', { name: 'Expandir panel' })).toBeInTheDocument();
  });
});
