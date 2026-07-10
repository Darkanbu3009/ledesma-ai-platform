import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { useAuth } from '../auth/useAuth';
import { BrandPanel, BrandCopy } from '../components/login/BrandPanel';
import {
  InvalidRecoveryNotice,
  NewPasswordForm,
  type NewPasswordStatus,
} from '../components/login/NewPasswordForm';
import { LedesmaLogo } from '../components/login/LedesmaLogo';

/** Espera antes del redirect automatico tras guardar, para leer la confirmacion. */
const REDIRECT_DELAY_MS = 1800;

/**
 * Detecta si Supabase anexo un error de auth a la URL de aterrizaje, como pasa
 * con un enlace de recuperacion expirado o ya usado (error_code=otp_expired,
 * error=access_denied). Segun el flujo, los parametros llegan en el hash
 * (flujo implicito) o en el query string (PKCE); se revisan ambos. Se lee una
 * sola vez al montar, antes de que supabase-js limpie la URL.
 */
function readAuthErrorFromUrl(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  return Boolean(
    hash.get('error') || hash.get('error_code') || query.get('error') || query.get('error_code'),
  );
}

/**
 * Pantalla de nueva contrasena (/nueva-contrasena), destino del redirectTo del
 * correo de reset, con el mismo layout de marca del login.
 *
 * Gateo: al aterrizar desde el correo, supabase-js (detectSessionInUrl: true,
 * lib/supabase.ts) consume el token, emite PASSWORD_RECOVERY por
 * onAuthStateChange y deja una sesion de recuperacion. Ese evento puede
 * dispararse durante la inicializacion del cliente, ANTES de que esta pantalla
 * monte y pudiera suscribirse, asi que el gateo usa su efecto observable: la
 * sesion que AuthProvider expone via useAuth (getSession espera a que la
 * deteccion de URL termine). Sin sesion, o con error de Supabase en la URL
 * (enlace expirado o invalido), se muestra el aviso con link a /recuperar.
 *
 * Con sesion normal (no de recuperacion) la pantalla tambien funciona: un
 * usuario creado por enlace magico puede establecer contrasena por primera
 * vez, porque updateUser({ password }) opera sobre cualquier sesion valida.
 *
 * Validacion identica al sign-up (minimo compartido en lib/password.ts y
 * coincidencia); el token nunca se maneja a mano.
 */
export function NewPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [urlHasAuthError] = useState(readAuthErrorFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<NewPasswordStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Si updateUser falla porque la sesion de recuperacion caduco entre el
  // aterrizaje y el submit, se degrada al aviso de enlace invalido.
  const [sessionLost, setSessionLost] = useState(false);

  // Tras guardar: confirmacion breve y redirect segun el estado de sesion
  // (con sesion a la consola; sin sesion a /login).
  const continueTo = session ? '/agentes' : '/login';
  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => navigate(continueTo, { replace: true }), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, continueTo, navigate]);

  if (loading) return null;

  function fail(message: string) {
    setStatus('error');
    setErrorMsg(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      fail('Las contraseñas no coinciden.');
      return;
    }
    setStatus('submitting');
    setErrorMsg('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === 'weak_password') {
        // La regla real la aplica el servidor; se muestra su mensaje sin prometer otra.
        fail(`La contraseña no cumple los requisitos del servidor: ${error.message}`);
      } else if (error.code === 'same_password') {
        fail('La nueva contraseña debe ser distinta a la actual.');
      } else if (error.status === 401 || error.code === 'session_expired') {
        setSessionLost(true);
      } else {
        fail('No pudimos guardar la contraseña. Intenta de nuevo.');
      }
      return;
    }
    setStatus('saved');
  }

  const invalidLink = urlHasAuthError || !session || sessionLost;

  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Panel izquierdo de marca (solo desktop), separado por hairline de 0.5px. */}
      <aside
        className="hidden lg:block lg:w-[52%]"
        style={{ borderRight: '0.5px solid rgba(31,30,28,0.14)' }}
      >
        <BrandPanel sent={status === 'saved'} />
      </aside>

      {/* Panel derecho: formulario centrado. En movil, columna unica con header
          compacto arriba y el bloque de marca bajo el formulario. */}
      <div className="flex min-h-screen flex-1 flex-col lg:min-h-0">
        <header className="flex justify-center pt-12 lg:hidden">
          <LedesmaLogo compact />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">
            {invalidLink ? (
              <InvalidRecoveryNotice />
            ) : (
              <NewPasswordForm
                status={status}
                errorMsg={errorMsg}
                continueTo={continueTo}
                password={password}
                confirm={confirm}
                onPasswordChange={setPassword}
                onConfirmChange={setConfirm}
                onSubmit={handleSubmit}
              />
            )}
          </div>
        </main>
        <footer className="flex justify-center px-6 pb-12 lg:hidden">
          <BrandCopy />
        </footer>
      </div>
    </div>
  );
}
