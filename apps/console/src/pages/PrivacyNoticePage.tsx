import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { documentoLegal } from '../content/legal';

/**
 * AVISO DE PRIVACIDAD INTEGRAL, ruta PUBLICA /privacidad. Enlazable desde la landing, el widget, el pie de
 * los correos y el flujo de consentimiento, y accesible SIN sesion: un aviso de privacidad que exige
 * iniciar sesion para leerse no cumple su funcion.
 *
 * El texto vive en content/legal (versionado, en los dos idiomas); esta pagina solo elige el idioma actual
 * y lo entrega al renderizador.
 */
export function PrivacyNoticePage() {
  const { t, i18n } = useTranslation();
  return (
    <LegalDocument
      doc={documentoLegal('aviso', i18n.language)}
      footer={
        <p>
          <Trans
            t={t}
            i18nKey="privacidad.avisoIntegral.footer"
            components={{
              simplificado: (
                <Link
                  to="/privacidad/simplificado"
                  className="font-medium text-brasa hover:underline"
                />
              ),
              terminos: <Link to="/terminos" className="font-medium text-brasa hover:underline" />,
              derechos: <Link to="/mis-datos" className="font-medium text-brasa hover:underline" />,
            }}
          />
        </p>
      }
    />
  );
}
