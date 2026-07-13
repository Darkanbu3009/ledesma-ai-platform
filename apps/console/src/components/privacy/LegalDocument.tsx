import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Logo } from '../brand/logo';
import type { PrivacyDocument } from '../../lib/privacy';

/**
 * Bloque de PLACEHOLDER de texto legal. Deja EXPLICITO que el contenido lo redacta/revisa un abogado y
 * que aun no es texto legal valido: nunca se muestra texto vinculante inventado. Visualmente distinto
 * (borde punteado, fondo tenue) para que no se confunda con contenido final.
 */
function PlaceholderBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 rounded-xl border border-dashed border-brasa-line bg-brasa-soft px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#993C1D]">
        {t('privacidad.aviso.placeholderTag')}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

/**
 * Renderiza un documento de privacidad (integral o simplificado) como pagina PUBLICA: marca, titulo,
 * version y las SECCIONES que la ley exige como encabezados, cada una con su placeholder de texto legal.
 * No requiere sesion (el widget y la landing pueden enlazarla). El contenido legal real lo pone un abogado.
 */
export function LegalDocument({ doc, footer }: { doc: PrivacyDocument; footer?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <Link to="/" className="inline-flex items-center">
            <Logo tight className="h-10 w-auto" />
          </Link>
          <h1 className="mt-7 font-display text-3xl font-extrabold tracking-tight text-ink">
            {doc.title}
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{doc.subtitle}</p>
          <p className="mt-3 inline-flex items-center rounded-md bg-line-soft px-2.5 py-1 text-xs font-medium text-muted">
            {t('privacidad.aviso.version', { version: doc.version })}
          </p>
        </header>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <ol className="space-y-7">
            {doc.sections.map((section, index) => (
              <li key={section.id}>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-sm font-bold text-brasa">{index + 1}.</span>
                  <h2 className="font-display text-lg font-bold text-ink">{section.heading}</h2>
                  {section.optional && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-soft">
                      {t('privacidad.aviso.opcional')}
                    </span>
                  )}
                </div>
                <PlaceholderBlock text={section.placeholder} />
              </li>
            ))}
          </ol>
        </div>

        {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}
