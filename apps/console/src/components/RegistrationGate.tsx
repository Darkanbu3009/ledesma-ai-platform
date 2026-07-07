import { Navigate, Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useMe } from '../lib/queries';
import { classifyRegistration } from '../lib/registration';

/**
 * Compuerta de registro: se monta por dentro de ProtectedRoute (la sesion ya esta garantizada) y
 * consulta GET /v1/me. Solo deja pasar al dashboard a quien tiene el registro activo; a quien aun no
 * completo el registro lo manda a /registro (formulario). Ambos tipos (persona y empresa) entran
 * directo: ya no hay pantalla de revision. Aditivo: no toca el flujo de login OTP, solo decide el
 * enrutado posterior.
 */
export function RegistrationGate() {
  const { data, isLoading, isError, refetch } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-hueso-muted">Cargando...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-grafito-border bg-grafito p-7 text-center shadow-2xl shadow-black/40">
          <p className="font-display text-lg font-semibold text-hueso">No pudimos cargar tu cuenta</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border bg-carbon px-4 py-2 text-sm font-medium text-hueso transition hover:border-brasa"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
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
