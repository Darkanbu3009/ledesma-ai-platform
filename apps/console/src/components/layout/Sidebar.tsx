import { NavLink } from 'react-router-dom';
import { Activity, Bot, CalendarClock, ChefHat, KeyRound, LayoutDashboard, Settings, ShieldCheck, Users, Webhook } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/useAuth';
import { useIsAdmin, useMe } from '../../lib/queries';
import { focusRing } from '../../lib/utils';
import { Logo } from '../brand/logo';
import { UserMenu } from './UserMenu';

const navItems = [
  { to: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { to: '/agentes', label: 'Agentes', icon: Bot },
  { to: '/recetas', label: 'Recetas', icon: ChefHat },
  { to: '/tareas', label: 'Tareas', icon: CalendarClock },
  { to: '/triggers', label: 'Triggers', icon: Webhook },
  { to: '/actividad', label: 'Actividad', icon: Activity },
  { to: '/credenciales', label: 'Credenciales', icon: KeyRound },
  { to: '/privacidad', label: 'Privacidad', icon: ShieldCheck },
  // Apunta a la ruta base (su index redirige a /configuracion/cuenta) para que el prefix-match
  // del NavLink resalte toda la seccion (cuenta y paquetes), igual que hacia el viejo "Mi cuenta".
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

/** Item de nav del area de admin. Solo se agrega cuando useIsAdmin() resuelve true (ver abajo). */
const adminNavItem = { to: '/admin', label: 'Admin', icon: Users };

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  // full_name para el menu de usuario: misma fuente que el encabezado de identidad de Mi cuenta
  // (la query ['me'], ya en cache por los gates). Mientras resuelve, el menu cae al email.
  const { data: me } = useMe();
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
        {/* Boton de cuenta (patron tipo Claude): avatar de inicial + nombre + chevron. Al click
            despliega el menu popover hacia arriba con Configuracion y Cerrar sesion (el signOut
            es el MISMO handleLogout de siempre, pasado por prop). */}
        <UserMenu
          fullName={me?.profile?.fullName}
          email={user?.email}
          onSignOut={() => void handleLogout()}
          onNavigate={onNavigate}
        />
      </div>
    </aside>
  );
}
