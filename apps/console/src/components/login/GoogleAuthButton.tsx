import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';

/**
 * Bloque "Continuar con Google" compartido por /login y /crear-cuenta:
 * divisor "o" con hairlines y boton secundario neutro con el logo oficial
 * multicolor de Google (las guidelines de marca prohiben recolorearlo).
 *
 * Autocontenido: maneja su propio estado porque el flujo OAuth es identico en
 * ambas pantallas y no toca el formulario de contrasena. Al click llama
 * supabase.auth.signInWithOAuth, que redirige la pagina completa a Google;
 * redirectTo apunta al pathname actual sobre window.location.origin (la misma
 * base que ya usa el cliente), de modo que exito y cancelacion vuelven a esta
 * pantalla. Al volver, detectSessionInUrl consume el retorno y AuthProvider
 * recibe la sesion por onAuthStateChange; el flujo post-login (GET /v1/me,
 * needsRegistration -> /registro) es el mismo que con contrasena.
 *
 * Errores: si signInWithOAuth falla antes de redirigir (red, popup/redirect
 * bloqueado), se limpia el estado de carga y se muestra un mensaje no
 * destructivo; el formulario de correo sigue usable. Si el usuario cancela en
 * Google, vuelve a esta misma pantalla (redirectTo apunta al pathname actual)
 * con el error en el hash y se le muestra un mensaje claro; y si vuelve con
 * el boton Atras del navegador, pageshow resetea el estado de carga para que
 * el boton no quede colgado en una pagina restaurada desde el bfcache.
 */
export function GoogleAuthButton() {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  // Cancelacion o fallo en Google: el retorno llega sin sesion y con el error
  // en el hash (#error=access_denied...). detectSessionInUrl no establece
  // sesion en ese caso y supabase-js no limpia el hash de error, asi que aqui
  // se traduce a un mensaje claro desde el primer render (inicializador lazy,
  // sin setState en efectos). Si en alguna version el SDK ya lo consumio,
  // simplemente no se muestra nada.
  const [errorMsg, setErrorMsg] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).has('error')
      ? t('auth.google.errorRetorno')
      : '',
  );

  useEffect(() => {
    // Atras desde la pantalla de Google: el navegador puede restaurar esta
    // pagina desde el back/forward cache con el estado de React vivo (pending
    // aun en true). pageshow con persisted es la unica senal de ese caso.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(false);
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  useEffect(() => {
    // Limpia el hash de error de la URL una vez traducido a mensaje, para que
    // un reload o navegacion interna no lo re-muestre.
    if (new URLSearchParams(window.location.hash.slice(1)).has('error')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  async function handleClick() {
    setPending(true);
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      setPending(false);
      setErrorMsg(t('auth.google.errorConexion'));
      return;
    }
    // Sin error el navegador esta redirigiendo a Google; se deja el boton en
    // estado de carga hasta que la pagina se descargue.
  }

  return (
    <div>
      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-[rgba(31,30,28,0.14)]" aria-hidden="true" />
        <span className="text-[11px] text-muted">{t('auth.comun.divisorO')}</span>
        <span className="h-px flex-1 bg-[rgba(31,30,28,0.14)]" aria-hidden="true" />
      </div>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        className="flex h-[42px] w-full items-center justify-center gap-2.5 rounded-lg border border-[#B4B2A9] bg-white px-4 text-sm font-medium text-ink transition hover:bg-[rgba(31,30,28,0.03)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleLogo />
        {pending ? t('auth.google.conectando') : t('auth.google.continuar')}
      </button>
      {errorMsg && (
        <p className="mt-3 text-sm text-brasa" role="alert">
          {errorMsg}
        </p>
      )}
    </div>
  );
}

/** Logo "G" oficial de Google, multicolor, inline (sin recolorear). */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
