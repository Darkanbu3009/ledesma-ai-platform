import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { SplashCarga } from './SplashCarga';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) {
    return <SplashCarga />;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
