// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/i18n';
import { PrivacyNoticePage } from '../src/pages/PrivacyNoticePage';
import { PrivacySimplifiedNoticePage } from '../src/pages/PrivacySimplifiedNoticePage';
import { TermsPage } from '../src/pages/TermsPage';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../src/lib/privacy';

// Ninguna de estas paginas mockea auth, queries ni supabase A PROPOSITO: si alguna empezara a exigir
// sesion, este archivo fallaria al importarla o al renderizarla. Es justo lo que se quiere verificar.

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('es');
});

describe('paginas legales publicas (sin sesion)', () => {
  it('/privacidad renderiza el aviso integral completo, sin sesion', () => {
    render(
      <MemoryRouter>
        <PrivacyNoticePage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Aviso de Privacidad Integral' }),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Versión ${PRIVACY_NOTICE_VERSION}`))).toBeInTheDocument();

    // Los datos del responsable, tal cual.
    expect(screen.getAllByText('Ledesma AI Labs').length).toBeGreaterThan(0);
    expect(screen.getByText('contacto@ledesma-ai-labs.com')).toBeInTheDocument();
    expect(screen.getByText('Monterrey, Nuevo León, México')).toBeInTheDocument();

    // Secciones obligatorias presentes como encabezados.
    for (const titulo of [
      /Identidad y domicilio del responsable/,
      /Datos personales que tratamos/,
      /Finalidades primarias/,
      /Finalidades secundarias/,
      /Encargados y transferencias/,
      /Plazos de conservación/,
      /Medidas de seguridad/,
      /derechos ARCO/,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: titulo })).toBeInTheDocument();
    }

    // Ya no quedan placeholders del andamiaje anterior.
    expect(screen.queryByText(/REVISION LEGAL PENDIENTE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Revision legal pendiente/i)).not.toBeInTheDocument();
  });

  it('/terminos renderiza los terminos completos, sin sesion', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Términos de Servicio' }),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Versión ${TERMS_VERSION}`))).toBeInTheDocument();

    for (const titulo of [
      /Descripción del servicio/,
      /Esquema BYOK/,
      /Uso aceptable/,
      /Propiedad intelectual/,
      /Aprendizaje colectivo/,
      /Limitación de responsabilidad/,
      /Ley aplicable y jurisdicción/,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: titulo })).toBeInTheDocument();
    }

    // La jurisdiccion pactada aparece en el texto.
    expect(
      screen.getByText(/tribunales competentes de Monterrey, Nuevo León, México/),
    ).toBeInTheDocument();
  });

  it('/privacidad/simplificado renderiza el aviso corto y remite al integral', () => {
    render(
      <MemoryRouter>
        <PrivacySimplifiedNoticePage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Aviso de Privacidad Simplificado' }),
    ).toBeInTheDocument();
    const enlace = screen.getByRole('link', { name: 'aviso de privacidad integral' });
    expect(enlace).toHaveAttribute('href', '/privacidad');
  });

  it('NINGUNA pagina legal muestra la nota de borrador, en ninguno de los dos idiomas', async () => {
    // Los textos son definitivos desde la version 2026-07-29. Este test falla si la nota reaparece.
    const rastros = [
      /[Bb]orrador generado con asistencia/,
      /pendiente de revisi[oó]n legal/i,
      /AI assisted draft/i,
      /pending professional legal review/i,
    ];
    for (const idioma of ['es', 'en']) {
      await i18n.changeLanguage(idioma);
      for (const Pagina of [PrivacyNoticePage, PrivacySimplifiedNoticePage, TermsPage]) {
        const { unmount } = render(
          <MemoryRouter>
            <Pagina />
          </MemoryRouter>,
        );
        for (const rastro of rastros) {
          expect(screen.queryByText(rastro)).toBeNull();
        }
        unmount();
      }
    }
  });

  it('el aviso enlaza a los terminos y a la pagina de derechos', () => {
    render(
      <MemoryRouter>
        <PrivacyNoticePage />
      </MemoryRouter>,
    );
    const pie = screen.getByRole('link', { name: 'Términos de Servicio' });
    expect(pie).toHaveAttribute('href', '/terminos');
    expect(screen.getByRole('link', { name: 'ejercer tus derechos' })).toHaveAttribute(
      'href',
      '/mis-datos',
    );
  });

  it('en ingles se sirve la version en ingles de cada documento', async () => {
    await i18n.changeLanguage('en');
    const { unmount } = render(
      <MemoryRouter>
        <PrivacyNoticePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`version ${PRIVACY_NOTICE_VERSION}, dated`)),
    ).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
  });

  it('la seccion de seguridad NO promete cifrado extremo a extremo del relay', () => {
    render(
      <MemoryRouter>
        <PrivacyNoticePage />
      </MemoryRouter>,
    );
    const seguridad = document.getElementById('seguridad');
    expect(seguridad).not.toBeNull();
    const dentro = within(seguridad as HTMLElement);
    expect(dentro.getByText(/el cifrado protege el trayecto, no el destino/)).toBeInTheDocument();
    expect(
      dentro.getByText(/No contamos con certificaciones de seguridad de terceros/),
    ).toBeInTheDocument();
  });
});
