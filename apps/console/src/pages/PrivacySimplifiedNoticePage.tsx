import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { documentoLegal } from '../content/legal';

/**
 * AVISO DE PRIVACIDAD SIMPLIFICADO, ruta PUBLICA /privacidad/simplificado. La ley mexicana lo exige cuando
 * los datos se recaban por medios electronicos, que es el caso de esta plataforma. Es un RESUMEN y siempre
 * remite al integral, que es el que rige.
 */
export function PrivacySimplifiedNoticePage() {
  const { t, i18n } = useTranslation();
  return (
    <LegalDocument
      doc={documentoLegal('avisoSimplificado', i18n.language)}
      footer={
        <p>
          <Trans
            t={t}
            i18nKey="privacidad.avisoSimplificado.footer"
            components={{
              integral: (
                <Link to="/privacidad" className="font-medium text-brasa hover:underline" />
              ),
            }}
          />
        </p>
      }
    />
  );
}
