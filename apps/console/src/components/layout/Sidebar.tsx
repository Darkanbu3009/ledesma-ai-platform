import { NavLink } from 'react-router-dom';
import { Activity, Bot, CalendarClock, ChefHat, KeyRound, LayoutDashboard, LogOut, ShieldCheck, User, Users, Webhook } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/useAuth';
import { useIsAdmin } from '../../lib/queries';
import { focusRing } from '../../lib/utils';
import { Logo } from '../brand/logo';

const navItems = [
  { to: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { to: '/agentes', label: 'Agentes', icon: Bot },
  { to: '/recetas', label: 'Recetas', icon: ChefHat },
  { to: '/tareas', label: 'Tareas', icon: CalendarClock },
  { to: '/triggers', label: 'Triggers', icon: Webhook },
  { to: '/actividad', label: 'Actividad', icon: Activity },
  { to: '/credenciales', label: 'Credenciales', icon: KeyRound },
  { to: '/privacidad', label: 'Privacidad', icon: ShieldCheck },
];

/** Item de nav del area de admin. Solo se agrega cuando useIsAdmin() resuelve true (ver abajo). */
const adminNavItem = { to: '/admin', label: 'Admin', icon: Users };

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  // Item de admin CONDICIONAL: solo visible para super-admins. No parpadea porque el Sidebar se monta por
  // dentro de RegistrationGate, que ya resolvio /v1/me antes de renderizar el layout: al montar, isAdmin ya
  // es su valor final (un admin lo ve desde el primer paint; un usuario normal nunca). Es UX cosmetica -- el
  // acceso real lo impone el backend (requireAdminRole), no la presencia de este item.
  const { isAdmin } = useIsAdmin();
  const items = isAdmin ? [...navItems, adminNavItem] : navItems;

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-sidebar px-4 py-5">
      <div className="flex items-center px-2 py-1">
        <Logo tight className="h-10 w-auto" />
      </div>

      <nav className="mt-7 flex-1 space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                focusRing,
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
        {/* Acceso al perfil: el email deja de ser texto muerto y se vuelve el enlace a /perfil (con el
            resalte de ruta activa, igual que la nav). El boton de cerrar sesion se queda debajo. */}
        <NavLink
          to="/perfil"
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
              focusRing,
              isActive ? 'bg-brasa-soft text-brasa' : 'text-ink-soft hover:bg-line-soft',
            ].join(' ')
          }
        >
          <User className="h-[18px] w-[18px] flex-none" />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium leading-tight">Mi cuenta</span>
            <span className="truncate text-xs text-muted-soft">{user?.email}</span>
          </span>
        </NavLink>
        <button
          onClick={handleLogout}
          className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition hover:bg-line-soft hover:text-ink ${focusRing}`}
        >
          <LogOut className="h-[17px] w-[17px]" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
