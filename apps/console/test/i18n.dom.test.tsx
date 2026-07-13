// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

// Mismo aislamiento que user-menu.dom.test.tsx: el Sidebar tira de useIsAdmin/useMe (react-query),
// useAuth (AuthContext) y supabase (que lee env al importarse); se mockean para renderizarlo suelto.
vi.mock('../src/lib/queries', () => ({
  useIsAdmin: () => ({ isAdmin: false, isLoading: false }),
  useMe: () => ({ data: { profile: { fullName: 'Ada Lovelace' } } }),
}));
vi.mock('../src/auth/useAuth', () => ({
  useAuth: () => ({ user: { email: 'ada@example.com' }, session: null, loading: false }),
}));
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn().mockResolvedValue(undefined) } },
}));

import i18n, { detectBrowserLanguage } from '../src/i18n';
import { Sidebar } from '../src/components/layout/Sidebar';
import { LanguageModal } from '../src/components/landing/language-modal';

afterEach(async () => {
  cleanup();
  // El setup global arranca en espanol; cada test que cambie de idioma vuelve al default.
  await i18n.changeLanguage('es');
});

describe('i18n fase 1 (migracion de muestra: sidebar)', () => {
  it('arranca en espanol (default del producto) con las etiquetas del sidebar migradas', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    for (const label of [
      'Panel',
      'Agentes',
      'Recetas',
      'Tareas',
      'Triggers',
      'Actividad',
      'Credenciales',
      'Privacidad',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('cambiar a ingles re-renderiza el sidebar EN VIVO y volver a espanol lo restaura', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    await act(() => i18n.changeLanguage('en'));
    for (const label of ['Dashboard', 'Agents', 'Recipes', 'Tasks', 'Activity', 'Credentials']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Recetas' })).not.toBeInTheDocument();

    await act(() => i18n.changeLanguage('es'));
    expect(screen.getByRole('link', { name: 'Recetas' })).toBeInTheDocument();
  });

  it('una clave que falte en ingles cae al espanol (fallbackLng)', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('nav.panel')).toBe('Dashboard');
    // Clave inexistente en ambos: i18next devuelve la clave, nunca un texto vacio.
    expect(i18n.t('nav.no-existe')).toBe('nav.no-existe');
  });
});

describe('LanguageModal (landing)', () => {
  it('preselecciona el idioma detectado del navegador y reporta la eleccion explicita', () => {
    const onChoose = vi.fn();
    render(<LanguageModal onChoose={onChoose} onClose={vi.fn()} />);
    // jsdom reporta navigator.language = en-US: la deteccion debe ser 'en'.
    expect(detectBrowserLanguage()).toBe('en');
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(onChoose).toHaveBeenCalledWith('es');
  });

  it('cerrar sin elegir avisa via onClose (asumir el idioma detectado, sin bloquear)', () => {
    const onClose = vi.fn();
    render(<LanguageModal onChoose={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar y continuar/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
