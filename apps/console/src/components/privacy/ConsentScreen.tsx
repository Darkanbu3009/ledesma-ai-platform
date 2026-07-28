import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LedesmaLogo } from '../login/LedesmaLogo';
import { useAcceptConsents } from '../../lib/mutations';
import {
  DOCUMENT_PATHS,
  pendingConsentBodies,
  type ConsentsState,
  type DocumentType,
} from '../../lib/privacy';

/**
 * Pantalla de CONSENTIMIENTO BLOQUEANTE. Se muestra cuando al titular le falta aceptar la version vigente
 * de algun documento: al registrarse (primera vez) o al iniciar sesion despues de que un documento subio
 * de version. Sin aceptar no se navega a ningun lado de la aplicacion.
 *
 * El consentimiento tiene que ser libre, especifico e informado, y de ahi salen las tres reglas de esta
 * pantalla:
 *   - UN CHECK POR DOCUMENTO, ninguno pre-marcado. Aceptar en bloque no es especifico.
 *   - Cada documento enlaza a su TEXTO COMPLETO, en ruta publica y en pestana nueva (target=_blank) para
 *     no perder el estado de los checks, que vive en React y no en almacenamiento local.
 *   - El boton queda DESHABILITADO hasta que TODOS los checks pendientes esten marcados.
 * Ademas siempre se puede cerrar sesion: no es un secuestro de la cuenta, es una condicion para usarla.
 */
export function ConsentScreen({ state }: { state: ConsentsState }) {
  const { t } = useTranslation();
  const [aceptados, setAceptados] = useState<Record<string, boolean>>({});
  const acceptConsents = useAcceptConsents();
  const navigate = useNavigate();

  // Tras cerrar sesion se aterriza en la landing publica (/), no en /login.
  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  }

  // Al montar, mueve el foco al titulo (h1, tabindex -1) para que el lector de pantalla anuncie la
  // pantalla de consentimiento en vez de dejar el foco en el body.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const faltantes = state.missing;
  const todosMarcados = faltantes.length > 0 && faltantes.every((tipo) => aceptados[tipo] === true);

  function toggle(tipo: DocumentType, valor: boolean) {
    setAceptados((previo) => ({ ...previo, [tipo]: valor }));
  }

  function handleAccept() {
    if (!todosMarcados) return;
    acceptConsents.mutate(pendingConsentBodies(state));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <LedesmaLogo large />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink focus:outline-none"
          >
            {t('privacidad.consentimiento.titulo')}
          </h1>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted">
            {t('privacidad.consentimiento.kicker')}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-7 shadow-card-hover sm:p-8">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <p className="text-sm leading-relaxed text-muted">
              {t('privacidad.consentimiento.intro')}
            </p>
          </div>

          {/* Un bloque por documento faltante: enlace al texto completo y su propio check. */}
          <div className="mt-6 space-y-3">
            {faltantes.map((tipo) => (
              <div key={tipo} className="rounded-xl border border-line bg-field p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {t(`privacidad.documentos.${tipo}.nombre`)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t('privacidad.consentimiento.versionEtiqueta', {
                        version: state.current[tipo],
                      })}
                    </p>
                  </div>
                  <a
                    href={DOCUMENT_PATHS[tipo]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-none items-center gap-1.5 text-xs font-medium text-brasa hover:underline"
                  >
                    {t('privacidad.consentimiento.leerTexto')}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
                <label className="mt-3 flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={aceptados[tipo] === true}
                    onChange={(e) => toggle(tipo, e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-none accent-brasa"
                  />
                  <span className="text-sm text-ink">
                    {t(`privacidad.documentos.${tipo}.aceptacion`)}
                  </span>
                </label>
              </div>
            ))}
          </div>

          {acceptConsents.isError && (
            <p className="mt-4 text-sm text-brasa" role="alert">
              {t('privacidad.consentimiento.error')}
            </p>
          )}

          <button
            type="button"
            onClick={handleAccept}
            disabled={!todosMarcados || acceptConsents.isPending}
            className="mt-6 w-full rounded-lg bg-brasa px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {acceptConsents.isPending
              ? t('privacidad.consentimiento.registrando')
              : t('privacidad.consentimiento.aceptar')}
          </button>

          <p className="mt-3 text-center text-xs text-muted-soft">
            {t('privacidad.consentimiento.nota')}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs">
          <Link to="/privacidad/simplificado" className="text-muted-soft transition hover:text-ink">
            {t('privacidad.consentimiento.verSimplificado')}
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="text-muted-soft transition hover:text-ink"
          >
            {t('privacidad.consentimiento.cerrarSesion')}
          </button>
        </div>
      </div>
    </div>
  );
}
