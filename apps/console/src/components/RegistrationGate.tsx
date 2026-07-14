import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { useMe } from '../lib/queries';
import { classifyRegistration } from '../lib/registration';
import { SplashCarga } from './SplashCarga';

/**
 * Compuerta de registro: se monta por dentro de ProtectedRoute (la sesion ya esta garantizada) y
 * consulta GET /v1/me. Solo deja pasar al dashboard a quien tiene el registro activo; a quien aun no
 * completo el registro lo manda a /registro (formulario). Ambos tipos (persona y empresa) entran
 * directo: ya no hay pantalla de revision. Aditivo: no toca el flujo de login OTP, solo decide el
 * enrutado posterior.
 */
export function RegistrationGate() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useMe();

  if (isLoading) {
    return <SplashCarga />;
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-grafito-border bg-grafito p-7 text-center shadow-2xl shadow-black/40">
          <p className="font-display text-lg font-semibold text-hueso">
            {t('registro.errorCarga.titulo')}
          </p>
          <p className="mt-2 text-sm text-hueso-muted">{t('auth.comun.revisaConexion')}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border bg-carbon px-4 py-2 text-sm font-medium text-hueso transition hover:border-brasa"
          >
            <RefreshCw className="h-4 w-4" />
            {t('auth.comun.reintentar')}
          </button>
        </div>
      </div>
    );
  }

  if (classifyRegistration(data) !== 'active') {
    return <Navigate to="/registro" replace />;
  }

  return <Outlet />;
}
