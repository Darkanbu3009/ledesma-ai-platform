import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { documentoLegal } from '../content/legal';

/**
 * TERMINOS DE SERVICIO, ruta PUBLICA /terminos. Igual que el aviso: se puede leer sin sesion, porque el
 * consentimiento solo es informado si el documento se puede revisar ANTES de aceptarlo.
 */
export function TermsPage() {
  const { t, i18n } = useTranslation();
  return (
    <LegalDocument
      doc={documentoLegal('terminos', i18n.language)}
      footer={
        <p>
          <Trans
            t={t}
            i18nKey="privacidad.terminos.footer"
            components={{
              aviso: <Link to="/privacidad" className="font-medium text-brasa hover:underline" />,
            }}
          />
        </p>
      }
    />
  );
}
