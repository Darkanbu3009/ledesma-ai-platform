import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/useAuth';
import { BrandMark } from '../components/BrandMark';

export function DashboardPage() {
  const { user } = useAuth();

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark className="h-9 w-9" />
            <span className="font-display font-semibold text-hueso">Ledesma AI Labs</span>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-grafito-border px-3.5 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            Cerrar sesion
          </button>
        </div>

        <div className="mt-16 text-center">
          <h1 className="font-display text-3xl font-bold text-hueso">Bienvenido</h1>
          <p className="mt-3 text-hueso-muted">
            Sesion iniciada como <span className="text-hueso">{user?.email}</span>
          </p>
          <p className="mt-8 text-sm text-hueso-muted">
            La consola esta en construccion. Pronto podras configurar y administrar tus agentes
            aqui.
          </p>
        </div>
      </div>
    </div>
  );
}
