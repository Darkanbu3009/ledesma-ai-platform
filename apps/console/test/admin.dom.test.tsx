// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// useIsAdmin se mockea para ejercer el guard y el item condicional sin react-query ni red (mismo patron
// que dashboard.dom.test.tsx). El Sidebar ademas tira de useAuth (AuthContext) y de supabase (que lee
// env al importarse): se aislan con mocks para renderizarlo suelto.
const { useIsAdminMock } = vi.hoisted(() => ({ useIsAdminMock: vi.fn() }));
vi.mock('../src/lib/queries', () => ({ useIsAdmin: useIsAdminMock }));
vi.mock('../src/auth/useAuth', () => ({
  useAuth: () => ({ user: { email: 'ada@example.com' }, session: null, loading: false }),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { AdminGate } from '../src/components/AdminGate';
import { Sidebar } from '../src/components/layout/Sidebar';

afterEach(() => {
  cleanup();
  useIsAdminMock.mockReset();
});

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route element={<AdminGate />}>
          <Route path="/admin" element={<div>AREA ADMIN</div>} />
        </Route>
        <Route path="/agentes" element={<div>HOME CONSOLA</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminGate (guard cosmetico de /admin)', () => {
  it('renderiza el area cuando el usuario es admin', () => {
    useIsAdminMock.mockReturnValue({ isAdmin: true, isLoading: false });
    renderGate();
    expect(screen.getByText('AREA ADMIN')).toBeInTheDocument();
  });

  it('redirige a la home cuando el usuario NO es admin', () => {
    useIsAdminMock.mockReturnValue({ isAdmin: false, isLoading: false });
    renderGate();
    expect(screen.queryByText('AREA ADMIN')).not.toBeInTheDocument();
    expect(screen.getByText('HOME CONSOLA')).toBeInTheDocument();
  });

  it('estado neutro mientras /v1/me carga: ni area ni redireccion (no decide antes de saber)', () => {
    useIsAdminMock.mockReturnValue({ isAdmin: false, isLoading: true });
    renderGate();
    expect(screen.queryByText('AREA ADMIN')).not.toBeInTheDocument();
    expect(screen.queryByText('HOME CONSOLA')).not.toBeInTheDocument();
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });
});

describe('Sidebar (item de admin condicional)', () => {
  it('muestra el item Admin (link a /admin) solo para admins', () => {
    useIsAdminMock.mockReturnValue({ isAdmin: true, isLoading: false });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Admin' });
    expect(link).toHaveAttribute('href', '/admin');
  });

  it('oculta el item Admin para un usuario normal', () => {
    useIsAdminMock.mockReturnValue({ isAdmin: false, isLoading: false });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  // El Sidebar solo mira isAdmin (nunca isLoading): su contrato es "muestra el item sii isAdmin". La
  // garantia fail-closed mientras /v1/me carga (isAdmin=false hasta resolver, sin parpadeo) vive en
  // useIsAdmin/deriveIsAdmin y se prueba a ESE nivel (use-is-admin.dom.test.tsx y deriveIsAdmin(undefined)),
  // no aca -- por eso no duplicamos un caso "mientras carga" a nivel Sidebar (seria el mismo camino que
  // el de usuario normal y daria una falsa sensacion de validar la carga).
});
