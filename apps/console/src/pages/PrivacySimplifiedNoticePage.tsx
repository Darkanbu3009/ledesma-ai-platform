import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { SIMPLIFIED_NOTICE } from '../lib/privacy';

/**
 * AVISO DE PRIVACIDAD SIMPLIFICADO (publico). Obligatorio al recabar datos por medios electronicos (esta
 * plataforma). Estructura minima con placeholders y enlace al integral. Ruta publica
 * /aviso-de-privacidad/simplificado. La ESTRUCTURA (ids, version) viene de lib/privacy.ts; los TEXTOS
 * se resuelven aqui via i18n por id de seccion.
 */
export function PrivacySimplifiedNoticePage() {
  const { t } = useTranslation();
  const doc = {
    ...SIMPLIFIED_NOTICE,
    title: t('privacidad.avisoSimplificado.titulo'),
    subtitle: t('privacidad.avisoSimplificado.subtitulo'),
    sections: SIMPLIFIED_NOTICE.sections.map((section) => ({
      ...section,
      heading: t(`privacidad.avisoSimplificado.secciones.${section.id}.titulo`),
      placeholder: t(`privacidad.avisoSimplificado.secciones.${section.id}.placeholder`),
    })),
  };

  return (
    <LegalDocument
      doc={doc}
      footer={
        <p>
          <Trans
            t={t}
            i18nKey="privacidad.avisoSimplificado.footer"
            components={{
              integral: (
                <Link
                  to="/aviso-de-privacidad"
                  className="font-medium text-brasa hover:underline"
                />
              ),
            }}
          />
        </p>
      }
    />
  );
}
