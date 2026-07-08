import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LedesmaLogo } from '../login/LedesmaLogo';
import { useAcceptConsents } from '../../lib/mutations';
import {
  SIMPLIFIED_NOTICE,
  pendingConsentBodies,
  type ConsentsState,
} from '../../lib/privacy';

/**
 * Pantalla de CONSENTIMIENTO (Fase 5.6). Se muestra cuando al titular le falta aceptar la version vigente
 * de algun documento (primer login o cambio de version). Presenta el AVISO SIMPLIFICADO (resumen de
 * secciones), un check EXPLICITO NO pre-marcado y enlaces al aviso integral. La aceptacion es libre,
 * especifica e informada: solo al marcar el check y confirmar se registra (POST /v1/consents por cada
 * documento faltante). No es un paywall agresivo: es una pantalla clara y el usuario puede cerrar sesion.
 *
 * Nota: los enlaces a los avisos abren en pestana nueva (target=_blank) para no perder el estado del
 * check (estado en React, sin localStorage) al leer el documento.
 */
export function ConsentScreen({ state }: { state: ConsentsState }) {
  const [accepted, setAccepted] = useState(false);
  const acceptConsents = useAcceptConsents();

  // Al montar, mueve el foco al titulo (h1, tabindex -1) para que el lector de pantalla anuncie la
  // pantalla de consentimiento en vez de dejar el foco en el body (hallazgo B13).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleAccept() {
    if (!accepted) return;
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
            Antes de continuar
          </h1>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted">
            AVISO DE PRIVACIDAD
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-7 shadow-card-hover sm:p-8">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <p className="text-sm leading-relaxed text-muted">
              La plataforma opera agentes de IA de forma autonoma que procesan datos. Para continuar,
              necesitamos tu consentimiento sobre como los tratamos.
            </p>
          </div>

          {/* Resumen del aviso simplificado: solo los encabezados de las secciones. El detalle esta en el
              aviso integral (enlazado abajo). */}
          <div className="mt-6 rounded-xl border border-line bg-field p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-soft">
              Aviso simplificado
            </p>
            <ul className="mt-2 space-y-1.5">
              {SIMPLIFIED_NOTICE.sections.map((section) => (
                <li key={section.id} className="flex gap-2 text-sm text-ink-soft">
                  <span className="text-brasa">-</span>
                  {section.heading}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 text-sm text-muted">
            Consulta el{' '}
            <a
              href="/aviso-de-privacidad"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brasa hover:underline"
            >
              aviso de privacidad integral
            </a>
            .
          </div>

          {/* Check EXPLICITO, no pre-marcado. Sin el, el boton queda deshabilitado. */}
          <label className="mt-6 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-brasa"
            />
            <span className="text-sm text-ink">
              He leido y acepto el Aviso de Privacidad de la plataforma.
            </span>
          </label>

          {acceptConsents.isError && (
            <p className="mt-4 text-sm text-brasa" role="alert">
              No pudimos registrar tu aceptacion. Intenta de nuevo.
            </p>
          )}

          <button
            type="button"
            onClick={handleAccept}
            disabled={!accepted || acceptConsents.isPending}
            className="mt-6 w-full rounded-lg bg-brasa px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {acceptConsents.isPending ? 'Registrando...' : 'Aceptar y continuar'}
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="text-xs text-muted-soft transition hover:text-ink"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    </div>
  );
}
