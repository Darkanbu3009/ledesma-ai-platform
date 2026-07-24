import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';
import { focusRing } from '../../lib/utils';

/**
 * Logo apilado oficial de Ledesma AI Labs para la pantalla de acceso: isotipo
 * "L" vectorial (barra vertical ink 12x56 + base horizontal 34x8 + cuadro
 * naranja 10x10 arriba a la derecha de la barra) con el wordmark "Ledesma /
 * AI LABS" debajo. `compact` reduce el lockup para el header movil y
 * `large` lo agranda para placements centrados (gate de consentimiento).
 *
 * Sin sesion el lockup enlaza a la landing publica (/), para dar salida hacia el
 * inicio desde las pantallas de acceso donde aparece (login, crear cuenta,
 * recuperar, nueva contrasena). Con sesion se queda igual, sin enlace, para no
 * cambiar el comportamiento de las pantallas autenticadas donde tambien se usa
 * (p. ej. el gate de consentimiento).
 */
export function LedesmaLogo({
  compact = false,
  large = false,
}: {
  compact?: boolean;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();

  const lockup = (
    <div className={compact || large ? 'flex flex-col items-center text-center' : ''}>
      <svg
        viewBox="0 0 34 56"
        width={compact ? 20 : large ? 40 : 27}
        height={compact ? 33 : large ? 66 : 44.5}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Ledesma AI Labs"
      >
        <rect x="0" y="0" width="12" height="56" fill="#1F1E1C" />
        <rect x="0" y="48" width="34" height="8" fill="#1F1E1C" />
        <rect x="18" y="0" width="10" height="10" fill="#F55B1F" />
      </svg>
      <p
        className={`font-display font-medium text-ink ${compact ? 'mt-2.5 text-lg' : large ? 'mt-4 text-3xl' : 'mt-3.5 text-2xl'}`}
      >
        Ledesma
      </p>
      <p
        className={`uppercase text-[#7A7D85] ${compact ? 'mt-0.5 text-[10px] tracking-[4px]' : large ? 'mt-1.5 text-sm tracking-[6px]' : 'mt-1 text-xs tracking-[5px]'}`}
      >
        AI LABS
      </p>
    </div>
  );

  if (session) return lockup;

  return (
    <Link to="/" aria-label={t('auth.marca.logoInicio')} className={`inline-flex rounded-md ${focusRing}`}>
      {lockup}
    </Link>
  );
}
