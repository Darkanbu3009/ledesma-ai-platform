import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../components/login/AuthLayout';
import {
  InvalidRecoveryNotice,
  NewPasswordForm,
  type NewPasswordStatus,
} from '../components/login/NewPasswordForm';

/** Espera antes del redirect automatico tras guardar, para leer la confirmacion. */
const REDIRECT_DELAY_MS = 1800;

/**
 * Estado de la pantalla: los del formulario mas `session-lost`, cuando
 * updateUser reporta que la sesion de recuperacion murio entre el aterrizaje
 * y el submit (se degrada al aviso de enlace invalido).
 */
type PageStatus = NewPasswordStatus | 'session-lost';

/**
 * Pantalla de nueva contrasena (/nueva-contrasena), destino del redirectTo del
 * correo de reset, con el layout de marca compartido.
 *
 * Gateo: al aterrizar desde el correo, supabase-js (detectSessionInUrl: true,
 * lib/supabase.ts) consume el token, emite PASSWORD_RECOVERY por
 * onAuthStateChange y deja una sesion de recuperacion. Ese evento puede
 * dispararse durante la inicializacion del cliente, ANTES de que esta pantalla
 * monte y pudiera suscribirse, asi que el gateo usa su efecto observable: la
 * sesion que AuthProvider expone via useAuth (getSession espera a que la
 * deteccion de URL termine). Un enlace expirado o invalido no produce sesion
 * (supabase-js rechaza el callback con error en la URL), asi que ese caso cae
 * en el aviso con link a /recuperar sin inspeccionar la URL a mano.
 *
 * Con sesion normal (no de recuperacion) la pantalla tambien funciona: un
 * usuario creado por enlace magico puede establecer contrasena por primera
 * vez, porque updateUser({ password }) opera sobre cualquier sesion valida.
 * Por lo mismo, un usuario logueado que abre un enlace expirado ve el
 * formulario (su sesion basta) en vez de un callejon sin salida.
 *
 * Validacion identica al sign-up (minimo compartido en lib/password.ts y
 * coincidencia); el token nunca se maneja a mano.
 */
export function NewPasswordPage() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<PageStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Destino tras guardar, capturado en el momento del exito para que un cambio
  // posterior de sesion (p. ej. SIGNED_OUT desde otra pestana durante la
  // confirmacion) no retargetee el redirect ni reinicie el timer.
  const [continueTo, setContinueTo] = useState('/login');

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
      fail(t('auth.errores.contrasenaMinima', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      fail(t('auth.errores.contrasenasNoCoinciden'));
      return;
    }
    setStatus('submitting');
    setErrorMsg('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === 'weak_password') {
        // La regla real la aplica el servidor; se muestra su mensaje sin prometer otra.
        fail(t('auth.errores.requisitosServidor', { mensaje: error.message }));
      } else if (error.code === 'same_password') {
        fail(t('auth.nuevaContrasena.distintaActual'));
      } else if (error.name === 'AuthSessionMissingError') {
        // Sin sesion local, y tambien el session_not_found del servidor:
        // auth-js normaliza ambos a AuthSessionMissingError (status 400 sin
        // code), asi que el nombre del error es la senal estable.
        setStatus('session-lost');
      } else {
        fail(t('auth.nuevaContrasena.errorGuardar'));
      }
      return;
    }
    setContinueTo(session ? '/agentes' : '/login');
    setStatus('saved');
  }

  // La confirmacion de guardado se muestra pase lo que pase con la sesion
  // (la contrasena YA se actualizo); fuera de ese caso, sin sesion valida no
  // hay nada que guardar y se ofrece pedir un enlace nuevo.
  return (
    <AuthLayout sent={status === 'saved'}>
      {status !== 'session-lost' && (status === 'saved' || session !== null) ? (
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
      ) : (
        <InvalidRecoveryNotice />
      )}
    </AuthLayout>
  );
}
