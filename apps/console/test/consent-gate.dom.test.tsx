// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION, type ConsentsState } from '../src/lib/privacy';

// El gate y la pantalla tiran de react-query y de supabase; se mockean para ejercerlos sin red.
const { useConsentsMock, useAcceptConsentsMock, signOutMock } = vi.hoisted(() => ({
  useConsentsMock: vi.fn(),
  useAcceptConsentsMock: vi.fn(),
  signOutMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/queries', () => ({ useConsents: useConsentsMock }));
vi.mock('../src/lib/mutations', () => ({ useAcceptConsents: useAcceptConsentsMock }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: signOutMock } } }));
// La marca de la pantalla (LedesmaLogo) lee la sesion; se mockea para montarla sin AuthProvider.
vi.mock('../src/auth/useAuth', () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

import { ConsentGate } from '../src/components/ConsentGate';

const APP = 'CONTENIDO DE LA APLICACION';

function estado(missing: ConsentsState['missing']): ConsentsState {
  return {
    consents: [],
    current: { privacy_notice: PRIVACY_NOTICE_VERSION, terms: TERMS_VERSION },
    documentTypes: ['privacy_notice', 'terms'],
    missing,
  };
}

/** Monta el gate con una ruta hija que solo se ve si el gate DEJA PASAR. */
function renderGate(consulta: Record<string, unknown>) {
  useConsentsMock.mockReturnValue({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...consulta,
  });
  const mutate = vi.fn();
  useAcceptConsentsMock.mockReturnValue({ mutate, isPending: false, isError: false });
  render(
    <MemoryRouter initialEntries={['/agentes']}>
      <Routes>
        <Route element={<ConsentGate />}>
          <Route path="/agentes" element={<p>{APP}</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return { mutate };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConsentGate', () => {
  it('BLOQUEA: sin aceptacion vigente muestra la pantalla y NO renderiza la aplicacion', () => {
    renderGate({ data: estado(['privacy_notice', 'terms']) });

    expect(screen.queryByText(APP)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Antes de continuar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar y continuar' })).toBeDisabled();
  });

  it('LIBERA: con todo aceptado renderiza la aplicacion y no muestra la pantalla', () => {
    renderGate({ data: estado([]) });

    expect(screen.getByText(APP)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Antes de continuar' })).not.toBeInTheDocument();
  });

  it('RE-ACEPTACION: si un documento sube de version vuelve a bloquear, aunque el otro este al dia', () => {
    // El backend devuelve el aviso en `missing` porque la version vigente subio.
    renderGate({ data: estado(['privacy_notice']) });

    expect(screen.queryByText(APP)).not.toBeInTheDocument();
    // Solo se pide el documento que subio de version: el que esta al dia no se vuelve a pedir.
    expect(screen.getByText('Aviso de Privacidad')).toBeInTheDocument();
    expect(screen.queryByText('Términos de Servicio')).not.toBeInTheDocument();
    expect(screen.getByText(`Versión ${PRIVACY_NOTICE_VERSION}`)).toBeInTheDocument();
  });

  it('mientras carga no deja pasar ni acusa falta de consentimiento', () => {
    renderGate({ data: undefined, isLoading: true });
    expect(screen.queryByText(APP)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Antes de continuar' })).not.toBeInTheDocument();
  });

  it('ante un error de red ofrece reintentar y NO deja pasar', () => {
    renderGate({ data: undefined, isError: true });
    expect(screen.queryByText(APP)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });
});

describe('ConsentScreen (dentro del gate)', () => {
  it('un check POR DOCUMENTO, ninguno pre-marcado, y el boton solo se habilita con AMBOS', () => {
    renderGate({ data: estado(['privacy_notice', 'terms']) });

    const checks = screen.getAllByRole('checkbox');
    expect(checks).toHaveLength(2);
    for (const check of checks) expect(check).not.toBeChecked();

    const boton = screen.getByRole('button', { name: 'Aceptar y continuar' });
    expect(boton).toBeDisabled();

    // Con uno solo marcado sigue bloqueado: la aceptacion es especifica por documento.
    fireEvent.click(checks[0] as HTMLElement);
    expect(boton).toBeDisabled();

    fireEvent.click(checks[1] as HTMLElement);
    expect(boton).toBeEnabled();
  });

  it('aceptar envia un body por documento faltante con su version VIGENTE', () => {
    const { mutate } = renderGate({ data: estado(['privacy_notice', 'terms']) });

    for (const check of screen.getAllByRole('checkbox')) fireEvent.click(check);
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));

    expect(mutate).toHaveBeenCalledWith([
      { document_type: 'privacy_notice', document_version: PRIVACY_NOTICE_VERSION },
      { document_type: 'terms', document_version: TERMS_VERSION },
    ]);
  });

  it('sin marcar nada, pulsar el boton no registra nada', () => {
    const { mutate } = renderGate({ data: estado(['privacy_notice', 'terms']) });
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('cada documento enlaza a su TEXTO COMPLETO en la ruta publica, en pestana nueva', () => {
    renderGate({ data: estado(['privacy_notice', 'terms']) });

    const enlaces = screen.getAllByRole('link', { name: /Leer texto completo/ });
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual(['/privacidad', '/terminos']);
    for (const enlace of enlaces) {
      expect(enlace).toHaveAttribute('target', '_blank');
      expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('siempre se puede cerrar sesion: el gate no secuestra la cuenta', () => {
    renderGate({ data: estado(['privacy_notice', 'terms']) });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(signOutMock).toHaveBeenCalled();
  });
});
