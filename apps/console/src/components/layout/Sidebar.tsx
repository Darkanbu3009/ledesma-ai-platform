import { NavLink } from 'react-router-dom';
import { Bot, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/useAuth';
import { BrandMark } from '../BrandMark';

const navItems = [{ to: '/agentes', label: 'Agentes', icon: Bot }];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-grafito-border bg-grafito">
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandMark className="h-9 w-9" />
        <span className="font-display font-semibold text-hueso">Ledesma AI Labs</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-brasa/10 text-brasa' : 'text-hueso-muted hover:bg-carbon hover:text-hueso',
              ].join(' ')
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-grafito-border px-3 py-4">
        <p className="truncate px-2 pb-3 text-xs text-hueso-muted">{user?.email}</p>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-hueso-muted transition hover:bg-carbon hover:text-hueso"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesion
        </button>
      </div>
    </aside>
  );
}
