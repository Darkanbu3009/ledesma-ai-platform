import { Navigate, Outlet } from 'react-router-dom';
import { useIsAdmin } from '../lib/queries';

/**
 * Compuerta de ADMIN: envuelve las rutas del area de administracion (/admin). Sigue el patron de
 * RegistrationGate/ConsentGate -- se monta por dentro de esos gates (sesion, registro y consentimiento
 * ya garantizados) y consulta el estado de admin derivado de /v1/me (useIsAdmin). Mientras carga muestra
 * un estado neutro (no revela ni oculta prematuramente); si el usuario NO es admin lo devuelve a la home
 * de la consola; si lo es, renderiza el area.
 *
 * IMPORTANTE -- este guard es COSMETICO, NO seguridad. La defensa real es server-side: cada endpoint de
 * admin esta gateado por requireAdminRole, que lee profiles.is_admin y responde 403 a un no-admin. Un
 * usuario que forzara la URL /admin igual no obtendria datos de admin: el backend lo rechaza. Aca solo
 * evitamos mostrar un area que no le aplica (UX).
 */
export function AdminGate() {
  const { isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <span className="text-sm text-muted">Cargando...</span>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/agentes" replace />;
  }

  return <Outlet />;
}
