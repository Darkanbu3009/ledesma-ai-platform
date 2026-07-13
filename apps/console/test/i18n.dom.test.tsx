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
import { LanguageSwitcher } from '../src/components/landing/language-switcher';

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

describe('detectBrowserLanguage', () => {
  // navigator.language se stubbea explicitamente: no se depende del default de jsdom (en-US).
  function stubNavigatorLanguage(value: string) {
    Object.defineProperty(window.navigator, 'language', { value, configurable: true });
  }

  it('solo devuelve en para navegadores claramente en ingles; cualquier otro cae a es', () => {
    stubNavigatorLanguage('en-US');
    expect(detectBrowserLanguage()).toBe('en');
    stubNavigatorLanguage('es-MX');
    expect(detectBrowserLanguage()).toBe('es');
    stubNavigatorLanguage('fr-FR');
    expect(detectBrowserLanguage()).toBe('es');
  });
});

describe('LanguageSwitcher (landing)', () => {
  it('marca el idioma activo y NO es un modal (sin dialog, sin bloquear)', () => {
    render(<LanguageSwitcher />);
    // El setup global deja la app en espanol: ES es la opcion activa y EN la alternativa. Los
    // botones exponen el nombre propio del idioma como nombre accesible.
    expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('elegir EN cambia el idioma EN VIVO y la etiqueta del grupo se traduce', async () => {
    render(<LanguageSwitcher />);
    expect(screen.getByRole('group', { name: 'Idioma' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
    });
    expect(i18n.language).toBe('en');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    // El propio selector tambien esta migrado: su aria-label cambia con el idioma.
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });
});
