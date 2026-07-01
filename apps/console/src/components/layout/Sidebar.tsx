import { NavLink } from 'react-router-dom';
import { Bot, CalendarClock, KeyRound, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/useAuth';
import { BrandMark } from '../BrandMark';

const navItems = [
  { to: '/agentes', label: 'Agentes', icon: Bot },
  { to: '/tareas', label: 'Tareas', icon: CalendarClock },
  { to: '/credenciales', label: 'Credenciales', icon: KeyRound },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-sidebar px-4 py-5">
      <div className="flex items-center gap-3 px-2 py-1">
        <BrandMark className="h-9 w-9" />
        <span className="font-display text-[15px] font-bold text-ink">Ledesma AI Labs</span>
      </div>

      <nav className="mt-7 flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                isActive
                  ? 'bg-brasa-soft font-semibold text-brasa'
                  : 'font-medium text-ink-soft hover:bg-line-soft',
              ].join(' ')
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line pt-4">
        <p className="truncate px-2 pb-2.5 text-xs text-muted-soft">{user?.email}</p>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition hover:bg-line-soft hover:text-ink"
        >
          <LogOut className="h-[17px] w-[17px]" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
