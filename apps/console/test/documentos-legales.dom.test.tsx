// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_VERSION,
  type Consent,
  type ConsentsState,
} from '../src/lib/privacy';

const { useConsentsMock } = vi.hoisted(() => ({ useConsentsMock: vi.fn() }));
vi.mock('../src/lib/queries', () => ({ useConsents: useConsentsMock }));

import { DocumentosLegalesSection } from '../src/components/account/DocumentosLegalesSection';

function consent(overrides: Partial<Consent> = {}): Consent {
  return {
    id: 'c1',
    ownerId: 'user-1',
    documentType: 'privacy_notice',
    documentVersion: PRIVACY_NOTICE_VERSION,
    acceptedAt: '2026-07-15T10:00:00.000Z',
    ipHash: 'a'.repeat(64),
    ...overrides,
  };
}

function renderSection(data: ConsentsState | undefined) {
  useConsentsMock.mockReturnValue({ data });
  render(
    <MemoryRouter>
      <DocumentosLegalesSection />
    </MemoryRouter>,
  );
}

function estado(consents: Consent[]): ConsentsState {
  return {
    consents,
    current: { privacy_notice: PRIVACY_NOTICE_VERSION, terms: TERMS_VERSION },
    documentTypes: ['privacy_notice', 'terms'],
    missing: [],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DocumentosLegalesSection (perfil)', () => {
  it('lista los dos documentos con su VERSION y su FECHA de aceptacion', () => {
    renderSection(
      estado([
        consent(),
        consent({
          id: 'c2',
          documentType: 'terms',
          documentVersion: TERMS_VERSION,
          acceptedAt: '2026-07-16T10:00:00.000Z',
        }),
      ]),
    );

    expect(screen.getByText('Aviso de Privacidad')).toBeInTheDocument();
    expect(screen.getByText('Términos de Servicio')).toBeInTheDocument();
    expect(
      screen.getByText(`Aceptado el 15 jul 2026 · versión ${PRIVACY_NOTICE_VERSION}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Aceptado el 16 jul 2026 · versión ${TERMS_VERSION}`),
    ).toBeInTheDocument();
  });

  it('enlaza al TEXTO VIGENTE de cada documento', () => {
    renderSection(estado([consent()]));
    const enlaces = screen.getAllByRole('link', { name: 'Ver texto' });
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual(['/privacidad', '/terminos']);
  });

  it('una aceptacion de version VIEJA se muestra como pendiente, no como aceptada', () => {
    // El aviso se acepto en una version anterior y los terminos no se aceptaron nunca: los dos
    // aparecen como pendientes de la version vigente, y ninguno como aceptado.
    renderSection(estado([consent({ documentVersion: '2020-01-01' })]));
    expect(
      screen.getAllByText(`Pendiente de aceptar la versión ${PRIVACY_NOTICE_VERSION}`),
    ).toHaveLength(2);
    expect(screen.queryByText(/Aceptado el/)).not.toBeInTheDocument();
  });

  it('sin datos (aun cargando o error) no dibuja nada', () => {
    useConsentsMock.mockReturnValue({ data: undefined });
    const { container } = render(
      <MemoryRouter>
        <DocumentosLegalesSection />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
