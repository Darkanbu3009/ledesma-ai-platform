import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { INTEGRAL_NOTICE } from '../lib/privacy';

/**
 * AVISO DE PRIVACIDAD INTEGRAL (publico). Estructura legal completa con placeholders [REVISION LEGAL
 * PENDIENTE]. Ruta publica /aviso-de-privacidad, enlazable desde la landing, el widget y el flujo de
 * consentimiento. La ESTRUCTURA (ids, version, optional) viene de lib/privacy.ts; los TEXTOS se
 * resuelven aqui via i18n por id de seccion.
 */
export function PrivacyNoticePage() {
  const { t } = useTranslation();
  const doc = {
    ...INTEGRAL_NOTICE,
    title: t('privacidad.avisoIntegral.titulo'),
    subtitle: t('privacidad.avisoIntegral.subtitulo'),
    sections: INTEGRAL_NOTICE.sections.map((section) => ({
      ...section,
      heading: t(`privacidad.avisoIntegral.secciones.${section.id}.titulo`),
      placeholder: t(`privacidad.avisoIntegral.secciones.${section.id}.placeholder`),
    })),
  };

  return (
    <LegalDocument
      doc={doc}
      footer={
        <p>
          <Trans
            t={t}
            i18nKey="privacidad.avisoIntegral.footer"
            components={{
              simplificado: (
                <Link
                  to="/aviso-de-privacidad/simplificado"
                  className="font-medium text-brasa hover:underline"
                />
              ),
              derechos: <Link to="/privacidad" className="font-medium text-brasa hover:underline" />,
            }}
          />
        </p>
      }
    />
  );
}
