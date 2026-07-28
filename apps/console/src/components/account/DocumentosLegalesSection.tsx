import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText } from 'lucide-react';
import { useConsents } from '../../lib/queries';
import { formatUserDate } from '../../lib/admin';
import { currentAcceptance, DOCUMENT_PATHS, REQUIRED_DOCUMENTS } from '../../lib/privacy';

/** Misma tarjeta plana que el resto del perfil (superficie blanca, hairline y radio comun). */
const cardClass = 'rounded-[14px] border-[0.5px] border-line bg-surface';

/**
 * Seccion "Documentos legales" del perfil: que acepto el titular, en que VERSION y en que FECHA, con
 * enlace al texto vigente de cada documento.
 *
 * Muestra la aceptacion de la version VIGENTE, no el historico: si un documento subio de version y el
 * titular todavia no la acepta, aparece como pendiente. En la practica eso casi no se ve, porque el
 * ConsentGate bloquea la aplicacion antes de dejar llegar aqui; queda por si el estado se recarga entre
 * medias, y para no mentir diciendo "aceptado" cuando lo aceptado es una version vieja.
 *
 * Si el estado no carga, la seccion no se dibuja: es informativa y no vale la pena gritarle al usuario.
 */
export function DocumentosLegalesSection() {
  const { t } = useTranslation();
  const { data } = useConsents();

  if (!data) return null;

  return (
    <div className={`${cardClass} px-5 py-4`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brasa-soft text-brasa">
          <FileText className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-medium text-ink">{t('cuenta.legales.titulo')}</h2>
          <p className="text-xs text-muted">{t('cuenta.legales.descripcion')}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {REQUIRED_DOCUMENTS.map((tipo) => {
          const aceptacion = currentAcceptance(data, tipo);
          return (
            <li
              key={tipo}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-field px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {t(`privacidad.documentos.${tipo}.nombre`)}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {aceptacion
                    ? t('cuenta.legales.aceptado', {
                        version: aceptacion.documentVersion,
                        fecha: formatUserDate(aceptacion.acceptedAt),
                      })
                    : t('cuenta.legales.pendiente', { version: data.current[tipo] })}
                </p>
              </div>
              <Link
                to={DOCUMENT_PATHS[tipo]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-none items-center gap-1.5 text-xs font-medium text-brasa hover:underline"
              >
                {t('cuenta.legales.verTexto')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
