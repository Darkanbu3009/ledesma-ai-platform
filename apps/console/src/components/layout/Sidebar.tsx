import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  Bot,
  CalendarClock,
  ChefHat,
  KeyRound,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
} from 'lucide-react';
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

/**
 * Sub-item de Configuracion: entrada directa al catalogo de planes. La URL se conserva
 * (/configuracion/paquetes) porque la pagina de cuenta y los CTAs de upgrade ya enlazan ahi;
 * solo cambia el label visible. Siempre visible (no hay patron de submenu previo en el sidebar)
 * y en neutros: el acento brasa queda para el item padre activo.
 */
const upgradeSubItem = { to: '/configuracion/paquetes', label: 'Mejorar Plan', icon: Sparkles };

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  /** true = modo mini-rail (solo iconos). Lo controla AppLayout; el drawer movil no lo usa. */
  collapsed?: boolean;
  /** Si no llega (drawer movil), el boton de colapso no se renderiza. */
  onToggleCollapse?: () => void;
}) {
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

  function itemClass(isActive: boolean) {
    return [
      'flex items-center gap-3 rounded-xl py-2.5 text-sm transition',
      collapsed ? 'justify-center px-0' : 'px-3',
      focusRing,
      isActive ? 'bg-brasa-soft font-semibold text-brasa' : 'font-medium text-ink-soft hover:bg-line-soft',
    ].join(' ');
  }

  return (
    <aside
      className={[
        'flex h-full flex-col border-r border-line bg-sidebar py-5 transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16 px-2' : 'w-64 px-4',
      ].join(' ')}
    >
      <div
        className={
          collapsed
            ? 'flex flex-col items-center gap-1 px-0 py-1'
            : 'flex items-center justify-between px-2 py-1'
        }
      >
        {collapsed === false && <Logo tight className="h-10 w-auto" />}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expandir panel' : 'Colapsar panel'}
            aria-expanded={collapsed === false}
            title={collapsed ? 'Expandir panel' : 'Colapsar panel'}
            className={`rounded-lg p-1.5 text-muted transition hover:bg-line-soft hover:text-ink ${focusRing}`}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>
        )}
      </div>

      {/* overflow-hidden + nowrap: durante la transicion de ancho las etiquetas no se envuelven
          ni se derraman fuera del rail (el popover del UserMenu vive fuera de este nav). */}
      <nav className="mt-7 flex-1 space-y-1 overflow-hidden whitespace-nowrap">
        {items.map((item) => (
          <Fragment key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) => itemClass(isActive)}
            >
              <item.icon className="h-[18px] w-[18px] flex-none" />
              {collapsed === false && item.label}
            </NavLink>
            {/* Sub-item indentado de Configuracion (colapsado pierde la sangria: solo icono). En
                neutros a proposito: el activo usa greige, no brasa, para leerse como nivel dos. */}
            {item.to === '/configuracion' && (
              <NavLink
                to={upgradeSubItem.to}
                onClick={onNavigate}
                title={collapsed ? upgradeSubItem.label : undefined}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-xl py-2 text-[13px] transition',
                    collapsed ? 'justify-center px-0' : 'pl-10 pr-3',
                    focusRing,
                    isActive
                      ? 'bg-line-soft font-semibold text-ink'
                      : 'font-medium text-ink-soft hover:bg-line-soft',
                  ].join(' ')
                }
              >
                <upgradeSubItem.icon className="h-4 w-4 flex-none" />
                {collapsed === false && upgradeSubItem.label}
              </NavLink>
            )}
          </Fragment>
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
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
