// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

// El Sidebar (que trae el "Cerrar sesion" del menu de usuario) tira de useIsAdmin/useMe
// (react-query), useAuth (AuthContext) y supabase (que lee env al importarse): mismo aislamiento
// que user-menu.dom.test.tsx para poder ejercitar el logout suelto.
const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/queries', () => ({
  useIsAdmin: () => ({ isAdmin: false, isLoading: false }),
  useMe: () => ({ data: undefined }),
}));
vi.mock('../src/auth/useAuth', () => ({
  useAuth: () => ({ user: { email: 'ada@example.com' }, session: null, loading: false }),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: signOutMock } } }));

import { useScrollAlTopeEnNavegacion } from '../src/lib/scroll-al-tope';
import { Sidebar } from '../src/components/layout/Sidebar';

const scrollToMock = vi.fn();

/** Botones de navegacion para ejercitar PUSH, POP y ancla desde la vista montada. */
function Controles() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/agentes')}>
        ir a agentes
      </button>
      <button type="button" onClick={() => navigate('/#integracion')}>
        ir al ancla
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        atras
      </button>
    </>
  );
}

/** Monta el hook igual que App: por dentro del router y por encima de las rutas. */
function Harness({ conSidebar = false }: { conSidebar?: boolean }) {
  useScrollAlTopeEnNavegacion();
  return (
    <>
      <Controles />
      {conSidebar && <Sidebar />}
      <Routes>
        <Route path="/" element={<p>landing</p>} />
        <Route path="/actividad" element={<p>vista actividad</p>} />
        <Route path="/agentes" element={<p>vista agentes</p>} />
      </Routes>
    </>
  );
}

function renderEnActividad(conSidebar = false) {
  return render(
    <MemoryRouter initialEntries={['/actividad']}>
      <Harness conSidebar={conSidebar} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  scrollToMock.mockClear();
  signOutMock.mockClear();
  // jsdom no implementa el scroll del documento: se observa la llamada.
  vi.stubGlobal('scrollTo', scrollToMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('scroll al tope en cambio de ruta', () => {
  it('una navegacion PUSH a otra ruta deja el documento en 0', () => {
    renderEnActividad();
    // El montaje inicial es POP: no toca el scroll.
    expect(scrollToMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ir a agentes' }));

    expect(screen.getByText('vista agentes')).toBeInTheDocument();
    expect(scrollToMock).toHaveBeenCalledWith(0, 0);
  });

  it('una navegacion POP (atras) NO fuerza el tope: la restaura el navegador', () => {
    renderEnActividad();
    fireEvent.click(screen.getByRole('button', { name: 'ir a agentes' }));
    scrollToMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'atras' }));

    expect(screen.getByText('vista actividad')).toBeInTheDocument();
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('una ruta con ancla NO va al tope: aterriza en su ancla', () => {
    renderEnActividad();

    fireEvent.click(screen.getByRole('button', { name: 'ir al ancla' }));

    expect(screen.getByText('landing')).toBeInTheDocument();
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('cerrar sesion limpia la sesion y aterriza la landing en el tope', async () => {
    renderEnActividad(true);

    fireEvent.click(screen.getByRole('button', { name: 'ada@example.com' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(await screen.findByText('landing')).toBeInTheDocument();
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith(0, 0);
  });
});
