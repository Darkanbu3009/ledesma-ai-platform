import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-hueso-muted">Cargando...</span>
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
