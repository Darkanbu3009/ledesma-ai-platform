import { Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useConsents } from '../lib/queries';
import { hasPendingConsents } from '../lib/privacy';
import { ConsentScreen } from './privacy/ConsentScreen';

/**
 * Compuerta de CONSENTIMIENTO (Fase 5.6). Se monta por dentro de RegistrationGate (sesion + registro ya
 * garantizados) y consulta GET /v1/consents/me. Si al titular le falta aceptar la version VIGENTE de algun
 * documento (primer login o cambio de version), presenta la pantalla de consentimiento; solo cuando esta
 * al dia deja pasar al dashboard.
 *
 * Como cubre TODO el dashboard, las features autonomas (scheduler/triggers/recetas) quedan gateadas por
 * consentimiento por construccion: no se puede llegar a crearlas sin haber aceptado el aviso. Aditivo: no
 * toca el flujo OTP ni el registro; solo agrega esta capa antes del AppLayout.
 *
 * Ante un error de red al cargar el estado, NO bloquea de forma agresiva: ofrece reintentar.
 */
export function ConsentGate() {
  const { data, isLoading, isError, refetch } = useConsents();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <span className="text-sm text-muted">Cargando...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 text-center shadow-card-hover">
          <p className="font-display text-lg font-semibold text-ink">No pudimos cargar tu cuenta</p>
          <p className="mt-2 text-sm text-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line bg-field px-4 py-2 text-sm font-medium text-ink transition hover:border-brasa"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (hasPendingConsents(data)) {
    return <ConsentScreen state={data} />;
  }

  return <Outlet />;
}
