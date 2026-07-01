import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { INTEGRAL_NOTICE } from '../lib/privacy';

/**
 * AVISO DE PRIVACIDAD INTEGRAL (publico). Estructura legal completa con placeholders [REVISION LEGAL
 * PENDIENTE]. Ruta publica /aviso-de-privacidad, enlazable desde la landing, el widget y el flujo de
 * consentimiento.
 */
export function PrivacyNoticePage() {
  return (
    <LegalDocument
      doc={INTEGRAL_NOTICE}
      footer={
        <p>
          Ver tambien el{' '}
          <Link to="/aviso-de-privacidad/simplificado" className="font-medium text-brasa hover:underline">
            aviso simplificado
          </Link>{' '}
          o{' '}
          <Link to="/privacidad" className="font-medium text-brasa hover:underline">
            ejercer tus derechos
          </Link>
          .
        </p>
      }
    />
  );
}
