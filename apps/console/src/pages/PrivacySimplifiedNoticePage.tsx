import { Link } from 'react-router-dom';
import { LegalDocument } from '../components/privacy/LegalDocument';
import { SIMPLIFIED_NOTICE } from '../lib/privacy';

/**
 * AVISO DE PRIVACIDAD SIMPLIFICADO (publico). Obligatorio al recabar datos por medios electronicos (esta
 * plataforma). Estructura minima con placeholders y enlace al integral. Ruta publica
 * /aviso-de-privacidad/simplificado.
 */
export function PrivacySimplifiedNoticePage() {
  return (
    <LegalDocument
      doc={SIMPLIFIED_NOTICE}
      footer={
        <p>
          Consulta el{' '}
          <Link to="/aviso-de-privacidad" className="font-medium text-brasa hover:underline">
            aviso de privacidad integral
          </Link>{' '}
          para el detalle completo.
        </p>
      }
    />
  );
}
